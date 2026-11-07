/** STICKMAN RISING — render pipeline: sky → world (arena, wet-floor
 * reflections, shadows, entities, additive FX) → weather → vignette →
 * flash → HUD.
 */

import { Camera } from '../core/camera'
import { FX } from '../fx/fx'
import { Enemy } from '../entities/enemy'
import { Player } from '../entities/player'
import { ProjectilePool } from '../entities/projectiles'
import { CyberBackground } from '../world/background'
import { HUD, HudState } from './hud'
import { rgba } from '../core/utils'

export interface RenderWorld {
  cam: Camera
  fx: FX
  bg: CyberBackground
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

    // entity shadows (stretch + lean with the lightning key light)
    const li = bg.lightningI()
    const az = bg.lightningAz()
    drawShadow(ctx, player.x, 0, 1.1, 0.4, li, az)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      drawShadow(ctx, e.x, 0, e.scale, e.kind === 'drone' ? 0.22 : 0.32, li, az)
    }

    // ground decals + debris
    fx.drawUnder(ctx)

    // enemies
    for (const e of enemies) {
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.draw(ctx, time)
    }

    // player
    player.draw(ctx, time)

    // projectiles
    projectiles.draw(ctx, time)

    // additive FX (trails, particles, rings, afterimages)
    fx.drawAdditive(ctx, time)

    ctx.restore()

    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. vignette
    this.drawVignette(ctx, w, h)

    // 5. screen flash
    fx.drawFlash(ctx, w, h)

    // 6. HUD
    hud.draw(ctx, w, h, hudState, dt)
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.vignette || this.vigW !== w || this.vigH !== h) {
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.floor(w))
      c.height = Math.max(2, Math.floor(h))
      const vctx = c.getContext('2d')
      if (vctx) {
        const g = vctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(1, 'rgba(2,4,8,0.55)')
        vctx.fillStyle = g
        vctx.fillRect(0, 0, w, h)
      }
      this.vignette = c
      this.vigW = w
      this.vigH = h
    }
    ctx.drawImage(this.vignette, 0, 0, w, h)
  }

  /** wet-floor mirror pass — the 2D-native take on ray-traced reflections:
   *  every entity is re-drawn mirrored about the ground plane with vertical
   *  foreshortening, then melted into the dark facade by a depth gradient. */
  private drawReflections(ctx: CanvasRenderingContext2D, world: RenderWorld, viewHalfW: number): void {
    const { bg, cam, player, enemies, time } = world
    const li = bg.lightningI()
    const a = 0.20 + li * 0.3                  // flashes make the mirror snap bright
    ctx.save()
    ctx.scale(1, -0.66)                        // mirror about y=0 + perspective squash
    ctx.globalAlpha = a
    player.draw(ctx, time)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.draw(ctx, time)
    }
    ctx.restore()
    // vertical falloff: reflections dissolve into the wet dark with depth
    // (tall enough to swallow airborne entities' deep mirrored strokes)
    if (!this.reflFade) {
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 256
      const fc = c.getContext('2d')
      if (fc) {
        const g = fc.createLinearGradient(0, 0, 0, 256)
        g.addColorStop(0, 'rgba(3,6,10,0)')
        g.addColorStop(0.35, 'rgba(3,6,10,0.38)')
        g.addColorStop(0.7, 'rgba(3,6,10,0.9)')
        g.addColorStop(1, 'rgba(3,6,10,1)')
        fc.fillStyle = g
        fc.fillRect(0, 0, 8, 256)
      }
      this.reflFade = c
    }
    ctx.globalAlpha = 1
    ctx.drawImage(this.reflFade, cam.x - viewHalfW, 0, viewHalfW * 2, 195)
  }
}

function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number, groundY: number, scale: number, alpha: number,
  li = 0, az = 0,
): void {
  /* lightning acts as a hard key light: shadows stretch away from the bolt,
   * tighten vertically, and gain an AO-ish contact core so nothing floats */
  const stretch = 1 + li * 1.5
  const sx = x - az * li * 26 * scale
  const a = alpha * (1 + li * 0.5)
  ctx.save()
  ctx.fillStyle = rgba('#020409', a > 0.75 ? 0.75 : a)
  ctx.beginPath()
  ctx.ellipse(sx, groundY + 3, 26 * scale * stretch, 6.5 * scale * (1 - li * 0.25), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = rgba('#010307', a * 0.85)
  ctx.beginPath()
  ctx.ellipse(x, groundY + 3, 14 * scale, 4.2 * scale, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
