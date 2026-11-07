/** STICKMAN RISING — render pipeline: sky → world (arena, shadows, entities,
 * additive FX) → weather → vignette → flash → HUD.
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

    // entity shadows
    drawShadow(ctx, player.x, 0, 1.1, 0.4)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      drawShadow(ctx, e.x, e.kind === 'drone' ? 0 : 0, e.scale, e.kind === 'drone' ? 0.22 : 0.32)
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
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, groundY: number, scale: number, alpha: number): void {
  ctx.save()
  ctx.fillStyle = rgba('#020409', alpha)
  ctx.beginPath()
  ctx.ellipse(x, groundY + 3, 26 * scale, 6.5 * scale, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
