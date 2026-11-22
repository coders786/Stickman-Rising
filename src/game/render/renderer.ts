import { newReceiverRig, RECEIVER, sampleReceiverRig } from '../lighting/receiver'
import { bridgeSkyBasis } from '../../graphics/bridge/SkyBasis'
import { MOON_KEY, MOON_SLOPE, roadFixtureVisibility, softVisibility, staticFalloff, type LightPoint } from '../../graphics/bridge/NoirGeometry'
import { lightDepth } from '../../graphics/bridge/LightVectorGrid'
import { SACR_CURB_Z, SACR_NEAR_Z } from '../../graphics/sacr/SACRMath'
import { castKey, castProjection, drawBridgeCast, type CastKey, type CastReceiver } from './bridge-casts'
import { BridgeShopGlass } from './bridge-shop-glass'
import { bridgeShop } from '../stage/bridge-shop-layout'
import { paintShopFront } from '../stage/bridge-shop-art'
import { deckFace, deckTopPath } from '../stage/bridge-deck-face'
import { BridgeFinish, type BridgeAdmission } from './bridge-finish'
import type { BakeWindow } from '../../graphics/bridge/BridgeBakeProtocol'
import { SACR_MASTER_K, SACR_MOBILE_K, SACR_PRIORITY, SACR_SOLID_ID } from '../../graphics/sacr/SACRPacker'
import { BridgeFrame, bridgeTint, BRIDGE_LIGHT, MASTER_FLASH_LIMIT, MOBILE_FLASH_LIMIT } from './bridge-frame'
import { BridgeCanvasReceivers, BridgeWetStrip, drawMobileImpulseReflection } from './bridge-mobile'
import { paintBridgeDistrict, puddlePath } from '../stage/bridge-art'
import { paintLaneDashes, paintWearingCourse } from '../stage/bridge-wearing-course'
import { clamp, damp } from '../core/utils'
import { ENV_TICK } from '../world/fronts'
import { paintGate, REFLECTION_ALPHA, REFLECTION_DEPTH } from '../stage/route-art'
import { bridgeBiomeMix, type BridgeRoute, type Platform } from '../stage/route'
import type { Gate } from '../world/encounters'
import type { RunPickups } from '../world/run-pickups'
import type { ServiceTerminal } from '../world/service'
import { ROAD } from '../stage/road-section'
import { SHELTER_KIT } from '../stage/run-layout'
import { applySectionView, opaqueRoadBand, sectionSpan } from '../stage/bridge-depth'
import { STREET_REAR_Y, STREET_FRONT_Y } from '../stage/bridge-city'
import { bridgeRetention } from '../stage/bridge-weather-data'
import { RAIL_MODEL_SCALE, RAIL_Y, RAIL_SUPPORT, RAIL_SUPPORT_PITCH, railLocalOffset } from '../../graphics/bridge/RailSchedule'
import { skyHash } from '../../graphics/bridge/SkyBasis'
/** Canvas 2D: sky → arena and fixture optics → actors → FX
 * → screen weather/flash → HUD. The authored stages never sample the scene
 * for bloom. Ungraded diagnostic scenes can still use the legacy stack. */

import { newProbe, type Probe } from '../lighting/ribbons'
import { directionalProjection } from '../world/light'
import { featuresFor, RENDERER_NAMES, type GraphicsFeatures, type Tier } from './graphics'
import { moonShadowSlope, steerShadow, shadowOutline, type ShadowActor, drawCastShadow, drawBridgeContact, drawContactAO, usesCastShadow, usesPropShadows } from './shadows'
import { Camera } from '../core/camera'
import { FX } from '../fx/fx'
import { particlesDraw } from '../fx/particles1d'
import { Enemy } from '../entities/enemy'
import { Player } from '../entities/player'
import { ProjectilePool } from '../entities/projectiles'
import type { BackgroundRenderer } from '../world/background'
import type { PropField } from '../world/props'
import { HUD, HudState } from './hud'
import { PostStack } from './post'
import { BridgePost } from './bridge-post'
import { finishPaint } from './paint-slices'
import { GameSettings } from '../core/types'

export interface RenderWorld {
  cam: Camera
  fx: FX
  bg: BackgroundRenderer
  enemies: Enemy[]
  player: Player
  projectiles: ProjectilePool
  props: PropField
  hud: HUD
  hudCtx?: CanvasRenderingContext2D | null
  hudState: HudState
  time: number
  streamQuiet?: boolean
  renderScale?: number
  provisional?: boolean // publish complete coverage without waiting for rich assets
  opening?: BridgeAdmission | null // resolved, hidden preparation path; undefined during normal rendering
  routeState?: { route: BridgeRoute; gate?: Gate; clearedGate?: Gate | null; pickups: RunPickups | null; service: ServiceTerminal;
    active: boolean; quiet: boolean; opticalPulse: number }
}

