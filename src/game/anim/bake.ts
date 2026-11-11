/** STICKMAN RISING — the BAKE step (ported from the reference studio rig).
 *
 * The reference animation pipeline is two-stage and that is the whole reason
 * its beats read as fluid:
 *
 *   1. BAKE — sparse authored keys (with a per-key ease on the ARRIVING key,
 *      `in` accelerating into a contact, `out` releasing from a chamber) are
 *      expanded onto a fixed frame grid (24 fps). Every baked frame already
 *      carries the final eased timing. The eased curve is therefore baked
 *      into the DATA, not applied at runtime over a long span.
 *   2. SAMPLE — the runtime interpolates BETWEEN the dense baked frames with
 *      a C1 spline (the reference uses Catmull-Rom; we use the animator's
 *      shape-preserving monotone spline, which is the same family and never
 *      overshoots a joint).
 *
 * Our engine had stage 2 only: combat clips are authored sparsely AND marked
 * `interpolation: 'monotone'`, which numerically ignores each key's `e` hint
 * entirely. Peak velocity therefore landed wherever the spline put it —
 * often after the contact frame — and every strike smeared instead of
 * snapping.
 *
 * `bakeClip` restores stage 1: it expands a sparse clip through its authored
 * eases onto a frame grid, then hands the dense result back to the monotone
 * sampler. The authored snap survives, and the contact frame is the fastest
 * frame again.
 */
import type { Clip, Keyframe } from './animator'
import { makeClip } from './animator'
import { CH_COUNT, makePose } from './pose'
import { EASES } from '../core/utils'

/** The reference bakes at 24 fps; gameplay samples continuously from it. */
export const BAKE_FPS = 24

type SrcFrame = { t: number; p: Float32Array; en?: string; e?: unknown }

/** Expand a sparse clip through its per-key eases onto a fixed frame grid.
 *
 * Holds and stillness frames survive: two identical keys stay identical, so
 * the baked span between them is flat and the character truly stops. */
export function bakeClip(clip: Clip, fps = BAKE_FPS, contact: number | null = null): Clip {
  let src = clip.frames as unknown as SrcFrame[]
  if (!src || src.length < 2 || clip.dur <= 0) return clip
  // (re-timing happens on the dense grid, after the bake, further down)
  const steps = Math.max(2, Math.ceil(clip.dur * fps))
  const frames: Keyframe[] = []
  const pose = makePose()
  let seg = 0
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * clip.dur
    while (seg < src.length - 2 && src[seg + 1].t <= t) seg++
    const a = src[seg]
    const b = src[seg + 1] ?? a
    const span = b.t - a.t
    let u = span > 1e-6 ? (t - a.t) / span : 1
    u = u < 0 ? 0 : u > 1 ? 1 : u
    // The ease lives on the arriving key (reference law: `K(f,'in',…)` is
    // the violent arrival INTO frame f).
    const ease = EASES[b.en ?? 'inOutCubic'] ?? EASES.inOutCubic
    const eased = ease(u)
    for (let c = 0; c < CH_COUNT; c++) pose[c] = a.p[c] + (b.p[c] - a.p[c]) * eased
    frames.push({ t, p: Float32Array.from(pose), e: 'linear' } as unknown as Keyframe)
  }
  const shaped = contact == null ? frames : holdSnap(frames, clip.dur, fps, contact)
  const baked = makeClip(clip.name, shaped, clip.loop)
  if (contact != null && shaped !== frames) {
    const stepT = clip.dur / Math.max(1, shaped.length - 1)
    const k = Math.max(1, Math.ceil(contact / stepT - 1e-9))
    baked.snapAt = Math.min(clip.dur, k * stepT)
  }
  // Dense grid + C1 resample == the reference's bake-then-Catmull-Rom.
  baked.interpolation = 'monotone'
  baked.equipment = clip.equipment
  return baked
}


/** Reference timing law #2 — the one that only shows up when you measure it:
 *
 *     hold ....... hold  SNAP  brace  settle
 *
 * Sampled on its own 24 fps grid, the reference's seven moves spend a
 * MEDIAN 58 % of their frames nearly motionless and put the whole strike
 * into 1-3 frames (peak/mean 3.8-13.1). Our clips moved on every single
 * frame (median 22 % still, peak/mean 2.0): that is a smear, and it is why
 * the snap never reads — no frame is the hit, because every frame is.
 *
 * Sparse keys cannot fix this on their own: the authored spans are already
 * about one frame long, so there is nowhere for a hold to live. `holdSnap`
 * therefore RE-TIMES the dense grid instead of adding keys:
 *
 *   · the approach is compressed into fewer frames,
 *   · the last pre-contact pose is held still,
 *   · the contact frame keeps its exact timestamp (hit windows stay valid),
 *   · the contact pose is braced for a couple of frames (the reference's
 *     `slow{}` weight / held impact key, expressed as pose data),
 *   · the settle absorbs what is left.
 *
 * Same duration, same contact time, same poses — only where the frames go. */
