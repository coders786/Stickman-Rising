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
import { KeyLight, keyLightFromStorm } from './lighting'

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

    // ---- LIGHTING ENGINE: one dynamic key light (moon ↔ storm strobes)
    // drives PROJECTED SKELETON SHADOWS for every entity: each solved joint
    // (and the blade) casts along the light rays onto the ground plane —
    // the shadow deforms with the pose, stretches away from bolts, detaches
    // and fades when airborne, and carries contact-AO cores under the
    // legik-planted feet. Replaces the static blob ellipses. ----
    const li = bg.lightningI()
    const az = bg.lightningAz()
    const light: KeyLight = keyLightFromStorm(li, az)
    player.drawShadow(ctx, light)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.drawShadow(ctx, light)
    }

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

    // Physical unarmed kick smears belong behind the opaque contact pose.
    player.drawKickSmear(ctx)

    // player
    player.draw(ctx, time)

    // projectiles
    projectiles.draw(ctx, time)

    // additive FX (trails, HDR motion lines, particles, rings, ghosts)
    fx.drawAdditive(ctx, time)

    // MANGA IMPACT FRAMES — black spikes punch through the glow layer
    fx.drawImpactFrames(ctx)

    ctx.restore()

    // 3. weather (screen space)
    bg.drawWeather(ctx, { x: cam.x + cam.offX * 0.4, y: cam.y + cam.offY * 0.4, zoom: cam.zoom })

    // 4. chromatic aberration (lens strain on dashes / heavy impacts)
    this.drawChroma(ctx, w, h, fx.caIntensity)

    // 5. vignette
    this.drawVignette(ctx, w, h)

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

  /** CHROMATIC ABERRATION — selective edge lens strain. A true per-pixel
   * channel split is not tractable in Canvas2D; the anime-honest version
   * tints opposing screen edges red/cyan (radial CA's visible symptom) and
   * only while the camera is being strained (dash / heavy connect). */
  private drawChroma(ctx: CanvasRenderingContext2D, w: number, h: number, i: number): void {
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
          const v = 118 + (Math.random() * 2 - 1) * 74
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
    const plate = this.grainPlates[(Math.random() * this.grainPlates.length) | 0]
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
    ctx.save()
    ctx.beginPath();ctx.rect(cam.x-viewHalfW,0,viewHalfW*2,240);ctx.clip()
    const li = bg.lightningI()
    // the mirror still snaps brighter on strobes, but gently — the CAST
    // shadow (stretching away from the bolt) owns the directional read
    const a = 0.20 + li * 0.16
    ctx.save()
    ctx.scale(1, -0.66)                        // mirror about y=0 + perspective squash
    ctx.globalAlpha = a
    player.draw(ctx, time, true)
    ctx.globalAlpha = a * 0.8
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.drawGhost(ctx, time)
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
    ctx.restore()
  }
}