export class Renderer {
  private quality: GameSettings['quality'] = 'high'
  /** The tier's feature set, resolved once per change (render/graphics.ts). */
  /** FRUSTUM CULL RECEIPT — how many bodies this frame drew vs skipped.
   *  Culling that is not counted is culling you cannot prove. */
  private cullDrawn = 0
  private cullSkipped = 0
  private readonly visibleEnemies: Enemy[] = []
  private readonly reflectorEnemies: Enemy[] = []
  private probes = new WeakMap<ShadowActor, Probe>()
  private forward = false
  setDesktopLighting(enabled:boolean):void { this.forward=enabled }
  private post = new PostStack()
  private readonly lenses = new BridgePost()
  private bakedOptics = false
  private wetSurface = true
  private readonly bridgeFinish = new BridgeFinish()
  private readonly glass = new BridgeShopGlass()
  private readonly wetStrip = new BridgeWetStrip()
  private readonly canvasReceivers = new BridgeCanvasReceivers()
  private readonly bridgeField = new BridgeFrame()
  private routeIdentity: BridgeRoute | undefined
  private bossTint = 0
  attachWorldOutput(canvas: HTMLCanvasElement, invalidated: () => void): void { this.bridgeFinish.attach(canvas, invalidated) }
  private diagnosticMobile = false
  setDiagnosticMobile(): void { this.diagnosticMobile = true }
  allowDiagnosticMaster(): void { this.bridgeFinish.allowSoftwareForDiagnostics() }
  get bridgePath() { return this.bridgeFinish.path }
  get bridgeFrameLive(): boolean { return this.bridgeFinish.frameLive }
  abortBridgeFrame(reason: string): void { this.bridgeFinish.abortFrame(reason) }
  bridgeReceipt() { return { ...this.bridgeFinish.receipt(), field: this.bridgeField.receipt(), glass: this.glass.receipt(),
    post2d: this.lenses.receipt(),
    sacr: this.bridgeFinish.path === 'mobile-canvas' ? null : this.bridgeField.sacr.receipt() } }
  private features: GraphicsFeatures = featuresFor('high')

  dispose(): void {
    this.post.dispose()
    this.lenses.dispose()
    this.bridgeFinish.dispose()
    this.wetStrip.dispose()
    this.canvasReceivers.dispose()
    this.bridgeField.retireRoute()
    this.glass.retire()
    this.routeIdentity = undefined
    this.visibleEnemies.length = this.reflectorEnemies.length = 0
  }

  retireBridgeRoute(): void {
    this.bridgeFinish.retireRoute()
    this.lenses.retire()
    this.bridgeField.retireRoute()
    this.glass.retire()
  }

  private requestedBridgeTier() {
    // Adaptive resolution does not recompile a different shader stack.
    return !this.diagnosticMobile && this.quality === 'ultra' ? 'master' : 'mobile'
  }

  openingAlbedo(w: number, h: number, scale: number): boolean {
    return this.bridgeFinish.prefersAlbedo(this.requestedBridgeTier(), w, h, scale)
  }

  beginBridgeOpening(): void { this.bridgeFinish.beginOpening() }
  resetBridgeOpening(): void { this.bridgeFinish.resetOpening() }
  advanceBridgeOpening(w: number, h: number, scale: number, enableGL: boolean, window: BakeWindow | null, seed: number, skySettled: boolean) {
    return this.bridgeFinish.advanceOpening(enableGL ? this.requestedBridgeTier() : null, w, h, scale, window, seed, skySettled)
  }
  get hasBridgeOpeningFrame(): boolean { return this.bridgeFinish.hasOpeningFrame }
  bridgeOpeningFrameReady(): boolean { return this.bridgeFinish.openingFrameReady() }
  discardBridgeOpeningFrame(): void { this.bridgeFinish.discardOpeningFrame() }
  endBridgeOpening(): void { this.bridgeFinish.endOpening() }
  publishBridgeOpening(gpu: BridgeAdmission | null): void { this.bridgeFinish.publishOpening(gpu) }

  setQuality(q: GameSettings['quality']): void {
    this.quality = q
    this.features = featuresFor(q as Tier)
  }

  /** What the frame is actually spending, for the debug readout. */
  graphicsSummary(): string {
    const f = this.features
    const finish = ` ${RENDERER_NAMES[this.bridgeFinish.path]}`
    const stack = this.bakedOptics ? ` baked practicals${finish}` : this.forward && f.bloom ? ' forward optics' : f.bloom || f.godRays ? ` ${this.post.summary()}` : ''
    const cull = ` cull ${this.cullDrawn}/${this.cullDrawn + this.cullSkipped}`
    const mirror = !this.wetSurface ? 'off' : this.bakedOptics ? 'baked' :
      this.forward ? f.actorMirror : f.reflection ? `1:${f.reflection}` : 'off'
    const dynamic = this.bakedOptics ? '' : `${f.shaftLayers ? ` shafts×${f.shaftLayers}` : ''} glints ${f.wetGlints}`
    return `${f.shadows}${dynamic}${f.dust ? ' motes' : ''} refl ${mirror} finish ${f.roofFinish} dpr cap ${f.dprCap}${stack}${cull}`
  }

  private routeCast(x: number, y: number, moonSlope: number, road: boolean, moonOnly = false) {
    const f = this.bridgeField
    if (moonOnly) {
      const e = f.sample(x, y, road)
      return castKey(moonSlope, f.atmo.key[0], e.moon * e.ao * f.key, [])
    }
    const e = f.castSample(x, y, road)
    return castKey(moonSlope, f.atmo.key[0], e.moon * f.key, e.directions)
  }

  private castTint(x: number, y: number, road: boolean, key: CastKey, route: BridgeRoute, fixture?: LightPoint): readonly [number, number, number] {
    const f = this.bridgeField, e = f.sample(x, y, road)
    const moon = road && route.shelterAt(x) ? 0 : e.moon * f.atmo.key[0] * f.key * .81
    const fill = .21 + .34 * e.sky, r = moon * .78, g = moon * .94
    // Approximate inverse display tone curve for the admitted direct lobe.
    // Canvas combat illumination is added afterwards, never multiplied here.
    const share = (source: number, total: number) => Math.min(.72, source / Math.max(.1, fill + total) * .70)
    if (key.source !== 'practical') return [share(r, r + e.r), share(g, g + e.g), share(moon, moon + e.b)]
    if (!fixture) return [0, 0, 0]
    const height = road ? y * .56 : y
    const fade = staticFalloff(fixture, x - fixture.x, height - fixture.y)
    if (fade < .001) return [0, 0, 0]
    const z = SACR_CURB_Z + (SACR_NEAR_Z - SACR_CURB_Z) * (y - ROAD.rear) / (ROAD.front - ROAD.rear)
    const visibility = road ? roadFixtureVisibility(x, height, z, fixture, lightDepth(fixture), f.blockers) :
      softVisibility(x, y, fixture.x, fixture.y, fixture.physicalRadius, f.blockers)
    const w = fade * visibility, [cr, cg, cb] = fixture.rgb
    return [share(Math.min(e.r, cr * w), r + e.r), share(Math.min(e.g, cg * w), g + e.g), share(Math.min(e.b, cb * w), moon + e.b)]
  }

