/** STICKMAN RISING — render pipeline: sky → world (arena, wet-floor
 * reflections, shadows, entities, additive FX) → weather → vignette →
 * flash → HUD.
 */

import { Camera } from '../core/camera'
import { FX } from '../fx/fx'
import { Enemy } from '../entities/enemy'
import { Player } from '../entities/player'
import { ProjectilePool } from '../entities/projectiles'
import type { BackgroundRenderer } from '../world/background'
import { HUD, HudState } from './hud'
import { GameSettings } from '../core/types'
import { clamp01, rgba } from '../core/utils'
import { KeyLight, keyLightFromStorm, DOOR_LIGHT, STREET_LIGHT, composeShadowKey, drawPropShadow } from './lighting'
import { setSceneKey, setSceneEmitters, REFLECTION } from './look'
import { LightRig, surfaceWash, pointInfluence, type LightInput, type RGB } from './lights'
import { shallowFog } from './bhst'
import { reflectionRefreshKey } from './reflection-key'

/** SELECTIVE BLOOM bright-pass — threshold at the ¼-res downsample so ONLY
 * emissives (moon, neon, windows, glints, sparks, streaks) bloom. Contrast
 * is the selectivity trick: it crushes near-black midtones to 0 and lets
 * >0.5 values through, killing the old full-environment veil. Research:
 * quarter-res `brightness(.75) contrast(2.6) blur(3px)` in ONE filter blit.
 * Cached strings — zero per-frame allocs. */
const BLOOM_BRIGHTPASS = 'brightness(0.72) contrast(2.5)'

/** HALATION — film backscatter always bleeds WARM around the hottest
 * highlights (ARRI/Dehancer science), even from cool sources like the moon.
 * One multiply-tint of the ⅛ blur plate = the whole effect. */
const HALATION_TINT = '#c2522e'

export interface RenderWorld {
  cam: Camera
  fx: FX
  bg: BackgroundRenderer
  enemies: Enemy[]
  player: Player
  projectiles: ProjectilePool
  hud: HUD
  hudState: HudState
  time: number
}

export class Renderer {
  private vignette: HTMLCanvasElement | null = null
  private vigW = 0
  private vigH = 0
  /* wet-floor reflection fade gradient (built once; world-space strip) */
  private reflFade: HTMLCanvasElement | null = null
  /* broken-mirror plate: the reflection is rendered once, then blitted back
   * in strips with a high-frequency horizontal wave (wet concrete, not glass) */
  private reflPlate: HTMLCanvasElement | null = null
  private reflPW = 0
  /* reflection atlas: full refresh identity (span, tier, camera origin,
   * realloc, player pose/root, actor membership) + atlas-period fallback;
   * time = last refresh. See render/reflection-key.ts (plan F07). */
  private reflKey = ''
  private reflTime = -9
  private reflSX0 = 0
  private reflSpan = 0
  /** world x of plate column 0 at draw time — the blit anchor on a hit */
  private reflViewLeft = 0
  /** retained actor descriptors for the key (no per-frame allocation) */
  private reflSigPool: { id: number; x: number; y: number; face?: 1 | -1; state?: string }[] = []
  /** 2D light transport: the live lights LAND on the scene (see lights.ts) */
  private rig = new LightRig()
  /** frame pools — no per-frame allocations (VRAM/GC discipline) */
  private lightPool: LightInput[] = []
  private figPool: { x: number; y: number }[] = []
  private reflPH = 0
  /* CINEMATIC BLOOM — two-bounce downsample/upsample pyramid. The finished
   * frame is copied to a quarter-res plate, blurred again to eighth-res,
   * smooth-upsampled and added back with 'lighter'. On a near-black neon
   * scene the darks contribute almost nothing while every light source
   * (neon signs, blade glow, lightning, rain glints) spills a soft halo —
   * the look that instantly reads as "produced". Cost: three low-res blits. */
  private bloomA: HTMLCanvasElement | null = null
  private bloomB: HTMLCanvasElement | null = null
  private bloomNative: HTMLCanvasElement | null = null
  private bloomW = 0
  private bloomH = 0
  private bloomNW = 0
  private bloomNH = 0
  private bloomTick = 0
  private bloomDirty = true
  /* ANAMORPHIC STRIPE — pre-baked horizontal lens streak (blue-white core,
   * long soft falloff) flashed across the sky where lightning strikes. */
  private streakSpr: HTMLCanvasElement | null = null
  /* FILM GRADE plate — pre-baked vertical color gradient (cool sky shadow
   * lift, warm city bounce below) blended 'lighter' to give the blacks a
   * color instead of dead gray. Baked at viewport resolution so the per-
   * frame blit is 1:1 (upscaling an 8×256 strip with bilinear smoothing
   * cost ~6.25ms/frame vs ~1.08ms for a 1:1 blit). */
  private gradePl: HTMLCanvasElement | null = null
  private gradeW = 0
  private gradeH = 0
  /* film grain: pre-baked quarter-res noise PLATES + animated blit.
   * The old live pattern-fill (160×160 tile × ~40 repeats over the full
   * canvas, every frame, with alpha blending) measured up to 27ms/frame on
   * software raster — THE frame-rate killer when waves arrived. The plates
   * are drawn at quarter resolution with nearest-neighbor upscale (chunky
   * 16mm-style grain) at half/third refresh — visually identical whisper,
   * ~20× cheaper. */
  private grainPlates: HTMLCanvasElement[] = []
  private grainW = 0
  private grainH = 0
  private grainFlip = 0
  /* Dedicated LCG for grain (plan M08): draw-time randomness must never
   * consume the global RNG stream shared with gameplay and audio. */
  private grainSeed = 0x9e3779b9
  private grainRand(): number {
    this.grainSeed = (Math.imul(this.grainSeed, 1664525) + 1013904223) >>> 0
    return this.grainSeed / 4294967296
  }
  private quality: GameSettings['quality'] = 'high'

