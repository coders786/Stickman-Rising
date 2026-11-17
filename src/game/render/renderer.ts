/** STICKMAN RISING — render pipeline (stripped): sky → world (arena,
 * entities, FX) → weather → flash → HUD. No shaders, no WebGL, no light
 * transport, no reflections, no full-screen post passes — every one of
 * those engines is gone in the 120 fps pass. What remains is plain
 * Canvas2D blits so the frame budget belongs to the simulation.
 */

import { shadowDirection, shadowReach } from '../world/light'
import { featuresFor, type GraphicsFeatures, type Tier } from './graphics'
import { FIGURE_H, drawCastShadow, drawContactAO, usesCastShadow, usesPropShadows } from './shadows'
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
  /** The tier's feature set, resolved once per change (render/graphics.ts). */
  private features: GraphicsFeatures = featuresFor('high')

  setQuality(q: GameSettings['quality']): void {
    this.quality = q
    this.features = featuresFor(q as Tier)
  }

  /** What the frame is actually spending, for the debug readout. */
  graphicsSummary(): string {
    const f = this.features
    return `${f.shadows}${f.penumbra ? `+${f.penumbra}` : ''}${f.shafts ? ' shafts' : ''}${f.dust ? ' motes' : ''} refl ${f.reflection || 'off'} dpr ${f.dprCap}`
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
    x: number,
    y: number,
    width: number,
    height: number,
    dir: number,
    reach: number,
  ): void {
    const F = this.features
    drawContactAO(ctx, x, y, width, 0.44, Math.min(1, F.penumbra))
    if (!usesCastShadow(F.shadows)) return
    drawCastShadow(ctx, { x, y, height, width, dir, reach, alpha: 0.46, penumbra: F.penumbra })
    if (!F.practicalShadow) return
    const ps = bg.practicalShadow?.(x)
    if (!ps || ps.strength <= 0.04) return
    drawCastShadow(ctx, {
      x,
      y,
      height: height * 0.94,
      width: width * 0.92,
      dir: ps.dir,
      // A practical is close to the body it lights, so its shadow is SHORT. That
      // contrast — a long cold moon shadow and a short warm one — is what the eye
      // reads as two lights.
      reach: 0.22 + 0.4 * ps.strength,
      alpha: 0.34 * ps.strength,
      penumbra: Math.min(2, F.penumbra),
      ink: ps.ink,
    })
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
    const hasKey = Number.isFinite(moonSX)
    const moonW = hasKey ? cam.x + cam.offX + ((moonSX as number) - w / 2) / cam.zoom : Infinity
    const key = bg.lightState?.()
    // Distance to the key measured in FRAMES, not pixels: the same body casts the
    // same shadow relative to the picture on a 320 px phone and a 2560 px
    // monitor. `shadowReach` owns the shape of the response.
    const reachAt = (x: number): number => {
      if (!hasKey || !key) return 1
      const frames = Math.abs(x - moonW) * cam.zoom / Math.max(1, w)
      return shadowReach(key.elevation, frames)
    }
    const dirAt = (x: number): -1 | 1 => (hasKey ? shadowDirection(x, moonW) : -1)

    // arena floor + stage props
    bg.drawArena(ctx)

    const viewL = cam.x + cam.offX - viewHalfW
    const viewR = cam.x + cam.offX + viewHalfW

    // PROP SHADOWS FIRST — the outline of every prop laid flat on the deck, away
    // from the moon. Under the props, under the fighters, ultra only.
    if (usesPropShadows(this.features.shadows) && hasKey && key) {
      props.drawShadows(ctx, moonW, key.elevation, cam.zoom, w, viewL, viewR)
    }

    // DESTRUCTIBLE PROPS — one baked sprite each (body + flipped reflection
    // in the same canvas), frustum-culled, drawn behind the fighters.
    props.draw(ctx, viewL, viewR)

    // grounding first, so every figure stands ON its shadow
    this.shade(ctx, bg, player.x, player.y, 32, FIGURE_H, dirAt(player.x), reachAt(player.x))
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      this.shade(ctx, bg, e.x, e.y, 30, FIGURE_H * 0.95, dirAt(e.x), reachAt(e.x))
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
      bg.drawReflections?.(ctx, { x: cam.x + cam.offX, y: cam.y + cam.offY, zoom: cam.zoom }, this.quality)
    }

    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. screen flash (hit/impact feedback)
    fx.drawFlash(ctx, w, h)

    // 5. HUD
    hud.draw(ctx, w, h, hudState, dt)
  }
}
