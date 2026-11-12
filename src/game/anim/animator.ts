/** STICKMAN RISING — animator: clip sampling with crossfade blending. */

import {applyJointLimits} from './limits'
import {InertialTransition} from './inertial-transition'
import { CH, CH_COUNT, makePose, Pose, PoseInput } from './pose'
import { EASES, EaseFn, clamp01 } from '../core/utils'

const TAU = Math.PI * 2

/** nearest angle-equivalent of `from` to `to` (adds whole turns only). */
function unwrapNear(from: number, to: number): number {
  const d = to - from
  return from + Math.round(d / TAU) * TAU
}

export interface Keyframe {
  t: number
  p: Pose
  e?: string // ease name applied when interpolating INTO this keyframe
  /** the authored ease NAME (survives `e` being compiled to a function, so
   * the bake step in anim/bake.ts can replay the exact curve) */
  en?: string
}

export interface Clip {
  equipment?:'free'|'armed'
  source?:Clip
  /** set by the bake when the clip was re-timed around a contact: the moment
   * the pose actually snaps. Hit windows should be derived from this rather
   * than guessed, so the hitbox cannot drift off the strike. */
  snapAt?: number
  name: string
  frames: Keyframe[]
  dur: number
  loop: boolean
  /** Shape-preserving C1 interpolation for natural locomotion. */
  interpolation?: 'monotone' | 'step'
}

interface KeyedEase {
  t: number
  p: Pose
  e: EaseFn
}

export function keyframe(t: number, src: PoseInput, ease?: string): Keyframe {
  return { t, p: makePose(src), e: ease, en: ease }
}

