import { clamp } from '../core/utils'

export interface CrowdActor {
  id: number; x: number; y: number; vx: number; scale: number
  state: string; dead: boolean; spawning: boolean
}

const locked = (state: string) => ['stun', 'launched', 'down', 'getup', 'enter'].includes(state)

/** Bounded contact projection, ordered once by root/id. Pinned staggered bodies
 * are anchors; the idle/chasing neighbour yields. No velocity kick/swap. */
export function separateCrowd(actors: readonly CrowdActor[], dt: number, min: number, max: number, scratch: CrowdActor[], adjust?: (from: number, to: number) => number): void {
  scratch.length = 0
  for (const a of actors) if (!a.dead && !a.spawning) scratch.push(a)
  if (scratch.length < 2) return
  scratch.sort((a, b) => a.x - b.x || a.id - b.id)
  const cap = 104 * dt
  for (let i = 0; i < scratch.length - 1; i++) {
    const a = scratch[i]
    for (let j = i + 1; j < scratch.length; j++) {
      const b = scratch[j], gap = b.x - a.x
      if (gap >= 48) break
      if (Math.abs(a.y - b.y) > 34) continue
      const target = clamp(12 * (a.scale + b.scale), 26, 44)
      if (gap >= target) continue
      const left = !locked(a.state), right = !locked(b.state)
      const push = Math.min(cap, target - gap)
      const pullA = left ? Math.min(a.x - min, right ? push / 2 : push) : 0
      const pullB = right ? Math.min(max - b.x, push - Math.max(0, pullA)) : 0
      const extraA = left && right ? Math.min(Math.max(0, a.x - min - pullA), push - pullA - pullB) : 0
      const ax = a.x - Math.max(0, pullA + extraA), bx = b.x + Math.max(0, pullB)
      a.x = adjust?.(a.x, ax) ?? ax
      b.x = adjust?.(b.x, bx) ?? bx
      if (left && a.vx > 0) a.vx *= .84
      if (right && b.vx < 0) b.vx *= .84
    }
  }
}
