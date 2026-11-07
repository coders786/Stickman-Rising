/** STICKMAN RISING — animator: clip sampling with crossfade blending. */

import { CH_COUNT, makePose, Pose, PoseInput } from './pose'
import { EASES, EaseFn, clamp01 } from '../core/utils'

export interface Keyframe {
  t: number
  p: Pose
  e?: string // ease name applied when interpolating INTO this keyframe
}

export interface Clip {
  name: string
  frames: Keyframe[]
  dur: number
  loop: boolean
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

/** Sample clip at time t (seconds) into out. */
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
  const eased = b.e(u)
  for (let c = 0; c < CH_COUNT; c++) {
    out[c] = a.p[c] + (b.p[c] - a.p[c]) * eased
  }
  return out
}

export interface PlayOpts {
  blend?: number
  speed?: number
  restart?: boolean
}

export class Animator {
  pose: Pose = makePose()
  private clip: Clip | null = null
  private time = 0
  private speed = 1
  private blendT = 0
  private blendDur = 0.08
  private fromPose: Pose = makePose()
  private targetPose: Pose = makePose()
  private lastPose: Pose = makePose()

  play(clip: Clip, opts: PlayOpts = {}): void {
    if (this.clip === clip && !opts.restart) {
      // same clip: just adjust speed (used for run cycle tempo)
      this.speed = opts.speed ?? this.speed
      return
    }
    // snapshot current output for crossfade
    this.fromPose.set(this.pose)
    this.lastPose.set(this.pose)
    this.clip = clip
    this.time = 0
    this.speed = opts.speed ?? 1
    this.blendDur = opts.blend ?? 0.08
    this.blendT = 0
    sampleClip(clip, 0, this.targetPose)
  }

  /** returns true when a non-looping clip finished this frame */
  update(dt: number): boolean {
    if (!this.clip) return false
    const before = this.time
    this.time += dt * this.speed
    const finished = !this.clip.loop && this.time >= this.clip.dur && before < this.clip.dur
    if (this.blendT < this.blendDur) {
      // IN-BETWEEN GUARANTEE: the crossfade consumes at most 34ms of blend
      // time per frame, so a transition ALWAYS spans ≥3 interpolated
      // in-between frames — even on janky/low-fps frames where a raw dt
      // would swallow the whole blend (and the pose) in one step.
      this.blendT += Math.min(dt, 0.034)
      const u = clamp01(this.blendT / this.blendDur)
      // smooth crossfade from snapshot to live sample
      sampleClip(this.clip, this.time, scratchA)
      // blend from the frozen snapshot
      const it = 1 - u * u * (3 - 2 * u)
      for (let c = 0; c < CH_COUNT; c++) {
        this.pose[c] = this.fromPose[c] * it + scratchA[c] * (1 - it)
      }
    } else {
      sampleClip(this.clip, this.time, this.pose)
    }
    return finished
  }

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
