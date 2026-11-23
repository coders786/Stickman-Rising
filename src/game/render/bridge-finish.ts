import { BridgeDeviceProbe } from '../../gpu/bridge-device-probe'
import { disposeVolumeBrushes } from '../lighting/volume'
import { BridgeContextUnavailable, BridgePipeline } from '../../gpu/bridge-pipeline'
import { discardPendingPackedBridge } from '../../gpu/bridge-packed-assets'
import { bridgeBacking, MASTER_PIXEL_LIMIT, type BridgeGLTier } from '../../graphics/sacr/BridgeBacking'
import { hasPixels, SurfaceScope } from './ledger'
import type { BakeWindow } from '../../graphics/bridge/BridgeBakeProtocol'
import type { BridgeFrame } from './bridge-frame'
import type { BridgePath } from './graphics'

type Backing = ReturnType<typeof bridgeBacking>
export type BridgeAdmission = { tier: BridgeGLTier; actors: CanvasRenderingContext2D; backing: Backing }
export type BridgeOpening = BridgeAdmission | null | 'device' | 'renderer' | 'lighting'

/** Admits the HDR or optimized WebGL2 path on hardware, with the independent
 * HUD above either. Failing allocation, shader link or loss never blanks the
 * scene or mutates the requested quality/lock. */
export class BridgeFinish {
  private readonly scope = new SurfaceScope('bridge-finish')
  private pipe: BridgePipeline | null = null
  private output: HTMLCanvasElement | null = null
  private visibleTier: BridgeGLTier | null = null
  private loading = false
  private forcedCanvas = false
  private readonly refused: Partial<Record<BridgeGLTier, string>> = {}
  private readonly blocked: Partial<Record<BridgeGLTier, string>> = {}
  private requestedTier: BridgeGLTier | null = null
  private lost = false
  private diagnosticSoftware = false
  private device = new BridgeDeviceProbe()
  private adapterChecked = false
  private reason = 'not requested'
  private pass: CanvasRenderingContext2D | null = null
  private requestedScale = 1
  private backingScale = 1
  private viewW = 0
  private viewH = 0
  warming = false
  private readonly onLoss = (event: Event): void => {
    event.preventDefault()
    this.lost = true; this.reason = 'WebGL context lost'
    this.releaseFrame(false); this.invalidate?.()
  }
  private readonly onRestore = (): void => {
    this.lost = false; this.reason = 'restored'
    this.retry()
    this.invalidate?.()
  }
  private invalidate: (() => void) | undefined

  attach(canvas: HTMLCanvasElement, invalidate: () => void): void {
    this.output = canvas; this.invalidate = invalidate
    canvas.width = canvas.height = 0
    canvas.hidden = true; canvas.style.visibility = 'hidden'
    canvas.addEventListener('webglcontextlost', this.onLoss)
    canvas.addEventListener('webglcontextrestored', this.onRestore)
  }

  private retryBacking(): void { delete this.blocked.master; delete this.blocked.mobile }
  private retry(): void { delete this.refused.master; delete this.refused.mobile; this.retryBacking() }
  allowSoftwareForDiagnostics(): void { this.diagnosticSoftware = true; this.retry() }

  // A source paint (before present()) can fail too. Reject that backing
  // until its dimensions, tier, or context change.
  abortFrame(reason: string): void {
    if (this.pipe) this.blocked[this.pipe.mode] = reason
    this.reason = reason
    this.releaseFrame()
  }

  private canvasBacking(scene: CanvasRenderingContext2D, w: number, h: number, cssW: number, cssH: number): void {
    const c = scene.canvas
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    scene.setTransform(w / cssW, 0, 0, h / cssH, 0, 0)
  }

  private remember(requested: BridgeGLTier | null, w: number, h: number, scale: number): void {
    if (w === this.viewW && h === this.viewH && scale === this.requestedScale && requested === this.requestedTier) return
    this.viewW = w; this.viewH = h; this.requestedScale = scale; this.requestedTier = requested
    this.retryBacking()
  }