export function makeClip(name: string, frames: Keyframe[], loop = false): Clip {
  const keyed: KeyedEase[] = frames.map((f) => ({
    t: f.t,
    p: f.p,
    e: EASES[f.e ?? 'inOutCubic'] ?? EASES.inOutCubic,
    en: f.en ?? f.e,
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
  if(clip.interpolation==='step'){
    // Fighting-game A/B/C exposure: choose a drawing, never synthesize an
    // interpolated pose between it and the next drawing.
    out.set(u<.5?a.p:b.p)
  } else if (clip.interpolation === 'monotone') {
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
  /** Contact deadline: arm residual must clear before an authored strike. */
  armBlendLimit?:number
  blend?: number
  speed?: number
  restart?: boolean
  /** Preserve normalized stride phase across walk/run/sprint changes. */
  syncPhase?: boolean
  /** MIXED FRAME-RATE TIMING (anime limited animation): quantizes clip
   * time to N steps/second (24 = "on twos"). The body snaps between
   * authored keys — crisp 2D combat beats — while the physics layers
   * (blade lag spring, trails, FX) keep integrating at a full 60/120Hz.
   * The crossfade still runs on real dt, so transitions stay smooth. */
  stepRate?: number
}

export class Animator {
  constructor(private deferTransitions=false){}
  private preparedPending=false
  private incomingVelocity=new Float32Array(CH_COUNT)
  private preparedNext=makePose()

  pose: Pose = makePose()
  private clip: Clip | null = null
  private time = 0
  private speed = 1
  private transition=new InertialTransition()
  private displayedVelocity=new Float32Array(CH_COUNT)
  private armBlendLimit=Infinity
  private blendDur = 0.08
  private fromPose: Pose = makePose()
  private targetPose: Pose = makePose()
  private displayedPose: Pose = makePose()
  private hasDisplayPose = false
  private lastPose: Pose = makePose()
  private velocity: Pose = new Float32Array(CH_COUNT)
  private fromVelocity: Pose = new Float32Array(CH_COUNT)
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
    // snapshot current output for crossfade
    this.fromPose.set(this.hasDisplayPose ? this.displayedPose : this.pose)
    this.fromVelocity.set(this.hasDisplayPose ? this.displayedVelocity : this.velocity)
    this.lastPose.set(this.pose)
    const phase = opts.syncPhase && this.clip?.loop && clip.loop && this.clip.dur > 0
      ? (this.time / this.clip.dur) % 1 : 0
    this.clip = clip
    this.time = phase * clip.dur
    this.speed = opts.speed ?? 1
    this.blendDur = opts.blend ?? 0.08
    this.armBlendLimit=opts.armBlendLimit??Infinity
    this.stepRate = opts.stepRate ?? 0
    this.stepAcc = 0
    sampleClip(clip, this.time, this.targetPose)
    applyJointLimits(this.targetPose)
    // WRIST SHORTEST-PATH CROSSFADE: wrist channels are raw floats so
    // within-clip spins can wind past ±π. But a CROSSFADE between two clips
    // living in different winding regions (attack guard ≈ −0.8…1.2 rad vs
    // the up-wound locomotion/dash carries ≈ 5.15…6.06 rad) interpolates
    // linearly — sweeping the blade a FULL TURN the long way through the
    // floor: the "sword spins when dashing" artifact. Snap the frozen
    // snapshot to the nearest equivalent turn of the incoming clip's first
    // frame so every clip-to-clip blend takes the short arc. Within-clip
    // authored sweeps are untouched (visual angle mod 2π is preserved).
    this.fromPose[CH.wrR] = unwrapNear(this.fromPose[CH.wrR], this.targetPose[CH.wrR])
    this.fromPose[CH.wrL] = unwrapNear(this.fromPose[CH.wrL], this.targetPose[CH.wrL])
    const h=1/240
    sampleClip(clip,this.time+h*this.speed,scratchB)
    applyJointLimits(scratchB)
    this.transition.begin(this.fromPose,this.fromVelocity,this.targetPose,scratchB,h,this.blendDur,this.armBlendLimit)
    for(let ch=0;ch<CH_COUNT;ch++)this.incomingVelocity[ch]=(scratchB[ch]-this.targetPose[ch])/h
    this.preparedPending=this.deferTransitions

  }

  /** returns true when a non-looping clip finished this frame */
  update(dt: number, loopPhase?: number, physicsTime?:number): boolean {
    if (!this.clip) return false
    const before = this.time
    this.lastPose.set(this.pose)
    if (this.stepRate > 0) {
      // ANIME STEPPED TIMING: advance the clock only in fixed quanta, so
      // the pose HOLDS each key for 1/24s — keyframed beats on twos. The
      // blade/trails live on the full-rate physics layers outside.
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
    // A planted gait owns ONE full-cycle clock. Do not independently run
    // the torso at half the feet's frequency or drift across state changes.
    if (this.clip.loop && loopPhase !== undefined && Number.isFinite(loopPhase)) {
      this.time = ((loopPhase % 1 + 1) % 1) * this.clip.dur
    }
    // Non-looping force-driven actions may supply their authored sample
    // clock. Crossfade/velocity tracking still advance normally in real dt.
    if(!this.clip.loop&&physicsTime!==undefined&&Number.isFinite(physicsTime)){
      this.time=Math.max(0,Math.min(this.clip.dur,physicsTime))
    }
    const finished = !this.clip.loop && this.time >= this.clip.dur && before < this.clip.dur
    // Preserve outgoing pose AND velocity as a decaying residual on the
    // moving destination. Arms resolve from hand-space, not angle lerps.
    // Elapsed seconds are never capped to invent extra rendered frames.
    sampleClip(this.clip,this.time,scratchA)
    applyJointLimits(scratchA)
    if(this.deferTransitions)this.pose.set(scratchA)
    else this.transition.apply(scratchA,dt,this.pose)
    if(dt>1e-6 && Number.isFinite(dt))for(let c=0;c<CH_COUNT;c++){
      const cap=c<2?80:10
      this.velocity[c]=Math.max(-cap,Math.min(cap,(this.pose[c]-this.lastPose[c])/dt))
    }
    return finished
  }

  /** Player calls this AFTER contextual/procedural targets, BEFORE final
   * combat/contact IK. Otherwise those layers erase a perfectly good bridge. */
  applyPreparedTransition(target:Pose,dt:number):void{
    if(!this.deferTransitions)return
    if(this.preparedPending){
      const h=1/240
      for(let ch=0;ch<CH_COUNT;ch++)this.preparedNext[ch]=target[ch]+this.incomingVelocity[ch]*h
      this.transition.begin(this.fromPose,this.fromVelocity,target,this.preparedNext,h,this.blendDur,this.armBlendLimit)
      this.preparedPending=false
    }
    this.transition.apply(target,dt,target)
  }

  /** Final constrained output seeds the next switch, without feeding
   * procedural offsets back into the current clip or its filters. */
  captureDisplayPose(pose:Pose,dt=0):void{
    if(this.hasDisplayPose&&dt>1e-6&&Number.isFinite(dt))for(let ch=0;ch<CH_COUNT;ch++){
      const cap=ch<2?100:12
      let delta=pose[ch]-this.displayedPose[ch]
      if(ch===CH.wrL||ch===CH.wrR)delta-=Math.round(delta/TAU)*TAU
      this.displayedVelocity[ch]=Math.max(-cap,Math.min(cap,delta/dt))
    }
    this.displayedPose.set(pose);this.hasDisplayPose=true
  }

  /** Make a limited-animation display pose the source of the NEXT blend.
   * Without this, an attack could blend from an unseen continuous arm pose. */
  adoptDisplayPose(pose:Pose,channels:readonly number[]):void{
    for(const ch of channels){this.pose[ch]=pose[ch];this.velocity[ch]=0}
  }

  get transitioning():boolean{return this.transition.active}

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
