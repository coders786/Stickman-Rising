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
import { KeyLight, keyLightFromStorm, DOOR_LIGHT, STREET_LIGHT, shadowKeyFromPoint, drawPropShadow } from './lighting'
import { setSceneKey, setSceneEmitters, REFLECTION } from './look'

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
  private reflPH = 0
  /* CINEMATIC BLOOM — two-bounce downsample/upsample pyramid. The finished
   * frame is copied to a quarter-res plate, blurred again to eighth-res,
   * smooth-upsampled and added back with 'lighter'. On a near-black neon
   * scene the darks contribute almost nothing while every light source
   * (neon signs, blade glow, lightning, rain glints) spills a soft halo —
   * the look that instantly reads as "produced". Cost: three low-res blits. */
  private bloomA: HTMLCanvasElement | null = null
  private bloomB: HTMLCanvasElement | null = null
  private bloomW = 0
  private bloomH = 0
  /* ANAMORPHIC STRIPE — pre-baked horizontal lens streak (blue-white core,
   * long soft falloff) flashed across the sky where lightning strikes. */
  private streakSpr: HTMLCanvasElement | null = null
  /* FILM GRADE plate — pre-baked vertical color gradient (cool sky shadow
   * lift, warm city bounce below) blended 'lighter' to give the blacks a
   * color instead of dead gray. */
  private gradePl: HTMLCanvasElement | null = null
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
    // MULTI-LIGHT SHADOWS — every light source casts its own shadow along
    // its own rays: moon key (down-left), door practical (left), street
    // practical (RIGHT). Shadows form on BOTH sides of every figure, like
    // real life — nothing is a one-sided skew.
    // RAY-TRACED PROP SHADOWS — the stairwell head and the lamp pole also
    // block the key (wall-shadows technique on the play field)
    drawPropShadow(ctx, light, DOOR_LIGHT.x, 66, -118, 0.3)
    drawPropShadow(ctx, light, STREET_LIGHT.x, 5, -262, 0.24)
    const drawEntityShadows = (ent: { drawShadow: (c: CanvasRenderingContext2D, k: KeyLight, s?: number) => void }, x: number, y: number) => {
      ent.drawShadow(ctx, light)
      if (Math.abs(x - DOOR_LIGHT.x) < 1200) {
        const dk = shadowKeyFromPoint(DOOR_LIGHT, x, y)
        if (dk.i > 0.06) ent.drawShadow(ctx, dk, 0.58)
      }
      if (Math.abs(x - STREET_LIGHT.x) < 1150) {
        const sk = shadowKeyFromPoint(STREET_LIGHT, x, y)
        if (sk.i > 0.06) ent.drawShadow(ctx, sk, 0.62)
      }
    }
    drawEntityShadows(player, player.x, player.y)
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      drawEntityShadows(e, e.x, e.y)
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

  /** CINEMATIC BLOOM — downsample the finished frame through a two-step
   * pyramid (¼ → ⅛ → smooth ¼) and add it back with 'lighter'. Darks add
   * near-nothing; neon, blades, eyes, rain glints and lightning spill soft
   * halos. Plates are reused; only three low-res blits per frame. */
  private drawBloom(ctx: CanvasRenderingContext2D, w: number, h: number, relight = 0): void {
    if (this.quality === 'low') return
    const cw = Math.max(8, ctx.canvas.width), ch = Math.max(8, ctx.canvas.height)
    const bw = Math.max(2, cw >> 2), bh = Math.max(2, ch >> 2)
    const sw = Math.max(2, cw >> 3), sh = Math.max(2, ch >> 3)
    if (!this.bloomA || this.bloomW !== bw || this.bloomH !== bh) {
      this.bloomA = document.createElement('canvas')
      this.bloomA.width = bw
      this.bloomA.height = bh
      this.bloomB = document.createElement('canvas')
      this.bloomB.width = sw
      this.bloomB.height = sh
      this.bloomW = bw
      this.bloomH = bh
    }
    const a = this.bloomA.getContext('2d')
    const b = this.bloomB!.getContext('2d')
    if (!a || !b) return
    a.imageSmoothingEnabled = true
    a.imageSmoothingQuality = 'medium'
    a.clearRect(0, 0, bw, bh)
    // bright-pass at the ¼-res downsample: one filtered blit, no extra pass
    a.filter = BLOOM_BRIGHTPASS
    a.drawImage(ctx.canvas, 0, 0, cw, ch, 0, 0, bw, bh)
    a.filter = 'none'
    b.imageSmoothingEnabled = true
    b.clearRect(0, 0, sw, sh)
    b.drawImage(this.bloomA!, 0, 0, bw, bh, 0, 0, sw, sh)
    // smooth re-upsample: the ⅛ plate scaled back to ¼ IS the blur
    a.clearRect(0, 0, bw, bh)
    a.drawImage(this.bloomB!, 0, 0, sw, sh, 0, 0, bw, bh)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // selective pass — emissives carry more energy without a veil; the
    // relight event pulses bloom with the strobe. TWO shares: raw add for
    // the glow body, screen share for the AgX-style soft-clip highlight
    // rolloff (asymptotes at white instead of clipping). Energy-neutral on
    // darks (add+screen = old add α), so no new veil.
    const pulse = 1 + 0.55 * relight
    const q = this.quality
    const addShare = q === 'ultra' ? 0.3 : q === 'high' ? 0.23 : 0.15
    const scrShare = q === 'ultra' ? 0.16 : q === 'high' ? 0.13 : 0.09
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = addShare * pulse
    ctx.drawImage(this.bloomA!, 0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = scrShare * pulse
    ctx.drawImage(this.bloomA!, 0, 0, w, h)
    // HALATION — warm backscatter around the hottest highlights: tint the
    // ⅛ blur plate warm in place (opaque plate ⇒ exact multiply; next frame
    // clears it) and add it back wide and soft. Moon, door, neon and bolt
    // cores all bleed warm like film stock.
    const halA = (q === 'ultra' ? 0.13 : q === 'high' ? 0.11 : 0.07) * (1 + 0.45 * relight)
    b.globalCompositeOperation = 'multiply'
    b.fillStyle = HALATION_TINT
    b.fillRect(0, 0, sw, sh)
    b.globalCompositeOperation = 'source-over'
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = halA
    ctx.drawImage(this.bloomB!, 0, 0, w, h)
    ctx.restore()
  }

  /** MOON GOD-RAY SHAFTS — GPU Gems 3 recipe, Canvas2D at quarter-res:
   *  1) occlusion mask: moon glow bright, skyline + clouds dark
   *  2) radial smear outward from the moon (zoom blur, 9–14 cheap blits)
   *  3) additive composite, eclipse + lightning coupled, slow breathing.
   *  Research laws honored: blur once per effect per frame at quarter-res,
   *  all sprites pre-baked, two small buffers allocated once per resolution,
   *  zero per-frame gradient allocs, quality-gated (off at low). */
  private shaftA: HTMLCanvasElement | null = null
  private shaftB: HTMLCanvasElement | null = null
  private shaftW = 0
  private shaftH = 0

  private drawMoonShafts(ctx: CanvasRenderingContext2D, w: number, h: number, world: RenderWorld): void {
    if (this.quality === 'low') return
    const { bg, cam } = world
    const cover = bg.moonCover
    if (cover > 0.88) return                      // fully caged → no rays
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2)
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
    const n = this.quality === 'ultra' ? 14 : 9
    for (let i = 1; i <= n; i++) {
      const s = 1 + i * 0.048
      b.globalAlpha = Math.pow(0.86, i) * 1.05
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
    if (!this.gradePl) {
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 256
      const g = c.getContext('2d')
      if (g) {
        const gr = g.createLinearGradient(0, 0, 0, 256)
        gr.addColorStop(0, 'rgba(36,62,116,0.075)')
        gr.addColorStop(0.45, 'rgba(24,38,74,0.03)')
        gr.addColorStop(0.62, 'rgba(30,32,60,0.02)')
        gr.addColorStop(0.8, 'rgba(84,42,44,0.028)')
        gr.addColorStop(1, 'rgba(110,58,36,0.05)')
        g.fillStyle = gr
        g.fillRect(0, 0, 8, 256)
      }
      this.gradePl = c
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
    const li = bg.lightningI()
    const depth = REFLECTION.depth
    const pw = Math.max(64, Math.ceil(viewHalfW * 2)), ph = depth + 8
    if (!this.reflPlate || this.reflPW !== pw || this.reflPH !== ph) {
      const c = document.createElement('canvas')
      c.width = pw
      c.height = ph
      this.reflPlate = c
      this.reflPW = pw
      this.reflPH = ph
    }
    const p = this.reflPlate!.getContext('2d')
    if (!p) return
    p.clearRect(0, 0, pw, ph)
    p.save()
    p.translate(-(cam.x - viewHalfW), 0)
    p.scale(1, -0.66)                        // mirror about y=0 + perspective squash
    player.draw(p, time, true)
    p.globalAlpha = 0.8
    for (const e of enemies) {
      if (e.dead || e.spawning) continue
      if (Math.abs(e.x - cam.x) > viewHalfW) continue
      e.drawGhost(p, time)
    }
    p.restore()
    // BROKEN MIRROR (universal reflection policy): the plate returns in
    // horizontal strips, each displaced by a high-frequency wave — heavy
    // rain disturbs standing water, so the mirror is never a dry glass.
    const a = REFLECTION.opacity + li * REFLECTION.strobeGain
    ctx.save()
    ctx.beginPath(); ctx.rect(cam.x - viewHalfW, 0, viewHalfW * 2, depth + 6); ctx.clip()
    ctx.globalAlpha = a
    const n = REFLECTION.strips
    const sh = ph / n
    for (let i = 0; i < n; i++) {
      const wave = Math.sin(time * REFLECTION.waveFreq + i * 1.7) * REFLECTION.waveAmp
        + Math.sin(time * REFLECTION.waveFreq2 + i * 4.1) * REFLECTION.waveAmp2
      ctx.drawImage(this.reflPlate!, 0, i * sh, pw, sh + 1, cam.x - viewHalfW + wave, i * sh, pw, sh + 1)
    }
    ctx.globalAlpha = 1
    // vertical falloff: reflections dissolve into the wet dark with depth
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
    ctx.drawImage(this.reflFade, cam.x - viewHalfW, 0, viewHalfW * 2, depth)
    ctx.restore()
  }
}