  private pipeline<T>(requested: BridgeGLTier, w: number, h: number, preferred: number,
    ready: (pipe: BridgePipeline, b: Backing) => T): T | null {
    let reason = ''
    const modes: readonly BridgeGLTier[] = requested === 'master' ? ['master', 'mobile'] : ['mobile']
    for (const tier of modes) {
      const b = bridgeBacking(tier, w, h, preferred)
      if (tier === 'master' && b.w * b.h > MASTER_PIXEL_LIMIT) { reason ||= 'Master viewport budget'; continue }
      const unavailable = this.refused[tier] ?? this.blocked[tier]
      if (unavailable) { reason ||= unavailable; continue }
      if (this.pipe && this.pipe.mode !== tier) this.releaseFrame()
      try {
        const previous = this.pipe
        const pipe = this.pipe ??= BridgePipeline.create(this.output!, tier, this.diagnosticSoftware, this.adapterChecked)
        if (pipe.gl.isContextLost()) {
          this.reason = 'WebGL context lost'; this.releaseFrame(false)
          return null
        }
        if (!previous || !pipe.ready()) {
          this.warming = true; this.reason = 'Preparing WebGL programs and textures'
          return null
        }
        const result = ready(pipe, b)
        this.reason = reason ? `Optimized renderer · ${reason}` : 'active'
        return result
      } catch (error) {
        const s = String(error).slice(0, 600)
        if (error instanceof RangeError) this.blocked[tier] = s
        else this.refused[tier] = s
        reason ||= s
        this.releaseFrame()
        if (error instanceof BridgeContextUnavailable) {
          this.refused.master = this.refused.mobile = s
          break
        }
      }
    }
    this.reason = reason || 'WebGL draw unavailable'
    return null
  }

  private admit(pipe: BridgePipeline, b: Backing): BridgeAdmission {
    // Release the old brush cache *before* a resize can replace its ctx.
    if (this.pass && (this.pass.canvas.width !== b.w || this.pass.canvas.height !== b.h)) disposeVolumeBrushes(this.pass)
    const c = this.scope.tryAcquire('actors', b.w, b.h, `bridge-${pipe.mode}-actors`)
    if (!hasPixels(c)) throw new RangeError('surface budget')
    pipe.resize(b.w, b.h)
    this.pass = c.getContext('2d')
    if (!this.pass || this.pass.isContextLost?.()) throw new RangeError('actor context unavailable')
    return { tier: pipe.mode, actors: this.pass, backing: b }
  }

  paintSources(gpu: BridgeAdmission | null, scene: CanvasRenderingContext2D, w: number, h: number, preferred: number): void {
    const b = gpu?.backing ?? bridgeBacking(null, w, h, preferred)
    this.backingScale = b.scale
    this.canvasBacking(scene, b.w, b.h, w, h)
    if (gpu) {
      gpu.actors.setTransform(b.w / w, 0, 0, b.h / h, 0, 0)
      gpu.actors.clearRect(0, 0, w, h)
    }
  }

  prepare(requested: BridgeGLTier | null, scene: CanvasRenderingContext2D, cssW: number, cssH: number, preferred: number, provisional = false): BridgeAdmission | null {
    this.warming = false
    if (!provisional) this.remember(requested, cssW, cssH, preferred)
    const fallback = (retain = false) => {
      if (retain) this.hideOutput()
      else this.releaseFrame()
      const b = bridgeBacking(null, cssW, cssH, preferred)
      this.backingScale = preferred
      this.canvasBacking(scene, b.w, b.h, cssW, cssH)
      return null
    }
    if (provisional) return fallback(true)
    if (this.forcedCanvas) return fallback()
    if (!requested || !this.output || this.lost) {
      if (!this.lost) this.reason = 'not requested'
      return fallback()
    }
    return this.pipeline(requested, cssW, cssH, preferred, (pipe, b) => {
      const gpu = this.admit(pipe, b)
      this.paintSources(gpu, scene, cssW, cssH, preferred)
      return gpu
    }) ?? fallback(this.warming)
  }