  /** Contact on all tiers, one live cast on High/Ultra. Only ungraded
   * diagnostics project a second posed image of the actor. */
  private shade(
    ctx: CanvasRenderingContext2D,
    bg: BackgroundRenderer,
    actor: ShadowActor,
    moonSlope: number,
    keyGain: number,
    keyX: number,
    wetSurface: boolean,
    hero=false,
    bridge?: BridgeRoute,
    master = false,
    gpuGround = false,
    support?: Platform | null,
  ): void {
    const F = this.features
    const { x, y, scale } = actor
    const height = actor.hipY - 18 * scale
    const keyWeight = bridge ? 1 : bg.keyWeightAt?.(x) ?? 1
    let probe = this.probes.get(actor)
    // Bridge Ronin casts and reflects with the same underlying geometry,
    // but its ink never needs an incident-light probe. Keep the legacy
    // finite-scene probe for shadow steering, and material taps for enemies.
    if ((bridge ? !hero : F.rim) && bg.lightAt) {
      if (!probe) { probe = newProbe(); this.probes.set(actor,probe) }
      if (bridge) {
        probe.castW = probe.r = probe.g = probe.b = 0
        probe.dy = probe.dx = probe.dir = 0; probe.caster = probe.best = null
      } else { probe.local = undefined; bg.lightAt(x,height,probe) }
      probe.lunar=undefined;probe.keyX=keyX;probe.keyGain=keyGain*keyWeight;probe.volume=F.keyTop && (!bridge || master)
      if (!F.keyTop) probe.dy=0
      if (bridge) {
        const f = this.bridgeField, sky = f.atmo
        const e = f.sample(x, height), lunarPower = f.key * sky.key[0] * keyGain
        probe.keyX = MOON_KEY[0]
        probe.keyGain = lunarPower * e.moon
        probe.lunar = probe.keyGain
        const strike = sky.lightning(f.screenX(x, height)) * e.flash
        // The fixed-surface RGB bake is not added over moving bodies.
        // Contour taps below already receive the direct finite fixtures.
        probe.r = strike * .16; probe.g = strike * .18; probe.b = strike * .20
        // Re-use a lower Stratum B mip already on the CPU, not a second
        // reflection trace. The weak up-bounce never reaches the visor.
        if (master && !bridge.shelterAt(x) && (bg.surfaceWetness?.(x) ?? 0) > .04) f.wetBounce(x, probe)
        const parts = probe.local ??= newReceiverRig()
        sampleReceiverRig(f, actor, parts)
        f.castFrom(probe, parts[RECEIVER.torso])
      }
    }
    if (bridge) {
      if (gpuGround) return
      const face = support ? deckFace(bridge.at(actor.x)) : undefined
      drawBridgeContact(ctx, actor, support, face)
      if (!usesCastShadow(F.shadows)) return
      const cast = (receiver: CastReceiver) => {
        const road = receiver === null
        let px = x, py = receiver?.support.y ?? ROAD.lane
        if (road && (actor.floorY ?? 0) < ROAD.lane) {
          // Query the receiving road, not the elevated actor's x under the
          // slab. Its displaced footprint may be in a different light lane.
          const p = castProjection(actor, { slope: moonSlope, gain: 1, zSlope: MOON_KEY[2] / -MOON_KEY[1] }, null)
          px = p.x - 37 * p.c; py = clamp(p.y - 37 * p.d, ROAD.rear + 1, ROAD.front - 1)
        }
        let key = this.routeCast(px, py, moonSlope, road)
        const fixture = key.practical && this.bridgeField.castFixture(px, py, key.practical)
        const paint = (lens?: LightPoint) => drawBridgeCast(ctx, actor, key, receiver,
          (u, v) => this.castTint(u, v, road, key, bridge, lens), bridge, lens?.y)
        if ((key.source !== 'practical' || fixture) && paint(fixture)) { this.bridgeField.canvasCasts++; return }
        // A bright lens sample is ineligible if its projected silhouette
        // misses the surface or its own light is blocked there. Try the
        // lunar ray instead; never stack two Canvas diffuse masks.
        if (key.source === 'practical') {
          key = this.routeCast(px, py, moonSlope, road, true)
          this.bridgeField.canvasCasts += +paint()
        }
      }
      // Shadows can reach a platform even when the fighter is airborne
      // beside it. The sole still belongs only to the actual support.
      if (height < -78) for (const c of bridge.between(x - 300, x + 300)) {
        const p = c.platform
        if (p && x > p.left - 220 && x < p.right + 220 && height - 24 * scale < p.y) cast({ support: p, face: deckFace(c) })
      }
      cast(null)
      return
    }
    drawContactAO(ctx, actor)
    const cast = usesCastShadow(F.shadows) && Math.abs(y - (actor.floorY ?? 0)) < 200
    const mirror = wetSurface && this.forward && F.actorMirror !== 'off' && Math.abs(y) < 200
    if (!cast && !mirror) return
    const path = shadowOutline(actor.geom, cast || F.actorMirror === 'posed')
    if (mirror) {
      ctx.save()
      ctx.beginPath();ctx.rect(x-120*scale,0,240*scale,ROAD.front);ctx.clip()
      ctx.transform(actor.face*scale,0,0,-.62*scale,x,-.62*actor.hipY)
      // Map the fade to the receiver, not the fighter: a jumping fighter's
      // virtual image moves deeper into the rough water and loses contrast.
      const contact=-actor.hipY/scale,far=contact-ROAD.front/(.62*scale)
      const tint=hero?'13,23,34':'130,148,161'
      const wet=ctx.createLinearGradient(0,contact,0,far)
      wet.addColorStop(0,`rgba(${tint},0)`);wet.addColorStop(.17,`rgba(${tint},${.34 * (bg.surfaceWetness?.(x) ?? .65) * (bg.actorReflectionGain?.() ?? 1)})`);wet.addColorStop(1,`rgba(${tint},0)`)
      ctx.fillStyle=wet;ctx.fill(path);ctx.restore()
    }
    if (cast) {
      // Shelter attenuates the exterior contribution, not the practical that
      // takes over local cast direction. The contact stamp stays independent.
      const strength = keyWeight + (1 - keyWeight) * (probe?.castW ?? 0)
      drawCastShadow(ctx, actor, path, steerShadow(moonSlope, x, height, probe), strength)
    }
  }

