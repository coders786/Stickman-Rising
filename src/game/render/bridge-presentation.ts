/** Double-buffer just the world. The GL input can have holes; only a full
 * Canvas result is published here. In particular resize must never touch the
 * backing of the canvas the compositor is currently showing. */
export class BridgePresentation {
  private front: CanvasRenderingContext2D | null = null
  private valid = false
  constructor(private readonly a: CanvasRenderingContext2D, private readonly b: CanvasRenderingContext2D) {
    a.canvas.style.visibility = b.canvas.style.visibility = 'hidden'
  }

  work(): CanvasRenderingContext2D { return this.front === this.a ? this.b : this.a }

  commit(ctx: CanvasRenderingContext2D): void {
    ctx.canvas.style.visibility = 'visible'
    if (this.front && this.front !== ctx) this.front.canvas.style.visibility = 'hidden'
    this.front = ctx
    this.valid = true
  }

  invalidate(layer: EventTarget | null): void { if (this.front?.canvas === layer) this.valid = false }

  contexts() { return [this.a, this.b] as const }

  dispose(): void {
    for (const { canvas } of this.contexts()) {
      canvas.style.visibility = 'hidden'
      canvas.width = canvas.height = 0
    }
    this.front = null
    this.valid = false
  }

  get fallbackReady(): boolean { return this.valid && !!this.front?.canvas.width && !!this.front.canvas.height && !this.front.isContextLost?.() }
  get fallbackLayer(): string | null { return this.front?.canvas.dataset.renderLayer ?? null }
  get backingBytes(): number {
    return (this.a.canvas.width * this.a.canvas.height + this.b.canvas.width * this.b.canvas.height) * 4
  }
}