  prefersAlbedo(requested: BridgeGLTier, w: number, h: number, preferred: number): boolean {
    const pipe = this.pipe
    if (!pipe?.assembled || this.lost || this.refused[pipe.mode] || this.blocked[pipe.mode]) return false
    if (requested === 'mobile') return pipe.mode === 'mobile'
    const b = bridgeBacking('master', w, h, preferred)
    const master = b.w * b.h <= MASTER_PIXEL_LIMIT && !this.refused.master && !this.blocked.master
    return pipe.mode === (master ? 'master' : 'mobile')
  }

  beginOpening(): void { this.forcedCanvas = false; this.loading = true }

  /** Idle-time prewarm, stepped once per quiet frame. Performs exactly what
   * the first admission would do — adapter probe, context creation, one
   * async link/init/resize step — without ever admitting a frame or
   * touching the visible output. ENGAGE then finds `ready()` already true
   * and the backing reserved, so the opening starts on its assets alone. */
  warm(requested: BridgeGLTier | null, w: number, h: number, preferred: number): void {
    if (!requested || !this.output || this.lost || this.forcedCanvas) return
    this.remember(requested, w, h, preferred)
    if (!this.diagnosticSoftware) {
      const device = this.device.poll()
      if (!device) return
      if (device === 'software') {
        this.refused.master = this.refused.mobile = 'Software WebGL adapter; using Canvas fallback'
        return
      }
      this.adapterChecked = device === 'hardware'
    }
    this.pipeline(requested, w, h, preferred, (pipe, b) => {
      pipe.advanceResize(b.w, b.h)
      return true
    })
  }

  /** A run may use Canvas when GL setup never completes. Keep the requested
   * preset unchanged and retry GL only at the next run boundary. */
  fallbackOpening(): void {
    this.forcedCanvas = true
    this.device.dispose()
    this.releaseFrame()
    this.reason = 'WebGL opening timed out; using Canvas for this run'
  }

  resetOpening(): void {
    this.reason = 'Opening not ready; try again'
    this.warming = false
    // Keep any published Results backing. Re-request pending assets and
    // link afresh on the next attempt, using the same renderer preference.
    discardPendingPackedBridge()
    this.releaseFrame()
  }

  /** Null is a resolved Canvas path, not a temporary frame while GL links. */
  advanceOpening(requested: BridgeGLTier | null, w: number, h: number, scale: number,
    window: BakeWindow | null, seed: number, skySettled: boolean): BridgeOpening {
    this.warming = false
    this.remember(requested, w, h, scale)
    if (this.forcedCanvas) return null
    if (!requested || !this.output || this.lost) {
      if (!this.lost) this.reason = requested ? 'WebGL output unavailable' : 'Canvas output selected'
      return null
    }
    if (!this.diagnosticSoftware) {
      const device = this.device.poll()
      if (!device) { this.reason = 'Checking WebGL adapter'; return 'device' }
      if (device === 'software') {
        this.reason = this.refused.master = this.refused.mobile = 'Software WebGL adapter; using Canvas fallback'
        return null
      }
      this.adapterChecked = device === 'hardware'
    }
    const result = this.pipeline<BridgeAdmission | 'renderer' | 'lighting'>(requested, w, h, scale, (pipe, b) => {
      if (!pipe.advanceResize(b.w, b.h)) return 'renderer'
      const gpu = this.admit(pipe, b)
      return pipe.openingAssetsReady(window, seed, skySettled) ? gpu : 'lighting'
    })
    if (result === 'renderer') this.reason = 'Reserving the arena backings'
    if (result === 'lighting') this.reason = 'Preparing opening lighting textures'
    return this.warming ? 'renderer' : result
  }

  get hasOpeningFrame(): boolean { return this.pipe?.hasOpeningFrame ?? false }
  openingFrameReady(): boolean { return this.pipe?.openingFrameReady() ?? false }
  discardOpeningFrame(): void { this.pipe?.discardOpeningFrame() }
  endOpening(): void { this.discardOpeningFrame(); this.device.dispose(); this.loading = false }

  publishOpening(gpu: BridgeAdmission | null): void {
    if (gpu) {
      const pipe = this.pipe
      if (!pipe || pipe.mode !== gpu.tier) throw new Error('Bridge opening renderer changed')
      pipe.publishOpeningFrame()
      this.showOutput(gpu.tier)
    } else this.releaseFrame(false)
  }