  private routeMirror(ctx: CanvasRenderingContext2D, actor: ShadowActor, bg: BackgroundRenderer, hero: boolean, preclipped = false): void {
    if (this.features.actorMirror === 'off' || actor.y < -70 || (actor.floorY ?? 0) < 0) return
    const wet = bg.surfaceWetness?.(actor.x) ?? 0
    if (wet <= .005) return
    const { x, hipY, scale, face } = actor
    const path = shadowOutline(actor.geom, this.features.actorMirror === 'posed')
    const reach = 120 * scale, depth = -scale * .59, oy = -hipY * .59
    ctx.save()
    if (!preclipped) {
      bg.clipWet?.(ctx, x - reach, x + reach, ROAD.lane, ROAD.front)
      puddlePath(ctx, x - reach, x + reach, this.bridgeField.drainage); ctx.clip()
    }
    ctx.transform(scale * face, 0, 0, depth, x, oy)
    const tint = hero ? '4,14,26' : '144,170,182'
    const g = ctx.createLinearGradient(0, -oy / depth, 0, (REFLECTION_DEPTH - oy) / depth)
    g.addColorStop(0, `rgba(${tint},0)`)
    g.addColorStop(.14, `rgba(${tint},${Math.min(REFLECTION_ALPHA, wet * (hero ? .24 : .17))})`)
    g.addColorStop(.64, `rgba(${tint},${wet * .036})`)
    g.addColorStop(1, `rgba(${tint},0)`)
    ctx.fillStyle = g; ctx.fill(path); ctx.restore()
  }

  drawHud(scene: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    const g = world.hudCtx
    if (g && !g.isContextLost?.()) world.hud.drawLayer(g, w, h, world.hudState, dt, window.devicePixelRatio)
    else world.hud.draw(scene, w, h, world.hudState, dt)
  }

  draw(scene: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    finishPaint(this.drawSteps(scene, world, w, h, dt, false))
  }

  *drawSteps(scene: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number, cold = true): Generator<void> {
    this.lenses.begin()
    if (world.provisional && world.routeState?.active) {
      this.bridgeFinish.prepare(null, scene, w, h, Math.min(1, world.renderScale ?? 1), true)
      this.drawBridgeCoverage(scene, world, w, h, dt)
      return
    }
    let ctx = scene
    const { cam, fx, bg, player, enemies, projectiles, props, hudState } = world
    const { routeState } = world
    const time = world.time
    const wetSurface = this.wetSurface = bg.hasWetSurface?.() ?? true
    const bakedOptics = bg.usesBakedOptics?.() ?? false
    if (bakedOptics && !this.bakedOptics) this.post.dispose()
    this.bakedOptics = bakedOptics
    const liveMirrors = wetSurface && !bakedOptics

    // 1. sky and far scene. The same camera is submitted to both painters
    // and the GPU; roll and fractional backing never shift a receiver.
    const worldCam = { x: cam.x + cam.offX, y: cam.y + cam.offY, zoom: cam.zoom, rot: cam.rot }
    const skyCam = { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom }
    const applyWorldCamera = (g = ctx) => applySectionView(g, worldCam, w, h)
    const viewHalfW = w / (2 * cam.zoom) + 240
    const key = bg.lightState?.()
    const moon = directionalProjection(key ?? { azimuth: 0, elevation: .78 })
    const scale = world.renderScale ?? scene.canvas.width / w
    const enabled = !!(routeState?.active && world.hudCtx)
    const opening = world.opening !== undefined
    const gpu = opening ? world.opening : this.bridgeFinish.prepare(enabled ? this.requestedBridgeTier() : null, scene, w, h, scale, world.provisional)
    if (opening) this.bridgeFinish.paintSources(gpu ?? null, scene, w, h, scale)
    if (cold) yield
    this.glass.reset()
    if (routeState && hudState.attract) {
      // Title is a sky/skyline, not a throwaway interactive run. No actor
      // layers, transport jobs or route plate cache for the attract seed.
      this.wetStrip.dispose()
      this.lenses.dispose()
      if (cold && bg.drawBridgeTitleSteps) yield* bg.drawBridgeTitleSteps(scene, skyCam)
      else if (bg.drawBridgeTitle) bg.drawBridgeTitle(scene, skyCam)
      else bg.drawSky(scene, skyCam, worldCam)
      this.drawHud(scene, world, w, h, dt)
      return
    }
    const master = gpu?.tier === 'master'
    if (routeState?.active) this.lenses.warm()
    // Warm assets behind the menu and fail open to the complete Canvas plate.
    const skyBasis = routeState ? bridgeSkyBasis() : null
    if (gpu || !routeState?.active || this.features.actorMirror === 'off') this.wetStrip.dispose()
    const viewL = worldCam.x - viewHalfW, viewR = worldCam.x + viewHalfW

    // Classify the interpolated root once; share the same ordered work list
    // for grounding and bodies. Keep the incumbent generous envelope until
    // pose/weapon/telegraph extents have their own no-cull reference checks.
    const culledL = viewL - 90, culledR = viewR + 90
    const visible = this.visibleEnemies
    visible.length = 0
    this.cullSkipped = 0
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (e.x >= culledL && e.x <= culledR) visible.push(e)
      else this.cullSkipped++
    }
    this.cullDrawn = visible.length