  draw(ctx: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    const { cam, fx, bg, player, enemies, projectiles, hud, hudState } = world
    const time = world.time

    // 1. sky (screen space, own parallax)
    bg.drawSky(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 2. world pass
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(cam.rot)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-(cam.x + cam.offX), -(cam.y + cam.offY))

    const viewHalfW = w / (2 * cam.zoom) + 240

    // arena floor
    bg.drawArena(ctx)

    // wet-ground reflections: entities mirrored about y=0, foreshortened,
    // fading with depth — the rain-soaked roof reads as a black mirror and
    // snaps brighter whenever lightning strobes it
    this.drawReflections(ctx, world, viewHalfW)

    // WET-DECK ROUGHNESS: matte islands + striation chop the mirror, sharp
    // puddle windows let it through (static pre-baked world-space plate)
    bg.drawWetMask(ctx)

    // TYPED LIGHT RIG (UE archetypes): directional key's diffuse pool (the
    // LIT SURFACE the shadows read against), the moon's specular glitter
    // lane on the wet mirror, sweeping spot pools, vent steam
    const moonWorldX = cam.x + cam.offX + (bg.moonX - w / 2) / cam.zoom
    const moonWorldY = cam.y + cam.offY + (bg.moonY - h / 2) / cam.zoom
    bg.drawLightRig(ctx, moonWorldX, moonWorldY)

    // ---- LIGHTING ENGINE: one dynamic key light (moon ↔ storm strobes)
    // drives PROJECTED SKELETON SHADOWS for every entity: each solved joint
    // (and the blade) casts along the light rays onto the ground plane —
    // the shadow deforms with the pose, stretches away from bolts, detaches
    // and fades when airborne, and carries contact-AO cores under the
    // legik-planted feet. Replaces the static blob ellipses. ----
    const li = bg.lightningI()
    const az = bg.lightningAz()
    const light: KeyLight = keyLightFromStorm(li, az)
    // UNIVERSAL LOOK: the rim/reflection rules read the live key each frame;
    // practical lights feed the light-transport fill automatically
    setSceneKey(light)
    setSceneEmitters([DOOR_LIGHT, STREET_LIGHT])
    // ECLIPSE — cloud mass crossing the moon dims + softens the key, so the
    // long deck shadows breathe as the banks drift over the disc
    light.i *= 1 - 0.42 * bg.moonCover
    light.hard *= 1 - 0.32 * bg.moonCover
    // UNIFIED RESULTANT SHADOW VECTOR — instead of casting 3–4 separate
    // full-body shadows per entity (moon + door + streetlamp), solve the
    // single resultant ground-plane light vector at each caster's world X/Y.
    if (Math.abs(DOOR_LIGHT.x - cam.x) < viewHalfW + 300) {
      drawPropShadow(ctx, light, DOOR_LIGHT.x, 66, -118, 0.26)
    }
    if (Math.abs(STREET_LIGHT.x - cam.x) < viewHalfW + 300) {
      drawPropShadow(ctx, light, STREET_LIGHT.x, 5, -262, 0.20)
    }
    player.drawShadow(ctx, composeShadowKey(light, player.x, player.y))
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.drawShadow(ctx, composeShadowKey(light, e.x, e.y))
    }

