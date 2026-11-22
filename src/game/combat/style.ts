export const STYLES = [
  { at: 1, rank: 'D', color: '#c3cad1' },
  { at: 5, rank: 'C', color: '#a5e9b7' },
  { at: 10, rank: 'B', color: '#ffcc7a' },
  { at: 20, rank: 'A', color: '#ffae7c' },
  { at: 35, rank: 'S', color: '#ff809b' },
  { at: 55, rank: 'SS', color: '#f9a1d5' },
  { at: 80, rank: 'SSS', color: '#fff3d6' },
] as const
const EMPTY = { at: 0, rank: '', color: '#c3cad1' }
export function styleForHits(hits: number) {
  for (let i = STYLES.length - 1; i >= 0; i--) if (hits >= STYLES[i].at) return STYLES[i]
  return EMPTY
}
export const styleColor = (rank: string) => STYLES.find(style => style.rank === rank)?.color ?? EMPTY.color

export class FlowTracker {
  hits = 0
  timer = 0
  readonly timerMax = 2.6
  mult = 1
  best = 0
  bestRank = ''
  rankUpT = 0
  lastRank = ''

  onHit(): boolean {
    this.hits++
    this.timer = this.timerMax
    this.mult = Math.min(1 + Math.floor(this.hits / 5) * .5, 5)
    if (this.hits > this.best) {
      this.best = this.hits
      this.bestRank = styleForHits(this.best).rank
    }
    const rank = styleForHits(this.hits).rank
    if (rank === this.lastRank) return false
    this.lastRank = rank
    this.rankUpT = .42
    return true
  }

  update(dt: number, held = false): void {
    this.rankUpT = Math.max(0, this.rankUpT - dt)
    if (!held && this.hits > 0) {
      this.timer = Math.max(0, this.timer - dt)
      if (this.timer === 0) this.clear()
    }
  }

  /** Terminal payment / decay clear the current Flow, never the run record. */
  clear(): void {
    this.hits = this.timer = this.rankUpT = 0
    this.lastRank = ''
    this.mult = 1
  }

  reset(): void {
    this.clear()
    this.best = 0
    this.bestRank = ''
  }
}