    const blade = player.ribbonAnchor?.()
    if (routeState) {
      const f = this.bridgeField, { route, gate, clearedGate, quiet } = routeState
      if (this.routeIdentity !== route) { this.bossTint = 0; this.routeIdentity = route }
      this.bossTint = damp(this.bossTint, gate?.state === 'locked' ? 1 : 0, 7, dt)
      const weather = bg.weatherState?.(), front = weather && 'wet' in weather ? weather : null
      const pulse = quiet ? 0 : routeState.opticalPulse
      f.seed = route.seed
      f.begin(worldCam, w, h, front ? (quiet ? 0 : bg.routeTime?.() ?? front.tick * ENV_TICK) : time,
        bridgeRetention(front?.wet ?? .45, bridgeBiomeMix(worldCam.x, route.seed)), front?.fog ?? .27, front?.key ?? 1, moon.keyX, quiet ? 0 : bg.lightningI(), this.bossTint, pulse)
      f.liveSky = !!(gpu && skyBasis && this.bridgeFinish.skyReady && bg.drawBridgeBackdrop)
      const refresh = !f.liveSky || this.bridgeFinish.beginSky(f.thunder, route.seed, w, h, quiet)
      const wind = front?.windX ?? 0
      f.wake = quiet ? 0 : bg.railWake?.(f.weatherTime, worldCam.x) ?? 0
      f.atmo.wake = f.wake; f.atmo.wind = quiet ? 0 : wind
      f.atmo.update(skyBasis, skyCam, w, h, route.seed, bridgeBiomeMix(player.x, route.seed), {
        time: quiet ? 0 : f.weatherTime, drift: quiet ? 0 : bg.routeDrift?.() ?? 0,
        cover: front?.cloud ?? .45, haze: f.fog, flash: f.thunder,
      }, gpu?.tier, !refresh)
      f.keyX = MOON_KEY[0]
      f.impulseLimit = master ? MASTER_FLASH_LIMIT : MOBILE_FLASH_LIMIT
      props.bridgeCasters(f.view.left - 125, f.view.right + 125, (x, width, height, gain) => {
        if (f.propBlockers.length < 4 && gain > .65) f.propBlockers.push({ left: x - width * .5, right: x + width * .5,
          top: -height, bottom: 2, kind: 'cargo' })
      })
      f.gatherBlockers(route, gate, clearedGate, f.propBlockers)
      // Shared source records feed world lights, posed reflections and casts.
      fx.bridgeEmitters(f)
      projectiles.bridgeEmitters(f)
      if (blade) {
        const clr = player.sword.colors.trail
        f.light(BRIDGE_LIGHT.impulse, blade.bx, blade.by, 187, clr, 2.36, 2.52, blade.tx, blade.ty, 0, 19)
      }
      if (pulse > .012) f.light(BRIDGE_LIGHT.impulse, player.x, player.y - 67, 260, '#91d4ff', pulse * 2.9, 11, player.x, player.y - 67, 0, pulse * 25)
      for (const e of visible) e.bridgeEmitter(f)
      f.climate(front?.rain ?? 0, wind + f.wake * .32, quiet ? 0 : bg.routeRainTime?.() ?? f.weatherTime)
      f.gather(route, gate, clearedGate, quiet, master)
      f.stream = world.provisional ? undefined : bg.bridgeStream?.()
      f.streamWindow = (opening ? f.stream?.openingWindow() : f.stream?.requestWindow(f.view.left, f.view.right, worldCam.x)) ?? null
      f.probeWindow = gpu ? this.bridgeFinish.transportWindow(route.seed) : f.streamWindow
      f.uploadQuiet = (world.streamQuiet ?? true) && pulse < .012
      if (gpu) {
        // Restrict the grade's #000 ink swatch to the moving anatomical
        // region; no lookup in the skyline, road, or ordinary near art.
        const x = player.x - worldCam.x, y = player.hipY, r = player.scale * 66
        f.inkBox[0] = x - r; f.inkBox[1] = y - r
        f.inkBox[2] = x + r; f.inkBox[3] = y + r
        const { left, right } = f.view, s = f.sacr
        s.begin(left, right, worldCam.x, master ? SACR_MASTER_K : SACR_MOBILE_K, route, f.probeWindow)
        s.architecture(route, left, right)
        s.actor(player, 0, SACR_PRIORITY.player, undefined, quiet ? undefined : player.bridgeScarfNodes())
        let id = 1
        for (const e of visible) if (e.kind === 'boss' && id < SACR_SOLID_ID) s.actor(e, id++, SACR_PRIORITY.boss, bridgeTint(e.cfg.style.dark))
        f.packReflectedImpulses()
        const nearest = this.reflectorEnemies
        nearest.length = 0
        for (const e of visible) if (e.kind !== 'boss') nearest.push(e)
        nearest.sort((a, b) => Math.abs(a.x - worldCam.x) - Math.abs(b.x - worldCam.x) || a.id - b.id)
        for (const e of nearest) if (id < SACR_SOLID_ID) s.actor(e, id++, SACR_PRIORITY.enemy, bridgeTint(e.cfg.style.dark))
        s.seal()
        if (master && !quiet) f.landingCount = bg.bridgeLandings?.(f.landings, left, right) ?? 0
      }
    }

