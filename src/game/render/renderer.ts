import { ROAD } from '../stage/road-section'
/** STICKMAN RISING — render pipeline.
 *
 *   sky → world (arena, props, entities, FX) → reflection → weather → flash
 *        → [ULTRA: god rays, bloom] → HUD
 *
 * Still no shaders and no WebGL: every pass is Canvas2D blits, because the frame
 * budget belongs to the simulation. But the old header claimed there were no
 * full-screen passes at all, and that stopped being true when ultra got its own
 * stack (render/post.ts): one shared low-resolution capture, off on
 * every other tier. The tier table owns whether they run, `post.ts` owns what
 * they cost, and `tests/ultra-stack.test.ts` owns the receipt.
 */

import { newProbe, type Probe } from '../lighting/ribbons'
import { LIGHT_INK } from '../world/lightfield'
import { directionalProjection } from '../world/light'
import { featuresFor, type GraphicsFeatures, type Tier } from './graphics'
import { shadowLength, shadowOutline, type ShadowActor, drawCastShadow, drawContactAO, usesCastShadow, usesPropShadows } from './shadows'
import { Camera } from '../core/camera'
import { FX } from '../fx/fx'
import { Enemy } from '../entities/enemy'
import { Player } from '../entities/player'
import { ProjectilePool } from '../entities/projectiles'
import type { BackgroundRenderer } from '../world/background'
import type { PropField } from '../world/props'
import { HUD, HudState } from './hud'
import { PostStack } from './post'
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
}

export class Renderer {
  private quality: GameSettings['quality'] = 'high'
  /** The tier's feature set, resolved once per change (render/graphics.ts). */
  /** FRUSTUM CULL RECEIPT — how many bodies this frame drew vs skipped.
   *  Culling that is not counted is culling you cannot prove. */
  private cullDrawn = 0
  private cullSkipped = 0
  /** ULTRA's screen-space stack (bloom + god rays). One instance, one buffer. */
  private probes = new WeakMap<ShadowActor, Probe>()
  private forward = false
  setDesktopLighting(enabled:boolean):void { this.forward=enabled }
  private post = new PostStack()
  private features: GraphicsFeatures = featuresFor('high')

  setQuality(q: GameSettings['quality']): void {
    this.quality = q
    this.features = featuresFor(q as Tier)
  }

  /** What the frame is actually spending, for the debug readout. */
  graphicsSummary(): string {
    const f = this.features
    const stack = this.forward && f.bloom ? ' forward optics' : f.bloom || f.godRays ? ` ${this.post.summary()}` : ''
    const cull = ` cull ${this.cullDrawn}/${this.cullDrawn + this.cullSkipped}`
    return `${f.shadows}${f.penumbra ? `+${f.penumbra}` : ''}${f.shafts ? ' shafts' : ''}${f.dust ? ' motes' : ''} refl ${f.reflection || 'off'} dpr ${f.dprCap}${stack}${cull}`
  }