  retireRoute(): void { this.pipe?.retireRoute() }

  get skyReady(): boolean { return this.pipe?.skyReady ?? false }

  transportWindow(seed: number) { return this.pipe?.transportWindow(seed) ?? null }

  beginSky(flash: number, seed: number, w: number, h: number, quiet: boolean): boolean {
    return this.pipe?.beginSky(flash, seed, w, h, quiet) ?? true
  }

  *stageOpening(scene: CanvasRenderingContext2D, f: BridgeFrame, cssW: number, cssH: number): Generator<void> {
    const actors = this.pass?.canvas, pipe = this.pipe
    if (!hasPixels(actors) || !pipe || this.pass?.isContextLost?.() || scene.isContextLost?.() || f.overflow) throw new Error('Incomplete Bridge source')
    if (!(yield* pipe.presentSteps(scene.canvas, actors, f, cssW, cssH, true, true))) throw new Error('Incomplete Bridge opening draw')
  }

  present(scene: CanvasRenderingContext2D, f: BridgeFrame, cssW: number, cssH: number, restoreSky: () => void, opening = false): void {
    const actors = this.pass?.canvas, pipe = this.pipe
    if (!hasPixels(actors) || !pipe || this.pass?.isContextLost?.() || scene.isContextLost?.()) throw new Error('Incomplete Bridge source')
    if (opening) {
      if (f.overflow || !pipe.present(scene.canvas, actors, f, cssW, cssH, true)) throw new Error('Incomplete Bridge opening draw')
      return // GPU completion and HUD come before publication.
    }
    let drawn = false
    try {
      drawn = !f.overflow && pipe.present(scene.canvas, actors, f, cssW, cssH)
      if (!drawn) this.reason = f.overflow ? 'receiver packet budget' : 'WebGL draw unavailable'
    } catch (error) {
      this.reason = String(error).slice(0, 600); this.refused[pipe.mode] = this.reason
    }
    if (!drawn) {
      try { restoreSky(); scene.drawImage(actors, 0, 0, cssW, cssH) }
      finally { this.releaseFrame() }
      return
    }
    this.showOutput(pipe.mode)
  }

  private showOutput(tier: BridgeGLTier): void {
    if (!this.output) return
    if (!this.visibleTier) {
      this.output.hidden = false; this.output.style.visibility = 'visible'
    }
    this.visibleTier = tier
  }

  private hideOutput(): void {
    if (this.visibleTier && this.output) {
      this.output.hidden = true; this.output.style.visibility = 'hidden'
    }
    this.visibleTier = null
  }

  private releaseFrame(retainOutput = this.loading): void {
    // During Retry even a rejected renderer must leave the last Results
    // backing alone. Delete its resources without clearing the default FBO.
    if (!retainOutput) {
      this.hideOutput()
      if (this.output && (this.output.width || this.output.height)) this.output.width = this.output.height = 0
    }
    this.pipe?.dispose(); this.pipe = null
    if (this.pass) disposeVolumeBrushes(this.pass)
    this.scope.releaseAll(); this.pass = null
  }

  get frameLive(): boolean { return !!this.visibleTier && !!this.pipe && !this.pipe.gl.isContextLost() }
  get path(): BridgePath { return this.visibleTier === 'master' ? 'master-webgl2' : this.visibleTier === 'mobile' ? 'mobile-webgl2' : 'mobile-canvas' }
  receipt() {
    return { path: this.path, reason: this.reason, requestedScale: this.requestedScale, backingScale: this.backingScale,
      staged: this.hasOpeningFrame, gpu: this.visibleTier && this.pipe?.assembled ? this.pipe.receipt() : null }
  }

  dispose(): void {
    this.endOpening()
    this.releaseFrame(false)
    this.output?.removeEventListener('webglcontextlost', this.onLoss)
    this.output?.removeEventListener('webglcontextrestored', this.onRestore)
    this.output = null; this.invalidate = undefined; this.reason = 'released'; this.forcedCanvas = false
    this.retry()
  }
}