    const gust = routeState ? Math.max(routeState.opticalPulse, this.bridgeField.impulseGain * .65) : 0
    const field = this.bridgeField
    function* paintSky(g: CanvasRenderingContext2D, sparse: boolean, sliced: boolean): Generator<void> {
      if (routeState && bg.drawBridgeBackdrop) {
        if (sparse) g.clearRect(0, 0, w, h)
        const band = routeState.active && !sparse && opaqueRoadBand(worldCam, w, h)
        if (band) {
          // Canvas would otherwise blend sky, both buildings, mist and
          // street under an opaque roadway. Only omit the proven interior.
          g.save(); g.beginPath(); g.rect(0, 0, w, band[0]); g.rect(0, band[1], w, h - band[1]); g.clip()
        }
        try {
          if (sliced && bg.drawBridgeBackdropSteps) yield* bg.drawBridgeBackdropSteps(g, worldCam, field.atmo, sparse)
          else bg.drawBridgeBackdrop(g, worldCam, field.atmo, gust, sparse)
        } finally { if (band) g.restore() }
      } else bg.drawSky(g, skyCam, worldCam, gpu?.tier, gust)
    }
    if (cold) yield
    yield* paintSky(ctx, this.bridgeField.liveSky, cold)
    if (cold) yield
    ctx.save(); applyWorldCamera()
    if (cold && routeState && bg.drawBridgeRoadSteps) yield* bg.drawBridgeRoadSteps(ctx, worldCam, master, !!gpu)
    else bg.drawArena(ctx, this.forward, worldCam, gust, master, !!gpu,
      world.provisional || (this.bridgeFinish.warming && this.openingAlbedo(w, h, scale)), opening || world.provisional)
    if (cold) yield
    if (gpu) {
      if (routeState) bg.drawRouteExterior?.(ctx, worldCam, routeState.service, 'structure')
      ctx.restore(); ctx = gpu.actors; ctx.save(); applyWorldCamera()
    }

    // Primary Canvas cast is a fallback, not another GPU coverage pass.
    const liveSlope = routeState ? MOON_SLOPE : moonShadowSlope(moon.dir, moon.reach)
    if (!routeState && usesPropShadows(this.features.shadows) && key) props.drawShadows(ctx, moon.dir, moon.reach, viewL, viewR, bg)

    // grounding first, so every figure stands ON its shadow
    const keyGain = bg.keyWeightAt ? 1 : bg.getProfile?.()?.light.key ?? 1
    const moonSlope = usesCastShadow(this.features.shadows) ? liveSlope : 0
    const shade = (actor: ShadowActor, hero: boolean) => {
      const support: Platform | null = (actor.floorY ?? 0) < 0 ? bg.supportAt?.(actor.x) ?? null : null
      this.shade(ctx, bg, actor, moonSlope, keyGain, routeState ? this.bridgeField.keyX : moon.keyX,
        liveMirrors, hero, routeState?.route, master, !!gpu, support)
    }
    shade(player, true)
    for (const e of visible) shade(e, false)
    if (cold) yield

    if (routeState) {
      if (!gpu) {
        this.canvasReceivers.draw(ctx, this.bridgeField, routeState.route)
        bg.drawBridgeWater?.(ctx, worldCam, this.bridgeField.wet)
        if (routeState.active && this.features.actorMirror !== 'off') {
          // Do not allocate or clear an empty strip in a fully dry bay.
          const wet = (actor: ShadowActor) => actor.y >= -70 && (actor.floorY ?? 0) === 0 && (bg.surfaceWetness?.(actor.x) ?? 0) > .005
          if (wet(player) || visible.some(wet)) {
            if (!this.wetStrip.draw(ctx, this.bridgeField, bg, w, g => {
              this.routeMirror(g, player, bg, true, true)
              for (const e of visible) this.routeMirror(g, e, bg, false, true)
            })) this.routeMirror(ctx, player, bg, true)
          }
        }
        drawMobileImpulseReflection(ctx, this.bridgeField, bg)
      }
      if (cold) yield
      this.glass.draw(ctx, this.bridgeField, routeState.route, !!gpu, player)
      if (cold) yield
      routeState.pickups?.draw(ctx, viewL, viewR, time)
      if (routeState.clearedGate) paintGate(ctx, routeState.clearedGate, viewL, viewR, time)
      if (routeState.gate) paintGate(ctx, routeState.gate, viewL, viewR, time)
    }

    props.draw(ctx, viewL, viewR, liveMirrors, routeState ? this.bridgeField : undefined)
    // The Canvas falloff is on scenery, never the Ronin or HUD. The two
    // lean paths rely on bounded local glow instead of an extra GPU pass.
    const lensLimit = this.quality === 'low' ? 2 : 5
    if (routeState?.active) {
      if (!gpu) this.lenses.gloom(ctx, w, h, field)
      if (!master) this.lenses.lenses(ctx, field, lensLimit)
    }
    if (cold) yield

    // ground decals + debris
    fx.drawUnder(ctx)

