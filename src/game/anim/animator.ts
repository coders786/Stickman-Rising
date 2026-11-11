/** STICKMAN RISING — animator: clip sampling with a single crossfade.
 *
 * THE ONE AUTHORITY CONTRACT
 * --------------------------
 * `animator.pose` is the ONLY base pose the character has. A clip is sampled
 * (with one short, linear crossfade from whatever the previous clip left
 * visible), ROM-clamped once, and handed to the entity. Nothing else in the
 * engine re-derives, re-times, filters, re-exposes or re-solves the clip:
 *
 *   clip → sampleClip → crossfade → applyJointLimits → animator.pose
 *
 * What used to live here and is deliberately gone (see docs/ANIMATION.md):
 *   · InertialTransition residual — an invisible blend that kept running for
 *     up to 280 ms AFTER a clip change, so the visible body could be a
 *     synthesis of three clips. The crossfade below is at most `blend`
 *     seconds and never outlives the clip that owns the state.
 *   · deferred transitions + prepared-layer re-basing, which let later
 *     procedural writers replace the sampled target before the blend
 *     resolved.
 *   · displayed-pose capture / adopt (a feedback loop that fed the rendered
 *     pose back into the next blend, breaking clip determinism).
 *
 * `sampleClip` is pure: same clip + same time = same pose, always.
 */

import {applyJointLimits} from './limits'
import { CH, CH_COUNT, makePose, Pose, PoseInput } from './pose'
import { EASES, EaseFn, clamp01 } from '../core/utils'

export interface Keyframe {
  t: number
  p: Pose
  e?: string // ease name applied when interpolating INTO this keyframe
}

export interface Clip {
  equipment?:'free'|'armed'
  source?:Clip
  name: string
  frames: Keyframe[]
  dur: number
  loop: boolean
  /** Shape-preserving C1 interpolation for natural locomotion. */
  interpolation?: 'monotone'
}

interface KeyedEase {
  t: number
  p: Pose
  e: EaseFn
}

export function keyframe(t: number, src: PoseInput, ease?: string): Keyframe {
  return { t, p: makePose(src), e: ease }
}

export function makeClip(name: string, frames: Keyframe[], loop = false): Clip {
  const keyed: KeyedEase[] = frames.map((f) => ({
    t: f.t,
    p: f.p,
    e: EASES[f.e ?? 'inOutCubic'] ?? EASES.inOutCubic,
  }))
  const dur = frames.length ? frames[frames.length - 1].t : 0
  return { name, frames: keyed as unknown as Keyframe[], dur, loop }
}

const scratchA = makePose()
const scratchB = makePose()

/** Sample clip at time t (seconds) into out. Pure: no hidden filters. */
export function sampleClip(clip: Clip, t: number, out: Pose): Pose {
  const frames = clip.frames as unknown as KeyedEase[]
  const n = frames.length
  if (n === 0) return out
  let time = t
  if (clip.loop && clip.dur > 0) time = time % clip.dur
  if (time <= frames[0].t) {
    out.set(frames[0].p)
    return out
  }
  if (time >= frames[n - 1].t) {
    out.set(frames[n - 1].p)
    return out
  }
  // binary-ish search
  let i = 0
  for (let j = 0; j < n - 1; j++) {
    if (time >= frames[j].t && time <= frames[j + 1].t) {
      i = j
      break
    }
  }
  const a = frames[i]
  const b = frames[i + 1]
  const span = b.t - a.t
  const u = span > 1e-6 ? clamp01((time - a.t) / span) : 1
  if (clip.interpolation === 'monotone') {
    // Time-aware harmonic tangents (Fritsch–Carlson). Local extrema get
    // zero tangent, preventing knee/hip overshoot. Loop neighbors wrap in
    // time, so velocity is continuous across the left/right-cycle seam.
    const last = n - 1
    const before = i > 0 ? frames[i - 1] : clip.loop ? frames[last - 1] : a
    const after = i + 2 < n ? frames[i + 2] : clip.loop ? frames[1] : b
    const prevSpan = i > 0 ? a.t - before.t : clip.loop ? clip.dur - before.t : span
    const nextSpan = i + 2 < n ? after.t - b.t : clip.loop ? after.t : span
    const tangent = (d0: number, d1: number, h0: number, h1: number): number => {
      if (d0 * d1 <= 0) return 0
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0
      return (w1 + w2) / (w1 / d0 + w2 / d1)
    }
    for (let c = 0; c < CH_COUNT; c++) {
      const slope = (b.p[c] - a.p[c]) / span
      const m0 = tangent((a.p[c] - before.p[c]) / prevSpan, slope, prevSpan, span)
      const m1 = tangent(slope, (after.p[c] - b.p[c]) / nextSpan, span, nextSpan)
      const u2 = u * u, u3 = u2 * u
      out[c] = (2*u3 - 3*u2 + 1)*a.p[c] + (u3 - 2*u2 + u)*span*m0
        + (-2*u3 + 3*u2)*b.p[c] + (u3 - u2)*span*m1
    }
  } else {
    const eased = b.e(u)
    for (let c = 0; c < CH_COUNT; c++) out[c] = a.p[c] + (b.p[c] - a.p[c]) * eased
  }
  return out
}

