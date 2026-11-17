/** STICKMAN RISING — render pipeline (stripped): sky → world (arena,
 * entities, FX) → weather → flash → HUD. No shaders, no WebGL, no light
 * transport, no reflections, no full-screen post passes — every one of
 * those engines is gone in the 120 fps pass. What remains is plain
 * Canvas2D blits so the frame budget belongs to the simulation.
 */

import { Camera } from '../core/camera'
import { FX } from '../fx/fx'
import { Enemy } from '../entities/enemy'
import { Player } from '../entities/player'
import { ProjectilePool } from '../entities/projectiles'
import type { BackgroundRenderer } from '../world/background'
import type { PropField } from '../world/props'
import { HUD, HudState } from './hud'
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
  hudState: HudState
  time: number
}

export class Renderer {
  private quality: GameSettings['quality'] = 'high'

  setQuality(q: GameSettings['quality']): void {
    this.quality = q
  }

  /** One soft contact ellipse per figure — the whole "grounding" system.
   *  Fades with height so a jump detaches it. Two fills per figure, no
   *  gradients, no plates.
   *
   *  DIRECTIONAL, AND THE DIRECTION IS THE MOON'S (bounty O-10). The shadows
   *  used to be pushed lower-LEFT by a constant, which was correct only while
   *  the moon happened to be on the right. The moon is a profile axis now and it
   *  can sit anywhere in the sky, so the shadow is projected AWAY from it: a
   *  figure left of the moon casts further left, a figure right of it casts
   *  right. `moonW` is the moon's world x (Infinity = no sky, keep the old look).
   *  Cost: one comparison and a multiply per figure. */
  private ground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, moonW = Infinity): void {
    const a = 0.34 * Math.max(0, 1 - Math.abs(y) / 150)
    if (a < 0.02) return
    // -1 pushes the shadow to the figure's left, +1 to the right.
    const dir = Number.isFinite(moonW) ? (x < moonW ? -1 : 1) : -1
    // The further from the light, the longer and softer the shadow: a figure at
    // the moon's foot casts almost straight down.
    const reach = Number.isFinite(moonW)
      ? Math.min(1.25, 0.35 + Math.abs(x - moonW) / 2200)
      : 1
    ctx.globalAlpha = a * 0.55
    ctx.fillStyle = '#04070b'
    ctx.beginPath()
    ctx.ellipse(x + dir * w * 0.55 * reach, y + 3, w * (1.1 + 0.4 * reach), w * 0.2, dir * -0.06, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = a
    ctx.beginPath()
    ctx.ellipse(x + dir * w * 0.12 * reach, y + 2, w * 0.82, w * 0.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
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

    // The moon's world x, for the contact shadows. Screen space -> world space
    // through the same camera the ctx is carrying, so the two cannot drift.
    const moonSX = bg.moonScreenX?.()
    const moonW = Number.isFinite(moonSX) ? cam.x + cam.offX + ((moonSX as number) - w / 2) / cam.zoom : Infinity

    // arena floor + stage props
    bg.drawArena(ctx)

    // DESTRUCTIBLE PROPS — one baked sprite each (body + flipped reflection
    // in the same canvas), frustum-culled, drawn behind the fighters.
    props.draw(ctx, cam.x + cam.offX - viewHalfW, cam.x + cam.offX + viewHalfW)

    // grounding first, so every figure stands ON its contact shadow
    this.ground(ctx, player.x, player.y, 30, moonW)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      this.ground(ctx, e.x, e.y, 28, moonW)
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

    // V3 REACTIVE LIGHT — the player's key/rim light + wet deck pool, keyed to
    // whichever practical they are standing in (≤2 additive blits)
    bg.drawPlayerLight?.(ctx, player.x, player.y, player.face)

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
    bg.drawReflections?.(ctx, { x: cam.x + cam.offX, y: cam.y + cam.offY, zoom: cam.zoom }, this.quality)

    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. screen flash (hit/impact feedback)
    fx.drawFlash(ctx, w, h)

    // 5. HUD
    hud.draw(ctx, w, h, hudState, dt)
  }
}