    const lighting = (actor: ShadowActor) => this.features.rim || routeState ? this.probes.get(actor) : undefined

    // enemies
    const noirEnemies = bg.useQuietEnemyFinish?.() ?? false
    for (const e of visible) e.draw(ctx, time, lighting(e), noirEnemies, !!routeState, 2 / worldCam.zoom)

    // Echoes belong behind the opaque live actor, never on top of its hands/eyes.
    fx.drawSilhouettes(ctx)

    // Physical strike smears (the punch-sheet speed lines) belong behind the
    // opaque contact pose.
    player.drawStrikeSmear(ctx)

    player.draw(ctx, time, false, routeState ? routeState.quiet ? 0 : master ? 5 : 2 : 5)

    // DUST IN THE SHAFTS — air you can see (ultra). Drawn after the players so the
    // motes sit in front of the light rather than behind the fighter.
    if (this.features.dust && particlesDraw(2)) bg.drawMotes?.(ctx, time)

    // projectiles
    projectiles.draw(ctx, time)

    ctx.restore()
    if (cold) yield

    // Authored wetness belongs to the span bake, not to scene pixels.
    if (liveMirrors && (this.features.glitter || (!this.forward && this.features.reflection > 0))) {
      bg.drawReflections?.(ctx, worldCam, this.quality, this.forward)
    }

    ctx.save()
    applyWorldCamera()
    bg.drawFront?.(ctx)
    fx.drawAdditive(ctx, time, blade, master, routeState?.active ? this.lenses : undefined, routeState ? field : undefined)
    fx.drawImpactFrames(ctx)
    if (routeState) {
      bg.drawRouteExterior?.(ctx, worldCam, routeState.service, gpu ? 'foreground' : 'all')
      bg.drawNearRain?.(ctx, worldCam, !!master)
    }
    ctx.restore()

    // Legacy scenes may still use capture optics. In the game arenas the
    // fixture art already owns this contribution; never count it twice.
    if (!bakedOptics && !this.forward && (this.features.godRays || this.features.bloom)) {
      const lights = this.features.godRays ? bg.raySources?.(w,h,{x:cam.x+cam.offX,y:cam.y+cam.offY,zoom:cam.zoom,rot:cam.rot}) : undefined
      this.post.compose(ctx,w,h,lights ?? [],.2,this.features.bloom ? (bg.bloomGain?.() ?? 1) : 0)
    }

    // Screen overlays come AFTER optical capture: a flash is not an emitter.
    // 3. weather (screen space)
    if (!master) bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. screen flash (hit/impact feedback)
    if (!routeState) fx.drawFlash(ctx, w, h)

    fx.drawImpactFocus(ctx, w, h, cam)

    if (cold) yield
    if (gpu && cold && opening) yield* this.bridgeFinish.stageOpening(scene, this.bridgeField, w, h)
    else if (gpu) this.bridgeFinish.present(scene, this.bridgeField, w, h, () => {
      if (!routeState) return
      // Same-turn repair if the context/FBO fails after Canvas went sparse.
      finishPaint(paintSky(scene, false, false))
      scene.save(); applyWorldCamera(scene)
      bg.drawArena(scene, false, worldCam, gust, false, false, true)
      const repair = (a: ShadowActor) => {
        const support = (a.floorY ?? 0) < 0 ? bg.supportAt?.(a.x) : null
        this.shade(scene, bg, a, moonSlope, keyGain, this.bridgeField.keyX, false, a === player,
          routeState.route, false, false, support)
      }
      repair(player); for (const e of visible) repair(e)
      this.canvasReceivers.draw(scene, this.bridgeField, routeState.route)
      bg.drawBridgeWater?.(scene, worldCam, this.bridgeField.wet)
      drawMobileImpulseReflection(scene, this.bridgeField, bg)
      bg.drawRouteExterior?.(scene, worldCam, routeState.service, 'structure')
      this.glass.draw(scene, this.bridgeField, routeState.route, false, player)
      if (routeState.active) {
        this.lenses.gloom(scene, w, h, field)
        if (master) this.lenses.lenses(scene, field, lensLimit)
      }
      scene.restore()
    }, opening)