export interface PlayOpts {
  /** crossfade length in seconds (default 0.08). Never exceeds the clip. */
  blend?: number
  speed?: number
  restart?: boolean
  /** Preserve normalized stride phase across walk/run/sprint changes. */
  syncPhase?: boolean
  /** MIXED FRAME-RATE TIMING (anime limited animation): quantizes clip
   * time to N steps/second (24 = "on twos"). The body snaps between
   * authored keys while FX keep integrating at full rate. */
  stepRate?: number
}

export class Animator {
  pose: Pose = makePose()
  private clip: Clip | null = null
  private time = 0
  private speed = 1
  /** frozen pose the crossfade starts from */
  private fromPose: Pose = makePose()
  private target: Pose = makePose()
  private blendDur = 0.08
  private blendAge = 0
  /** stepped-clock accumulator (stepRate > 0 → quantized anime timing) */
  private stepRate = 0
  private stepAcc = 0

  play(clip: Clip, opts: PlayOpts = {}): void {
    if (this.clip === clip && !opts.restart) {
      // same clip: just adjust speed (used for run cycle tempo)
      this.speed = opts.speed ?? this.speed
      if (opts.stepRate !== undefined) this.stepRate = opts.stepRate
      return
    }
    // snapshot exactly what the viewer sees right now — the crossfade is
    // visible-to-visible, never from an unseen authoring pose
    this.fromPose.set(this.pose)
    const phase = opts.syncPhase && this.clip?.loop && clip.loop && this.clip.dur > 0
      ? (this.time / this.clip.dur) % 1 : 0
    this.clip = clip
    this.time = phase * clip.dur
    this.speed = opts.speed ?? 1
    this.blendDur = Math.max(0, opts.blend ?? 0.08)
    this.stepRate = opts.stepRate ?? 0
    this.stepAcc = 0
    this.blendAge = 0
    if (this.blendDur <= 0) this.fromPose.set(this.pose)
  }

  /** returns true when a non-looping clip finished this frame */
  update(dt: number, loopPhase?: number, physicsTime?:number): boolean {
    if (!this.clip) return false
    const before = this.time
    if (this.stepRate > 0) {
      // ANIME STEPPED TIMING: advance the clock only in fixed quanta, so
      // the pose HOLDS each key for 1/stepRate s — keyframed beats on twos.
      this.stepAcc += dt * this.speed
      const step = 1 / this.stepRate
      if (this.stepAcc >= step) {
        const n = Math.floor(this.stepAcc / step)
        this.stepAcc -= n * step
        this.time += n * step
      }
    } else {
      this.time += dt * this.speed
    }
    // A looping clip may be driven by the caller's own clock (stride phase).
    if (this.clip.loop && loopPhase !== undefined && Number.isFinite(loopPhase)) {
      this.time = ((loopPhase % 1 + 1) % 1) * this.clip.dur
    }
    // Non-looping force-driven actions may supply their authored sample
    // clock. The crossfade still advances in real dt.
    if(!this.clip.loop&&physicsTime!==undefined&&Number.isFinite(physicsTime)){
      this.time=Math.max(0,Math.min(this.clip.dur,physicsTime))
    }
    const finished = !this.clip.loop && this.time >= this.clip.dur && before < this.clip.dur
    sampleClip(this.clip, this.time, scratchA)
    applyJointLimits(scratchA)
    // ONE crossfade, in real time, visible → visible. Short by design: a
    // pose the author placed must be on screen by the time its state is.
    this.blendAge += Number.isFinite(dt) ? Math.max(0, dt) : 0
    if (this.blendAge < this.blendDur) {
      const u = clamp01(this.blendAge / this.blendDur)
      const t = u * u * (3 - 2 * u)
      const it = 1 - t
      const from = this.fromPose
      for (let c = 0; c < CH_COUNT; c++) this.pose[c] = from[c] * it + scratchA[c] * t
      // the blended result can leave the ROM between two legal clips
      applyJointLimits(this.pose)
    } else {
      this.pose.set(scratchA)
    }
    return finished
  }

  get transitioning():boolean{return this.blendAge < this.blendDur}

  getClip(): Clip | null {
    return this.clip
  }

  getTime(): number {
    return this.time
  }

  /** normalized progress for non-loop clips */
  progress(): number {
    if (!this.clip || this.clip.dur <= 0) return 1
    return clamp01(this.time / this.clip.dur)
  }

  isDone(): boolean {
    return this.clip != null && !this.clip.loop && this.time >= this.clip.dur
  }
}

export { scratchA, scratchB }