function holdSnap(frames: Keyframe[], dur: number, fps: number, contact: number): Keyframe[] {
  const n = frames.length
  if (n < 7) return frames
  const src = frames as unknown as SrcFrame[]
  // The strike is not a guess: gameplay already knows when this move lands,
  // so the bake is told. That removes the whole class of error where the
  // guard-to-chamber move is bigger than the punch and the hold freezes the
  // windup instead of the hit.
  // ceil, so the arrival frame is at or AFTER the authored contact time: the
  // jump then straddles the moment the hitbox opens instead of finishing
  // five milliseconds before it.
  const stepT = dur / (n - 1)
  let k = Math.ceil(contact / stepT - 1e-9)
  k = Math.max(2, Math.min(n - 2, k))
  // Budget: the approach keeps at least three frames (squeezing it into two
  // makes the windup itself the fastest, most teleporting step in the clip),
  // the hold gets the rest of the run-up, the brace two-ish, settle the tail.
  // Keep the hold short and let the wind-up run at (almost) its authored
  // density: compressing the wind-up 2x makes the chamber faster than the
  // punch, and then the eye reads the prep as the hit.
  const hold = Math.max(2, Math.min(Math.round(n * 0.18), 3, k - 3))
  // The settle keeps at least three frames: compressing the recovery into
  // two makes the RETRACT faster than the strike, and then the eye reads the
  // arm being pulled back as the hit.
  const brace = Math.max(1, Math.min(Math.round(n * 0.15), n - 1 - k - 3))
  const approach = k - hold
  const tail = n - 1 - k - brace
  if (hold < 1 || approach < 1 || tail < 1) return frames
  // Sample a slice at a fractional index (nearest source frame — the grid is
  // already dense, so this never invents a pose).
  // Approach and settle are RESAMPLED (fractional, lerped) so compressing
  // them cannot teleport; only the hold and the brace duplicate a pose, and
  // that duplication is the point — it is the stillness the eye reads.
  const atLerp = (i: number): SrcFrame => {
    const c = Math.max(0, Math.min(n - 1, i))
    const i0 = Math.floor(c), i1 = Math.min(n - 1, i0 + 1), f = c - i0
    const A = src[i0], Bf = src[i1]
    if (f < 1e-3) return A
    const p = new Float32Array(CH_COUNT)
    for (let c2 = 0; c2 < CH_COUNT; c2++) p[c2] = A.p[c2] + (Bf.p[c2] - A.p[c2]) * f
    return { t: 0, p, en: 'linear', e: 'linear' } as unknown as SrcFrame
  }
  const at = (i: number) => src[Math.max(0, Math.min(n - 1, Math.round(i)))]
  const out: Keyframe[] = []
  const push = (f: SrcFrame) => out.push({ t: 0, p: Float32Array.from(f.p), e: 'linear', en: 'linear' } as unknown as Keyframe)
  // The approach ACCELERATES into the contact (the reference's `in`): nearly
  // still at the top, then the last step before the snap is the biggest.
  // A linear squeeze would instead teleport on the clip's first frame.
  for (let i = 0; i < approach; i++) {
    const u = i / Math.max(1, approach - 1)
    // Even split: with the floor of three approach frames this already
    // decelerates into the hold, and a power curve on top would make the
    // last windup step the biggest motion in the whole move.
    push(atLerp(u * (k - 1)))
  }
  for (let i = 0; i < hold; i++) push(at(k - 1))
  push(at(k))
  for (let i = 0; i < brace; i++) push(at(k))
  // ...and the settle DECELERATES out of it (`out`): the release is fast,
  // then the body coasts into the guard instead of stopping dead.
  for (let i = 1; i <= tail; i++) {
    const u = i / tail
    push(atLerp(k + (1 - Math.pow(1 - u, 2.2)) * (n - 1 - k)))
  }
  const step = dur / Math.max(1, out.length - 1)
  for (let i = 0; i < out.length; i++) (out[i] as unknown as SrcFrame).t = i * step
  // Frames land slightly off the 1/24 grid after re-timing; keep the clip's
  // own duration exact so hit windows and cancel maths are untouched.
  return out
}

/** Largest per-channel step between consecutive baked frames — the authoring
 * floor is 1/24 s, so a strike that whips faster than this should be split
 * into more keys rather than trusted to interpolation. */
export function bakeProfile(clip: Clip): { peak: number; at: number; fpm: number } {
  const src = clip.frames as unknown as SrcFrame[]
  let peak = 0
  let at = 0
  let total = 0
  for (let i = 1; i < src.length; i++) {
    let m = 0
    for (let c = 0; c < CH_COUNT; c++) {
      const d = Math.abs(src[i].p[c] - src[i - 1].p[c])
      if (d > m) m = d
    }
    total += m
    if (m > peak) { peak = m; at = src[i].t }
  }
  const mean = total / Math.max(1, src.length - 1)
  return { peak, at, fpm: peak / (mean || 1) }
}