  /** GROUNDING, REBUILT (render/shadows.ts).
   *
   *  A figure is grounded by up to three things now, in paint order:
   *   1. contact AO — the soft dark where the body meets the deck. On EVERY tier:
   *      a fighter that floats is a bug on any device.
   *   2. the projected body — a long, tapered, soft-edged shadow thrown away from
   *      the moon, its length read from the composition. High tier and up.
   *   3. the SECOND shadow — the nearer practical's, in that practical's colour,
   *      falling away from it. Two lights, two shadows: this is the cue that makes
   *      the door and the streetlight read as sources rather than as decals.
   *
   *  Every pass count comes from the tier table, so the cost of a frame is the
   *  cost the table promised (tests/shadows.test.ts asserts it). */
  private shade(
    ctx: CanvasRenderingContext2D,
    bg: BackgroundRenderer,
    actor: ShadowActor,
    dir: number,
    reach: number,
    keyGain: number,
    keyX: number,
    hero=false,
  ): void {
    const F = this.features
    const { x, y, scale } = actor
    const height = actor.hipY - 18 * scale
    let probe = this.probes.get(actor)
    if (F.rim && bg.lightAt) {
      if (!probe) { probe = newProbe(); this.probes.set(actor,probe) }
      bg.lightAt(x,height,probe)
      probe.keyX=keyX;probe.keyGain=keyGain;probe.volume=F.keyTop
      if (!F.keyTop) probe.dy=0
    }
    drawContactAO(ctx, x, y, 24 * scale, .44, Math.min(1,F.penumbra))
    // Each shoe closes its own light gap. A swing foot or airborne body
    // contributes progressively less; the pelvis blob alone misses wide stances.
    if(Math.abs(y)<24){
      const shoe=(ankle:typeof actor.geom.ankleL)=>drawContactAO(ctx,x+actor.face*scale*ankle.x,
        actor.hipY+scale*(ankle.y+3.4),13*scale,.83,0)
      shoe(actor.geom.ankleL);shoe(actor.geom.ankleR)
    }
    if (!usesCastShadow(F.shadows) || Math.abs(y) >= 200) return
    const path = shadowOutline(actor.geom)
    // A wet-deck virtual image: reflect the already posed outline about y=0.
    // No copy of the browser's swapchain or second character solve. The city,
    // lamps and destructibles already supply their own reflected art.
    if(this.forward && F.reflection){
      ctx.save()
      ctx.beginPath();ctx.rect(x-120*scale,0,240*scale,ROAD.front);ctx.clip()
      ctx.transform(actor.face*scale,0,0,-.62*scale,x,-.62*actor.hipY)
      // Map the fade to the receiver, not the fighter: a jumping fighter's
      // virtual image moves deeper into the rough water and loses contrast.
      const contact=-actor.hipY/scale,far=contact-ROAD.front/(.62*scale)
      const tint=hero?'13,23,34':'130,148,161'
      const wet=ctx.createLinearGradient(0,contact,0,far)
      wet.addColorStop(0,`rgba(${tint},.22)`);wet.addColorStop(1,`rgba(${tint},0)`)
      ctx.fillStyle=wet;ctx.fill(path);ctx.restore()
    }
    drawCastShadow(ctx, actor, path, dir * shadowLength(1,reach), .46, F.penumbra)
    if (F.practicalShadow && probe?.caster && probe.castW > .04) {
      const l=probe.caster
      const slope=Math.max(-1.8,Math.min(1.8,(x-l.x)/Math.max(24,height-l.y)))
      drawCastShadow(ctx, actor, path, slope, .34*Math.min(1,probe.castW), Math.min(2,F.penumbra), LIGHT_INK[l.kind])
    }
  }

  draw(ctx: CanvasRenderingContext2D, world: RenderWorld, w: number, h: number, dt: number): void {
    const { cam, fx, bg, player, enemies, projectiles, props, hud, hudState } = world
    const time = world.time

    // 1. sky (screen space, own parallax)
    const skyCam = { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom }
    bg.drawSky(ctx, skyCam)

    // 2. world pass
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(cam.rot)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-(cam.x + cam.offX), -(cam.y + cam.offY))

    const viewHalfW = w / (2 * cam.zoom) + 240

    const key = bg.lightState?.()
    const moon=directionalProjection(key??{azimuth:0,elevation:.78})

    // arena floor + stage props
    bg.drawArena(ctx,this.forward && this.features.bloom)

    const viewL = cam.x + cam.offX - viewHalfW
    const viewR = cam.x + cam.offX + viewHalfW
    this.cullDrawn = 0
    this.cullSkipped = 0
    /* ONE view test for every culled body. The old inline test compared against
     * cam.x alone and ignored cam.offX — so during screen shake and the
     * slow-push cutscenes, bodies at the edge appeared a frame late or vanished
     * a frame early. A single helper means the shake, the cull and the props all
     * agree on where the picture is. The margin keeps a full figure off-screen
     * before it is skipped (a figure is 118 px tall and ~60 px wide). */
    const CULL_MARGIN = 90
    const visible = (x: number): boolean => {
      if (x >= viewL - CULL_MARGIN && x <= viewR + CULL_MARGIN) return true
      this.cullSkipped++
      return false
    }