    // The HUD is never input to the GPU stage. Opening HUD is painted just
    // before publishing, after the first world/post frame is complete.
    if (!opening) this.drawHud(scene, world, w, h, dt)
  }

  drawBridgeEmergency(g: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    // The rich painter may have failed before setting up the work backing.
    // Size it without calling any of the optional renderer's admission code.
    const c = g.canvas, scale = Math.min(1, world.renderScale ?? 1)
    const bw = Math.max(1, Math.floor(w * scale)), bh = Math.max(1, Math.floor(h * scale))
    if (c.width !== bw) c.width = bw
    if (c.height !== bh) c.height = bh
    this.drawBridgeCoverage(g, world, w, h, dt)
  }

  /** Real road, platform, props, actors and tells without any optional
   * backing, WebP, optical bake or readback. Also the safe first-use path. */
  drawBridgeCoverage(g: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    const { cam, routeState, player, enemies, projectiles, time } = world
    this.glass.reset()
    g.setTransform(g.canvas.width / w, 0, 0, g.canvas.height / h, 0, 0)
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#101726'); sky.addColorStop(.63, '#4a5864'); sky.addColorStop(1, '#23303a')
    g.fillStyle = sky; g.fillRect(0, 0, w, h)
    if (!routeState || world.hudState.attract) { this.drawHud(g, world, w, h, dt); return }
    const camera = { x: cam.x + cam.offX, y: cam.y + cam.offY, zoom: cam.zoom, rot: cam.rot }
    g.save(); applySectionView(g, camera, w, h)
    const span = sectionSpan(camera, w, h) * .5 + 120
    const left = camera.x - span, right = camera.x + span, width = span * 2
    for (let i = Math.floor(left / 112), x = i * 112; x < right; x += 112, i++) {
      const t = skyHash(i, 0, routeState.route.seed), top = -347 + 123 * t
      const bw = 74 + 17 * t
      g.fillStyle = i & 1 ? '#273746' : '#2c3d49'; g.fillRect(x, top, bw, STREET_REAR_Y - top)
      g.fillStyle = '#b3a1808c'
      for (let j = 0; j < 6; j++) if (skyHash(i, j, 21) > .31) g.fillRect(x + 7 + (j % 3) * bw * .22, top + 10 + (j / 3 | 0) * 14, 3, 2)
    }
    g.fillStyle = '#14222c'; g.fillRect(left, STREET_REAR_Y, width, h / cam.zoom + 380)
    g.fillStyle = '#344651'; g.fillRect(left, STREET_REAR_Y, width, STREET_FRONT_Y - STREET_REAR_Y)
    g.save(); g.translate(0, RAIL_Y); g.scale(RAIL_MODEL_SCALE, RAIL_MODEL_SCALE)
    const l = railLocalOffset(left), r = railLocalOffset(right), length = (STREET_REAR_Y - RAIL_Y) / RAIL_MODEL_SCALE
    const start = Math.floor(l / RAIL_SUPPORT_PITCH) * RAIL_SUPPORT_PITCH
    g.fillStyle = '#273643'; g.fillRect(l, -41, r - l, 80)
    g.fillStyle = '#91a2a5'; g.fillRect(l, 1, r - l, 1.25); g.fillRect(l, -18, r - l, 1)
    g.beginPath()
    for (let x = start; x < r + RAIL_SUPPORT_PITCH; x += RAIL_SUPPORT_PITCH) {
      g.fillStyle = '#233443'; g.fillRect(x - 22, 26, 44, length - 26)
      g.fillRect(x + RAIL_SUPPORT.left, RAIL_SUPPORT.top, 6, -RAIL_SUPPORT.top + 8)
      const wire = x + RAIL_SUPPORT.arm
      g.moveTo(x + 18, RAIL_SUPPORT.top + 13); g.lineTo(wire, RAIL_SUPPORT.wire)
      g.quadraticCurveTo(wire + RAIL_SUPPORT_PITCH * .5, RAIL_SUPPORT.wire + 8, wire + RAIL_SUPPORT_PITCH, RAIL_SUPPORT.wire)
    }
    g.lineWidth = 1.4; g.strokeStyle = '#314354'; g.stroke(); g.restore()
    g.fillStyle = '#182832'
    for (const c of routeState.route.between(left - 124, right)) {
      const x = c.left + 134 + c.seed % 95
      g.fillRect(x + 6, ROAD.soffit, 84, STREET_FRONT_Y - ROAD.soffit)
    }
    g.fillStyle = '#0e151d'; g.fillRect(left, ROAD.front, width, ROAD.soffit - ROAD.front)
    paintWearingCourse(g, left, right, false)
    g.fillStyle = '#697780'; g.fillRect(left, ROAD.rear, width, 2); g.fillRect(left, ROAD.front - 2, width, 2)
    paintLaneDashes(g, left, right, false)
    for (const chunk of routeState.route.between(left, right)) {
      const { platform, shelter } = chunk, shop = bridgeShop(chunk)
      const shopInView = shop && shop.x + shop.frame.right >= left && shop.x + shop.frame.left <= right
      if (shopInView && !shelter) {
        g.save(); g.translate(chunk.left, 0); paintBridgeDistrict(g, chunk, false); g.restore()
      }
      if (platform) {
        const d = deckFace(chunk)
        g.fillStyle = '#3d4d55'; g.fillRect(platform.left, platform.y, platform.right - platform.left, 'thickness' in d ? d.thickness : d.bottom - platform.y)
        g.fillStyle = '#677a84'; g.beginPath(); deckTopPath(g, platform, d); g.fill()
        g.fillStyle = '#84949d'; g.fillRect(platform.left, platform.y, platform.right - platform.left, 1.25)
      }
      if (shelter) {
        const kit = SHELTER_KIT[shelter.kind]
        g.fillStyle = '#18232c'; g.fillRect(shelter.left + 22, kit.eaveY, shelter.right - shelter.left - 44, ROAD.sidewalk - kit.eaveY)
        g.fillStyle = '#303a3b'; g.fillRect(shelter.left, kit.eaveY - 12, shelter.right - shelter.left, 12)
        g.fillStyle = '#af926a'; g.fillRect(shelter.left + kit.lampX - 18, kit.lampY, 36, 2.5)
        if (shopInView) { g.save(); g.translate(shop.x, 0); paintShopFront(g, shop, false); g.restore() }
        g.fillStyle = '#17232c'
        g.fillRect(shelter.left + 6, kit.eaveY, 6, ROAD.sidewalk - kit.eaveY)
        g.fillRect(shelter.right - 12, kit.eaveY, 6, ROAD.sidewalk - kit.eaveY)
      }
    }
    if (routeState.clearedGate) paintGate(g, routeState.clearedGate, left, right, time)
    if (routeState.gate) paintGate(g, routeState.gate, left, right, time)
    routeState.pickups?.draw(g, left, right, time)
    world.props.drawBasic(g, left, right)
    for (const e of enemies) if (e.x >= left && e.x <= right) e.draw(g, time, undefined, false, true, 2 / cam.zoom)
    player.draw(g, time)
    projectiles.draw(g, time)
    world.fx.drawImpactFrames(g)
    g.restore()
    this.drawHud(g, world, w, h, dt)
  }
}
