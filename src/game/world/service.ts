import type { RouteShelter, ServiceBuff } from '../stage/route'

export const SERVICE_HOLD = 1.5
export const SERVICE_BUFF_TIME = 30
export const SERVICE_RANGE = 64
export const SERVICE_HP = 40
export const SERVICE_SHIELD = 50

/** One transaction per terminal per run. Tap latches the same channel as E,
 * not an instant trade. Movement out of range and release of E cancel it. */
export class ServiceTerminal {
  private readonly used = new Set<number>()
  private current = 0
  private touchLatch = false
  progress = 0
  buff: ServiceBuff | null = null
  remaining = 0

  available(zone: RouteShelter | null, x: number, y: number): zone is RouteShelter {
    return zone?.kind === 'service' && !this.used.has(zone.id) &&
      Math.abs(zone.terminal - x) <= SERVICE_RANGE && y >= -30
  }

  update(dt: number, zone: RouteShelter | null, x: number, y: number, held: boolean, tapped: boolean): ServiceBuff | null {
    this.remaining = Math.max(0, this.remaining - dt)
    if (this.remaining === 0) this.buff = null
    if (!this.available(zone, x, y)) { this.cancel(); return null }
    if (this.current !== zone.id) {
      this.cancel()
      this.current = zone.id
    }
    if (tapped) this.touchLatch = true
    if (!held && !this.touchLatch) { this.progress = 0; return null }
    this.progress += dt
    if (this.progress + 1e-8 < SERVICE_HOLD) return null
    this.used.add(zone.id)
    this.cancel()
    this.buff = zone.buff
    this.remaining = SERVICE_BUFF_TIME
    return zone.buff
  }

  isUsed(id: number): boolean { return this.used.has(id) }
  cancel(): void { this.current = 0; this.progress = 0; this.touchLatch = false }
}