    // PROP SHADOWS FIRST — the outline of every prop laid flat on the deck, away
    // from the moon. Under the props, under the fighters, ultra only.
    if (usesPropShadows(this.features.shadows) && key) {
      props.drawShadows(ctx, moon.dir, moon.reach, viewL, viewR)
    }

    // DESTRUCTIBLE PROPS — one baked sprite each (body + flipped reflection
    // in the same canvas), frustum-culled, drawn behind the fighters.
    props.draw(ctx, viewL, viewR)

    // grounding first, so every figure stands ON its shadow
    const keyGain = bg.getProfile?.()?.light.key ?? 1
    this.shade(ctx, bg, player, moon.dir, moon.reach, keyGain,moon.keyX,true)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (!visible(e.x)) continue
      this.shade(ctx, bg, e, moon.dir, moon.reach, keyGain,moon.keyX)
    }

    // ground decals + debris
    fx.drawUnder(ctx)

    const lighting = (actor: ShadowActor) => this.features.rim ? this.probes.get(actor) : undefined

    // enemies
    for (const e of enemies) {
      if (e.dead || e.spawning || !visible(e.x)) continue
      this.cullDrawn++
      e.draw(ctx, time, lighting(e))
    }

    // Echoes belong behind the opaque live actor, never on top of its hands/eyes.
    fx.drawSilhouettes(ctx)

    // Physical strike smears (the punch-sheet speed lines) belong behind the
    // opaque contact pose.
    player.drawStrikeSmear(ctx)

    // player
    player.draw(ctx, time, false, lighting(player))

    // DUST IN THE SHAFTS — air you can see (ultra). Drawn after the players so the
    // motes sit in front of the light rather than behind the fighter.
    if (this.features.dust) bg.drawMotes?.(ctx, time)

    // projectiles
    projectiles.draw(ctx, time)

    // FOREGROUND PROPS — the near-lane plate occludes fighters
    bg.drawFront?.(ctx)

    // additive FX (trails, motion lines, particles, rings, ghosts)
    fx.drawAdditive(ctx, time)

    // MANGA IMPACT FRAMES — black spikes punch through the glow layer
    fx.drawImpactFrames(ctx)

    ctx.restore()

    // 2.5 REFLECTION POST-PASS — one 1/8-scale downscale of the frame above
    // the deck line, blitted back flipped + rippled. Screen space, 4 blits,
    // contains the player/enemies/FX because its source IS the frame.
    // NOTE: the world camera (offset applied), not the parallax sky cam — the
    // deck line is a world y, so using the sky cam would misalign the band.
    if (this.features.reflection > 0) {
      bg.drawReflections?.(ctx, { x: cam.x + cam.offX, y: cam.y + cam.offY, zoom: cam.zoom }, this.quality,this.forward && this.features.keyTop)
    }

    /* 4.5 — THE ULTRA STACK. Order matters: the rays are the air around the
     * sources, the bloom is the sources themselves spilling. Doing bloom first
     * would make the rays smear a glow instead of a scene. */
    if (!this.forward && (this.features.godRays || this.features.bloom)) {
      const lights = this.features.godRays ? bg.raySources?.(w,h,{x:cam.x+cam.offX,y:cam.y+cam.offY,zoom:cam.zoom,rot:cam.rot}) : undefined
      this.post.compose(ctx,w,h,lights ?? [],.2,this.features.bloom ? 1 : 0)
    }

    // Screen overlays come AFTER optical capture: a flash is not an emitter.
    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. screen flash (hit/impact feedback)
    fx.drawFlash(ctx, w, h)

    fx.drawImpactFocus(ctx, w, h, cam)

    // 5. HUD
    hud.draw(world.hudCtx ?? ctx, w, h, hudState, dt)
  }
}
