import { clamp, mulberry32 } from '../core/utils'
import type { EnemyKind } from '../entities/enemy'
import { BridgeRoute, travelledMetres, type Platform } from '../stage/route'

export interface LiveBody { x: number; y: number; dead: boolean; spawning: boolean; kind: EnemyKind }
export interface EncounterView { x: number; facing: 1 | -1; vx: number; left: number; right: number }
export interface EncounterSpawn { kind: EnemyKind; x: number; scale: number; platform?: Platform; gate?: number }
export interface Gate { index: number; x: number; state: 'ahead' | 'locked' | 'open' }

const THREAT_RADIUS = 960
const MIN_REINFORCE = .38
export const MAX_ROAD_ENEMIES = 8
export const isThreat = (body: LiveBody, x: number) => !body.dead && !body.spawning && Math.abs(body.x - x) <= THREAT_RADIUS

/** Road traffic is budgeted by visible approach, progress and confirmed live
 * actors. No intermission, no queued coordinates and no enemies born in cover. */
export class EncounterDirector {
  gate: Gate
  previousGate: Gate | null = null
  patrol = 0
  private nextSpawn = 0
  private lastSpawnX = -Infinity
  private spawnCount = 0
  private gateSpawned = false
  private readonly rng: () => number

  constructor(readonly route: BridgeRoute) {
    this.gate = { index: 0, x: route.gateX(0), state: 'ahead' }
    this.rng = mulberry32(route.seed ^ 0x6ea7f451)
  }

  get limit(): number { return this.gate.state === 'locked' ? this.gate.x : Infinity }

  openGate(index: number): boolean {
    if (this.gate.index !== index || this.gate.state !== 'locked') return false
    this.previousGate = { ...this.gate, state: 'open' }
    this.gate = { index: index + 1, x: this.route.gateX(index + 1), state: 'ahead' }
    this.gateSpawned = false
    return true
  }

  update(dt: number, view: EncounterView, bodies: readonly LiveBody[]): EncounterSpawn | null {
    const { x } = view, gate = this.gate
    if (gate.state === 'ahead' && x >= gate.x - 420) gate.state = 'locked'
    this.nextSpawn -= dt
    if (this.route.shelterAt(x)) return null
    if (gate.state === 'locked' && !this.gateSpawned) {
      this.gateSpawned = true
      this.nextSpawn = 1.2
      this.patrol++
      return { kind: 'boss', x: gate.x - 92, scale: 1 + gate.index * .17, gate: gate.index }
    }

    let live = 0, ahead = 0, total = 0
    for (const body of bodies) {
      if (!body.dead) total++
      if (!isThreat(body, x)) continue
      live++
      if ((body.x - x) * view.facing > 0) ahead++
    }
    if (gate.state === 'locked' || total >= MAX_ROAD_ENEMIES - 1) return null
    const advancing = (x - this.lastSpawnX) * view.facing > 315
    const budget = 2 + Math.min(3, Math.floor(travelledMetres(x) / 215))
    if (live > 0 && (this.nextSpawn > 0 || live >= budget || (ahead >= 1 && !advancing && live >= 2))) return null

    const spawnX = this.findLane(view, bodies, live === 0)
    if (spawnX === null) return null
    if (live === 0 || advancing || !this.patrol) this.patrol++
    this.nextSpawn = MIN_REINFORCE + this.rng() * .22
    this.lastSpawnX = x
    this.spawnCount++
    const chunk = this.route.at(spawnX)
    const scale = 1 + Math.min(1.8, travelledMetres(x) / 870)
    // A supported marksman is part of the catwalk grammar; never hang a
    // shooter in empty air, and leave a grounded rusher in every formation.
    const platform = chunk.platform
    if (platform && live && this.spawnCount % 2 === 0 &&
        Math.abs((platform.left + platform.right) / 2 - x) >= 195 &&
        !bodies.some(b => !b.dead && b.kind === 'gunner' && Math.abs(b.x - x) < 640)) {
      const perch = (platform.left + platform.right) / 2
      if (Math.abs(perch - x) < THREAT_RADIUS && perch < gate.x - 84 && this.route.stopAtCover(x, perch) === perch &&
          !bodies.some(b => !b.dead && Math.abs(b.x - perch) < 64)) return { kind: 'gunner', x: perch, platform, scale }
    }
    const kind = live === 0 ? (this.spawnCount <= 2 ? 'grunt' : 'assassin') :
      this.spawnCount % 3 === 0 ? 'shield' : this.spawnCount % 7 === 0 ? 'heavy' : 'grunt'
    return { kind, x: spawnX, scale }
  }

  private findLane(view: EncounterView, bodies: readonly LiveBody[], empty: boolean): number | null {
    const { x, facing } = view
    const edge = facing > 0 ? view.right : view.left
    // A world-width-independent engagement leash. On a very wide view we
    // favour a nearer reinforcement over waiting for an offscreen wanderer.
    const moving = Math.abs(view.vx) > 130
    const maxLead = empty && !moving ? 365 : 810
    const lead = clamp((edge - x) * facing + 56, 196, maxLead)
    const legal = (slot: number) => slot > 36 && slot < this.gate.x - 90 &&
      Math.abs(slot - x) >= 108 && !this.route.shelterAt(slot, 16) && this.route.stopAtCover(x, slot) === slot &&
      !bodies.some(b => !b.dead && Math.abs(b.x - slot) < 64)
    for (const dir of [facing, -facing]) {
      for (let distance = lead; distance <= maxLead; distance += 38) {
        const slot = x + distance * dir
        if (legal(slot)) return slot
      }
      for (let distance = lead - 28; distance >= 108; distance -= 27) {
        const slot = x + distance * dir
        if (legal(slot)) return slot
      }
    }
    return null
  }
}