    // KINETIC SHALLOW-STRATA WAKE FOG (BHST):
    // The 64-cell field is STEPPED and INJECTED by Game.updateWakeFog on
    // the visual clock (once per frame) — draw is a pure consumer now
    // (plan F14/M08: paused or repeated draws must not mutate world state).
    // Here we only draw the low-stature ankle-hugging vapor ribbon.
    const viewLeft = cam.x + cam.offX - viewHalfW
    const viewRight = cam.x + cam.offX + viewHalfW
    shallowFog.drawWorld(
      ctx,
      viewLeft,
      viewRight,
      moonWorldX,
      1 - clamp01(bg.moonCover),
      clamp01(li),
      this.quality,
    )

    // STROBE RIM: light the casters — every figure's bolt-facing edge
    // catches the flash (flickering with the ~15Hz restrike cadence)
    const strobeK = clamp01(li) * (0.78 + 0.22 * Math.sin(time * 43))
    player.strobeLight = light
    player.strobeK = strobeK
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      e.strobeLight = light
      e.strobeK = strobeK
    }

    // ground decals + debris
    fx.drawUnder(ctx)

    // enemies
    for (const e of enemies) {
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.draw(ctx, time)
    }

    // Echoes belong behind the opaque live actor, never on top of its hands/eyes.
    fx.drawSilhouettes(ctx)

    // Physical strike smears (the punch-sheet speed lines) belong behind the
    // opaque contact pose.
    player.drawStrikeSmear(ctx)

    // player
    player.draw(ctx, time)

    // projectiles
    projectiles.draw(ctx, time)

    // additive FX (trails, HDR motion lines, particles, rings, ghosts)
    fx.drawAdditive(ctx, time)

    // MANGA IMPACT FRAMES — black spikes punch through the glow layer
    fx.drawImpactFrames(ctx)

    ctx.restore()

    // 2. LIGHT TRANSPORT (2D deferred pass, UE-style lights on the web):
    // the albedo above is modulated by the LIVE lights — the moon's
    // directional field from its real position, the practicals' inverse-
    // square pools, the god-ray landing pools, ambient sky fill. Light
    // LANDS on surfaces with falloff; nothing floats over the frame.
    {
      const li2 = clamp01(bg.lightningI())
      const vis = 1 - clamp01(bg.moonCover)
      const sx = (wx: number) => w / 2 + (wx - cam.x - cam.offX) * cam.zoom
      const sy = (wy: number) => h / 2 + (wy - cam.y - cam.offY) * cam.zoom
      const moonL: RGB = [186, 214, 236]
      const warm: RGB = [255, 154, 77]
      const cool: RGB = [150, 205, 240]
      const lights = this.lightPool
      lights.length = 0
      lights.push(
        // MOON — directional field from the disc's live screen position
        { kind: 'dir', x: bg.moonX, y: bg.moonY, range: 0, intensity: 0.36 * vis + 0.62 * li2, color: moonL },
        // PRACTICALS — inverse-square pools, only touching what is near
        { kind: 'point', x: sx(DOOR_LIGHT.x), y: sy(DOOR_LIGHT.y), range: DOOR_LIGHT.range * cam.zoom * 0.75, intensity: 0.34, color: warm },
        { kind: 'point', x: sx(STREET_LIGHT.x), y: sy(STREET_LIGHT.y), range: STREET_LIGHT.range * cam.zoom * 0.75, intensity: 0.30, color: cool },
        // GOD-RAY LANDING POOLS — the shaft fan lands ON the deck as light
        // spots, breathing with the cloud gaps (dynamic, physics-driven)
        { kind: 'point', x: bg.moonX - w * 0.1, y: h * 0.62, range: w * 0.2, intensity: 0.14 * vis, color: moonL },
        { kind: 'point', x: bg.moonX + w * 0.08, y: h * 0.63, range: w * 0.17, intensity: 0.11 * vis, color: moonL },
      )
      // STORM STROBES light the whole world from the bolt's azimuth
      if (li2 > 0.02) {
        const bx = w * (0.5 + 0.45 * bg.lightningAz())
        lights.push({ kind: 'point', x: bx, y: -h * 0.2, range: Math.hypot(w, h) * 1.2, intensity: 0.55 * li2, color: [190, 214, 255] })
      }
      this.rig.render(w, h, [118, 126, 144], lights)
      this.rig.composite(ctx, w, h, this.quality === 'ultra' ? 0.04 : 0)

      // N·L SURFACE WASH — the source ON the bodies: every figure's lit edge
      // faces the moon's live position (dimming under cloud), warm bounce
      // arrives from the practicals by distance. The player is lit BECAUSE
      // the sources are lit — not because a wash is hardcoded.
      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.scale(cam.zoom, cam.zoom)
      ctx.translate(-(cam.x + cam.offX), -(cam.y + cam.offY))
      const moonWX = cam.x + cam.offX + (bg.moonX - w / 2) / cam.zoom
      const moonWY = cam.y + cam.offY + (bg.moonY - h / 2) / cam.zoom
      const figs = this.figPool
      figs.length = 0
      figs.push({ x: player.x, y: player.y })
      for (const e of enemies) {
        if (e.dead || e.spawning) continue
        if (Math.abs(e.x - cam.x) > w / cam.zoom) continue
        figs.push({ x: e.x, y: e.y })
      }
      for (const f of figs) {
        surfaceWash(ctx, f.x, f.y, moonWX, moonWY, 0.20 * vis + 0.34 * li2, moonL, 44, 58, 148)
        surfaceWash(ctx, f.x, f.y, DOOR_LIGHT.x, DOOR_LIGHT.y, 0.17 * pointInfluence(DOOR_LIGHT.x, DOOR_LIGHT.y, f.x, f.y, DOOR_LIGHT.range), warm, 42, 54, 140)
        surfaceWash(ctx, f.x, f.y, STREET_LIGHT.x, STREET_LIGHT.y, 0.14 * pointInfluence(STREET_LIGHT.x, STREET_LIGHT.y, f.x, f.y, STREET_LIGHT.range), cool, 42, 54, 140)
      }
      ctx.restore()
    }

    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 3.25 MOON GOD-RAY SHAFTS — occlusion → radial smear → additive
    this.drawMoonShafts(ctx, w, h, world)

    // 3.5 CINEMATIC BLOOM — selective: emissives spill a soft halo; the
    // storm's relight event pulses the whole bloom energy
    this.drawBloom(ctx, w, h, clamp01(li))

    // 3.6 ANAMORPHIC STRIKE STREAKS — horizontal lens flare while the sky
    // strobes (the filmic signature of a lightning-lit frame)
    this.drawStrikeStreaks(ctx, w, h, world)

    // 4. chromatic aberration (lens strain on dashes / heavy impacts)
    this.drawChroma(ctx, w, h, fx.caIntensity)

    // 5. vignette
    this.drawVignette(ctx, w, h)

    // 5.5 FILM GRADE — cool shadow lift + warm horizon bounce
    this.drawGrade(ctx, w, h)

    // 6. film grain — 3.5% monochrome noise ties 2D art + FX into one film
    this.drawGrain(ctx, w, h)

    // 7. screen flash
    fx.drawFlash(ctx, w, h)

    // 8. HUD
    hud.draw(ctx, w, h, hudState, dt)
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.vignette || this.vigW !== w || this.vigH !== h) {
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.floor(w))
      c.height = Math.max(2, Math.floor(h))
      const vctx = c.getContext('2d')
      if (vctx) {
        // two nested falloffs: a broad soft one for shaping + a tighter one
        // that pulls the far corners down — cinematic without tunneling
        const g = vctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.78)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(0.62, 'rgba(3,6,14,0.18)')
        g.addColorStop(1, 'rgba(2,4,10,0.52)')
        vctx.fillStyle = g
        vctx.fillRect(0, 0, w, h)
        const g2 = vctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.62, w / 2, h * 0.46, Math.max(w, h) * 0.92)
        g2.addColorStop(0, 'rgba(0,0,0,0)')
        g2.addColorStop(1, 'rgba(1,2,6,0.34)')
        vctx.fillStyle = g2
        vctx.fillRect(0, 0, w, h)
      }
      this.vignette = c
      this.vigW = w
      this.vigH = h
    }
    ctx.drawImage(this.vignette, 0, 0, w, h)
  }

  /** CINEMATIC BLOOM — downsample the finished frame to ⅛-res and add it
   * back with 'lighter'. The old path copied to ¼-res, ran two self-
   * multiply passes on the ¼-res canvas, downsampled to ⅛, re-upsampled to
   * ¼, and then did THREE full-screen composites (lighter + screen +
   * halation lighter) — ~27ms/frame and 3 screens of full-res overdraw.
   *
   * The rewrite keeps the look and removes the resample: the frame is
   * copied ONCE into an ⅛-res buffer, then up-sampled ONCE into a 1:1
   * device-pixel plate and composited with an unscaled (therefore SIMD
   * fast-path) 'lighter' blit. On software Canvas2D that is 4.18 ms instead
   * of 27.12 ms. Both the downsample and the up-sample now run on the same
   * cadence, and an active lightning strobe forces a refresh, so the bloom
   * pulses with the bolt. */
  private drawBloom(ctx: CanvasRenderingContext2D, w: number, h: number, relight = 0): void {
    if (this.quality === 'low') return
    const cw = Math.max(8, ctx.canvas.width), ch = Math.max(8, ctx.canvas.height)
    const sw = Math.max(2, cw >> 3), sh = Math.max(2, ch >> 3)
    const nw = cw, nh = ch
    if (!this.bloomA || this.bloomW !== sw || this.bloomH !== sh) {
      this.bloomA = document.createElement('canvas')
      this.bloomA.width = sw
      this.bloomA.height = sh
      this.bloomB = document.createElement('canvas')
      this.bloomB.width = sw
      this.bloomB.height = sh
      this.bloomW = sw
      this.bloomH = sh
      this.bloomTick = 0
    }
    if (!this.bloomNative || this.bloomNW !== nw || this.bloomNH !== nh) {
      this.bloomNative = document.createElement('canvas')
      this.bloomNative.width = nw
      this.bloomNative.height = nh
      this.bloomNW = nw
      this.bloomNH = nh
      this.bloomTick = 0
      this.bloomDirty = true
    }
    const q = this.quality
    const cadence = q === 'ultra' || relight > 0.05 ? 1 : q === 'high' ? 2 : 3
    const refresh = this.bloomTick % cadence === 0 || this.bloomDirty
    if (refresh) {
      const a = this.bloomA.getContext('2d')
      const nc = this.bloomNative.getContext('2d')
      if (a && nc) {
        a.imageSmoothingEnabled = true
        a.globalCompositeOperation = 'copy'
        a.drawImage(ctx.canvas, 0, 0, cw, ch, 0, 0, sw, sh)
        a.globalCompositeOperation = 'source-over'
        // Pre-upsample once into the 1:1 native plate so the per-frame
        // composite hits the unscaled 1:1 SIMD 'lighter' fast path
        // (~1.2ms vs ~5.9ms for a scaled blit).
        nc.imageSmoothingEnabled = true
        nc.globalCompositeOperation = 'copy'
        nc.drawImage(this.bloomA, 0, 0, sw, sh, 0, 0, nw, nh)
        nc.globalCompositeOperation = 'source-over'
      }
      this.bloomDirty = false
    }
    this.bloomTick++

    const pulse = 1 + 0.55 * relight
    const alpha = (q === 'ultra' ? 0.30 : q === 'high' ? 0.24 : 0.18) * pulse
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = alpha
    ctx.drawImage(this.bloomNative, 0, 0)
    if (q === 'ultra') {
      const b = this.bloomB!.getContext('2d')
      if (b) {
        b.clearRect(0, 0, sw, sh)
        b.drawImage(this.bloomA, 0, 0)
        b.globalCompositeOperation = 'multiply'
        b.fillStyle = HALATION_TINT
        b.fillRect(0, 0, sw, sh)
        b.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 0.085 * (1 + 0.45 * relight)
        ctx.drawImage(this.bloomB!, 0, 0, nw, nh)
      }
    }
    ctx.restore()
  }

  /** MOON GOD-RAY SHAFTS — GPU Gems 3 recipe, Canvas2D at ⅛-res:
   *  1) occlusion mask: moon glow bright, skyline + clouds dark
   *  2) radial smear outward from the moon (zoom blur, 5–9 cheap blits)
   *  3) additive composite, eclipse + lightning coupled, slow breathing.
   *  Skipped when the active background already paints its own shaft fan
   *  (`bg.ownsMoonShafts`) so two independent shaft systems never stack on
   *  the same sky. Shirogane supplies drawShaftMask for THIS pass instead. */
  private shaftA: HTMLCanvasElement | null = null
  private shaftB: HTMLCanvasElement | null = null
  private shaftW = 0
  private shaftH = 0

  private drawMoonShafts(ctx: CanvasRenderingContext2D, w: number, h: number, world: RenderWorld): void {
    if (this.quality === 'low') return
    const { bg, cam } = world
    if (bg.ownsMoonShafts) return
    const cover = bg.moonCover
    if (cover > 0.88) return                      // fully caged → no rays
    const qw = Math.max(2, w >> 3), qh = Math.max(2, h >> 3)
    if (!this.shaftA || this.shaftW !== qw || this.shaftH !== qh) {
      this.shaftA = document.createElement('canvas')
      this.shaftA.width = qw
      this.shaftA.height = qh
      this.shaftB = document.createElement('canvas')
      this.shaftB.width = qw
      this.shaftB.height = qh
      this.shaftW = qw
      this.shaftH = qh
    }
    const a = this.shaftA!.getContext('2d'), b = this.shaftB!.getContext('2d')
    if (!a || !b) return
    // 1 — occlusion mask in screen coords (bg knows the moon + skyline)
    a.setTransform(qw / w, 0, 0, qh / h, 0, 0)
    a.clearRect(0, 0, w, h)
    bg.drawShaftMask(a, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })
    // 2 — radial smear outward from the moon: each step scales the mask up
    // around the moon point with decaying alpha (the zoom-blur god rays)
    const mx = bg.moonX * (qw / w), my = bg.moonY * (qh / h)
    b.setTransform(1, 0, 0, 1, 0, 0)
    b.clearRect(0, 0, qw, qh)
    b.globalCompositeOperation = 'lighter'
    const n = this.quality === 'ultra' ? 9 : 5
    for (let i = 1; i <= n; i++) {
      const s = 1 + i * 0.08
      b.globalAlpha = Math.pow(0.8, i) * 1.05
      b.drawImage(this.shaftA!, mx - mx * s, my - my * s, qw * s, qh * s)
    }
    b.globalAlpha = 1
    b.globalCompositeOperation = 'source-over'
    // 3 — additive composite: rays breathe, flash with the storm, and die
    // as the eclipse closes over the disc
    const li = clamp01(bg.lightningI())
    const str = 0.31 * Math.pow(1 - cover, 1.5) * (this.quality === 'ultra' ? 1 : 0.72)
      * (1 + li * 1.3) * (0.82 + 0.18 * Math.sin(world.time * 0.22))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(0.42, str)
    ctx.drawImage(this.shaftB!, 0, 0, w, h)
    ctx.restore()
  }

  /** ANAMORPHIC STRIKE STREAKS — while lightning owns the sky, a long
   * horizontal lens streak burns across the strike azimuth. Pre-baked
   * sprite, one additive blit. */
  private drawStrikeStreaks(ctx: CanvasRenderingContext2D, w: number, h: number, world: RenderWorld): void {
    if (this.quality === 'low') return
    const k = clamp01(world.bg.lightningI())
    if (k <= 0.03) return
    if (!this.streakSpr) {
      const c = document.createElement('canvas')
      c.width = 512
      c.height = 48
      const g = c.getContext('2d')
      if (g) {
        const gr = g.createLinearGradient(0, 0, 512, 0)
        gr.addColorStop(0, 'rgba(120,170,255,0)')
        gr.addColorStop(0.28, 'rgba(150,195,255,0.16)')
        gr.addColorStop(0.5, 'rgba(220,238,255,0.5)')
        gr.addColorStop(0.72, 'rgba(150,195,255,0.16)')
        gr.addColorStop(1, 'rgba(120,170,255,0)')
        g.fillStyle = gr
        // vertical core falloff baked by drawing the strip twice, squashed
        g.fillRect(0, 14, 512, 20)
        g.globalAlpha = 0.55
        g.fillRect(0, 6, 512, 36)
        g.globalAlpha = 0.3
        g.fillRect(0, 0, 512, 48)
      }
      this.streakSpr = c
    }
    const az = world.bg.lightningAz()
    const cx = w * (0.5 + az * 0.4)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = k * 0.55
    ctx.drawImage(this.streakSpr, cx - w * 0.62, h * 0.2 - 24, w * 1.24, 48)
    ctx.globalAlpha = k * 0.22
    ctx.drawImage(this.streakSpr, cx - w * 0.78, h * 0.2 - 60, w * 1.56, 120)
    ctx.restore()
  }

  /** FILM GRADE — the blacks get a color: cool blue lift from the sky down,
   * a whisper of warm city bounce near the floor line. Subtle enough to
   * never wash the contrast, strong enough that pure black stops reading as
   * "unrendered". */
  private drawGrade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.quality === 'low') return
    const gw = Math.max(2, Math.floor(w)), gh = Math.max(2, Math.floor(h))
    if (!this.gradePl || this.gradeW !== gw || this.gradeH !== gh) {
      const c = document.createElement('canvas')
      c.width = gw
      c.height = gh
      const g = c.getContext('2d')
      if (g) {
        const gr = g.createLinearGradient(0, 0, 0, gh)
        gr.addColorStop(0, 'rgba(36,62,116,0.075)')
        gr.addColorStop(0.45, 'rgba(24,38,74,0.03)')
        gr.addColorStop(0.62, 'rgba(30,32,60,0.02)')
        gr.addColorStop(0.8, 'rgba(84,42,44,0.028)')
        gr.addColorStop(1, 'rgba(110,58,36,0.05)')
        g.fillStyle = gr
        g.fillRect(0, 0, gw, gh)
      }
      this.gradePl = c
      this.gradeW = gw
      this.gradeH = gh
    }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(this.gradePl, 0, 0, w, h)
    ctx.restore()
  }

  /** CHROMATIC ABERRATION — selective edge lens strain. A true per-pixel
   * channel split is not tractable in Canvas2D; the anime-honest version
   * tints opposing screen edges red/cyan (radial CA's visible symptom) and
   * only while the camera is being strained (dash / heavy connect). */
  private drawChroma(ctx: CanvasRenderingContext2D, w: number, h: number, i: number): void {
    if (this.quality === 'low' || this.quality === 'medium') return
    if (i <= 0.02) return
    ctx.save()
    const a = 0.1 * Math.min(1, i)
    const g1 = ctx.createLinearGradient(0, 0, w * 0.3, 0)
    g1.addColorStop(0, rgba('#ff2a46', a))
    g1.addColorStop(1, rgba('#ff2a46', 0))
    ctx.fillStyle = g1
    ctx.fillRect(0, 0, w * 0.3, h)
    const g2 = ctx.createLinearGradient(w, 0, w * 0.7, 0)
    g2.addColorStop(0, rgba('#31e6ff', a))
    g2.addColorStop(1, rgba('#31e6ff', 0))
    ctx.fillStyle = g2
    ctx.fillRect(w * 0.7, 0, w * 0.3, h)
    ctx.restore()
  }

  /** quality tier — gates the grain cadence ('low' drops it entirely).
   * Set by Game.applySettings / the auto-resolution governor. */
  setQuality(q: GameSettings['quality']): void {
    this.quality = q
  }

  /** FILM GRAIN — pre-baked quarter-res noise plates, cycled randomly and
   * blitted with nearest-neighbor upscale at reduced refresh (15Hz high /
   * 10Hz medium / off low). The dest-pixel blend is the irreducible cost on
   * software raster (~15ms/frame at 30Hz measured), so the cadence — not
   * the source resolution — is the lever. A 3% whisper grain stepping at
   * 15Hz reads exactly like 24fps film projected at 60: authentic. */
  private drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.quality === 'low') return
    const cadence = this.quality === 'medium' ? 6 : 4
    this.grainFlip = (this.grainFlip + 1) % cadence
    if (this.grainFlip !== 0) return
    if (!this.grainPlates.length || this.grainW !== w || this.grainH !== h) {
      // bake 4 independent plates: quarter-res monochrome noise with the
      // 3% whisper alpha baked INTO the pixels (no globalAlpha blend cost)
      const pw = Math.max(2, (w / 4) | 0)
      const ph = Math.max(2, (h / 4) | 0)
      this.grainPlates = []
      for (let k = 0; k < 4; k++) {
        const c = document.createElement('canvas')
        c.width = pw
        c.height = ph
        const g = c.getContext('2d')
        if (!g) continue
        const img = g.createImageData(pw, ph)
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 118 + (this.grainRand() * 2 - 1) * 74
          img.data[i] = v
          img.data[i + 1] = v
          img.data[i + 2] = v
          img.data[i + 3] = 7 // ≈ 0.028 baked-in
        }
        g.putImageData(img, 0, 0)
        this.grainPlates.push(c)
      }
      this.grainW = w
      this.grainH = h
    }
    if (!this.grainPlates.length) return
    const plate = this.grainPlates[(this.grainRand() * this.grainPlates.length) | 0]
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(plate, 0, 0, w, h)
    ctx.restore()
  }

  /** wet-floor mirror pass — the 2D-native take on ray-traced reflections:
   *  every entity is re-drawn mirrored about the ground plane with vertical
   *  foreshortening, then melted into the dark facade by a depth gradient.
   *  The PLAYER keeps its full-detail redraw; ENEMIES use the cheap single-
   *  pass ghost (full detail × N enemies × 2 passes was a quiet frame-rate
   *  killer once waves scaled — the mirror only needs a silhouette). */
  private drawReflections(ctx: CanvasRenderingContext2D, world: RenderWorld, viewHalfW: number): void {
    const { bg, cam, player, enemies, time } = world
    const li = bg.lightningI()
    const depth = REFLECTION.depth
    const pw = Math.max(64, Math.ceil(viewHalfW * 2)), ph = depth + 8
    // REALLOCATION IS DIRTY (plan F07): captured BEFORE reflPW/reflPH are
    // assigned — the old dirty test compared them after the assignment, so
    // a fresh EMPTY plate never qualified and stayed black until the timer.
    const realloc = !this.reflPlate || this.reflPW !== pw || this.reflPH !== ph
    if (realloc) {
      const c = document.createElement('canvas')
      c.width = pw
      c.height = ph
      this.reflPlate = c
      this.reflPW = pw
      this.reflPH = ph
    }
    const p = this.reflPlate!.getContext('2d')
    if (!p) return

    // Actor-AABB Frustum Culling: only clear and strip-blit the horizontal
    // span of the wet floor that actually contains reflected figures (~260px
    // solo vs 1760px full viewport).
    const viewLeft = cam.x - viewHalfW
    let minX = player.x - 130
    let maxX = player.x + 130
    if (this.quality !== 'low') {
      for (const e of enemies) {
        if (e.dead || e.spawning) continue
        if (Math.abs(e.x - cam.x) > viewHalfW) continue
        if (e.x - 110 < minX) minX = e.x - 110
        if (e.x + 110 > maxX) maxX = e.x + 110
      }
    }
    const sx0 = Math.max(0, Math.floor(minX - viewLeft))
    const sx1 = Math.min(pw, Math.ceil(maxX - viewLeft))
    const spanW = sx1 - sx0
    if (spanW <= 0) return

    // REFRESH IDENTITY (plan F07): span + tier + camera origin + realloc +
    // player root/facing/state + live enemy membership/roots. The old
    // (span, quality) key aliased same-width camera pans and moved or
    // spawned actors; its "<1.5 px at 20 Hz" claim was arithmetically
    // wrong (2 600 px/s × 50 ms = 130 world px) — the atlas PERIOD remains
    // only as a fallback bound for pose-internal limb motion, which this
    // key cannot see. Error-gated refresh (MCRI, plan M4) supersedes it.
    const sig = this.reflSigPool
    sig.length = 0
    sig.push({ id: -1, x: player.x, y: player.y, face: player.face, state: player.state })
    if (this.quality !== 'low') {
      for (const e of enemies) {
        if (e.dead || e.spawning) continue
        if (Math.abs(e.x - cam.x) > viewHalfW) continue
        sig.push({ id: e.id, x: e.x, y: e.y, face: e.face, state: e.state })
      }
    }
    const key = reflectionRefreshKey({
      spanW,
      tier: this.quality === 'ultra' ? 4 : this.quality === 'high' ? 2 : this.quality === 'medium' ? 1 : 0,
      viewLeft,
      realloc,
      player: sig[0],
      enemies: sig,
      enemyFrom: 1,
    })
    const needRefresh =
      realloc ||
      this.reflKey !== key ||
      time - this.reflTime >= REFLECTION.atlasHz ||
      li > 0.05
    if (needRefresh) {
      p.clearRect(sx0, 0, spanW, ph)
      p.save()
      p.translate(-viewLeft, 0)
      p.scale(1, -0.58) // shallower ground-mirror foreshortening (less vertical stature)
      player.draw(p, time, true)
      p.globalAlpha = 0.8
      if (this.quality !== 'low') {
        for (const e of enemies) {
          if (e.dead || e.spawning) continue
          if (Math.abs(e.x - cam.x) > viewHalfW) continue
          e.drawGhost(p, time)
        }
      }
      p.restore()
      // Apply vertical depth fade INSIDE the reflection plate over [sx0, sx1]
      // with destination-in so we never have to stretch an 8×256 fade canvas
      // across the entire 1760px viewport floor.
      if (!this.reflFade) {
        const c = document.createElement('canvas')
        c.width = 16
        c.height = ph
        const fc = c.getContext('2d')
        if (fc) {
          const g = fc.createLinearGradient(0, 0, 0, ph)
          g.addColorStop(0, 'rgba(0,0,0,1)')
          g.addColorStop(0.35, 'rgba(0,0,0,0.62)')
          g.addColorStop(0.72, 'rgba(0,0,0,0.12)')
          g.addColorStop(1, 'rgba(0,0,0,0)')
          fc.fillStyle = g
          fc.fillRect(0, 0, 16, ph)
        }
        this.reflFade = c
      }
      p.globalCompositeOperation = 'destination-in'
      p.drawImage(this.reflFade, 0, 0, 16, ph, sx0, 0, spanW, ph)
      p.globalCompositeOperation = 'source-over'
      this.reflKey = key
      this.reflTime = time
      this.reflSX0 = sx0
      this.reflSpan = spanW
      this.reflViewLeft = viewLeft
    }
    // On a hit the plate keeps the WORLD ANCHOR it was drawn for — blitting
    // it at the current viewLeft instead would slide the reflection off its
    // actors during a pan (same-width pans never changed the old key).
    const sxA = this.reflSX0
    const spanA = this.reflSpan

    // BROKEN MIRROR: blit only the active [sx0, sx1] actor span in strips
    const a = REFLECTION.opacity + li * REFLECTION.strobeGain
    ctx.save()
    ctx.globalAlpha = a
    const n = this.quality === 'low' ? 6 : this.quality === 'medium' ? 8 : 10
    const sh = ph / n
    const dstX = this.reflViewLeft + sxA
    for (let i = 0; i < n; i++) {
      const wave = Math.sin(time * REFLECTION.waveFreq + i * 1.7) * REFLECTION.waveAmp
        + Math.sin(time * REFLECTION.waveFreq2 + i * 4.1) * REFLECTION.waveAmp2
      ctx.drawImage(this.reflPlate!, sxA, i * sh, spanA, sh + 1, dstX + wave, i * sh, spanA, sh + 1)
    }
    ctx.restore()
  }
}
