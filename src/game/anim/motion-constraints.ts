/** Critically damped, velocity-limited anatomical pose tracking.
 * Runs BEFORE hand/foot IK; it never filters the solved contact points.
 */
import { CH, CH_COUNT, makePose, type Pose } from './pose'
import { applyJointLimits } from './limits'
import { clamp } from '../core/utils'

const TRACKED = [CH.rootX, CH.rootY, CH.rootRot, CH.spine, CH.head,
  CH.hipL, CH.hipR, CH.kneeL, CH.kneeR, CH.footL, CH.footR,
  CH.shL, CH.shR, CH.elL, CH.elR, CH.pelvisYaw, CH.chestYaw,
  CH.armLz, CH.armRz, CH.foreLz, CH.foreRz] as const

const ARM_CHANNELS=new Set<number>([CH.shL,CH.elL,CH.shR,CH.elR,CH.armLz,CH.armRz,CH.foreLz,CH.foreRz])

export class AnatomicalMotion {
  private pose = makePose()
  private velocity = new Float32Array(CH_COUNT)
  private ready = false

  reset(): void { this.ready = false; this.velocity.fill(0) }

  adoptDisplayArms(pose:Pose):void{
    for(const ch of [CH.shL,CH.elL,CH.shR,CH.elR]){this.pose[ch]=pose[ch];this.velocity[ch]=0}
  }

  update(target: Pose, dt: number, active = true, trackArms=true): Pose {
    applyJointLimits(target)
    if (!active || !this.ready) {
      this.pose.set(target); this.velocity.fill(0); this.ready = active
      return target
    }
    // Bound integration steps, not the elapsed time. Long frames cannot
    // explode a spring; resuming from a large discontinuity reinitializes.
    if (!Number.isFinite(dt) || dt <= 0) { target.set(this.pose); return target }
    if (dt > .2) { this.reset(); return this.update(target, 0, active) }
    for (const ch of TRACKED) {
      if(!trackArms&&ARM_CHANNELS.has(ch)){
        this.pose[ch]=target[ch];this.velocity[ch]=0;continue
      }
      const translation = ch === CH.rootX || ch === CH.rootY
      const omega = translation ? 30 : ch === CH.head ? 22 : 36
      const maxSpeed = translation ? 95 : ch === CH.rootRot || ch === CH.spine || ch === CH.head ? 5 : 18
      const error = this.pose[ch] - target[ch]
      const exp = Math.exp(-omega * dt)
      const temp = (this.velocity[ch] + omega * error) * dt
      const proposed = target[ch] + (error + temp) * exp
      const delta = clamp(proposed - this.pose[ch], -maxSpeed * dt, maxSpeed * dt)
      let next = this.pose[ch] + delta
      this.velocity[ch] = clamp((this.velocity[ch] - omega * temp) * exp, -maxSpeed, maxSpeed)
      // Do not overshoot a target on a stop/reversal.
      if ((target[ch] - this.pose[ch]) * (target[ch] - next) < 0) { next = target[ch]; this.velocity[ch] = 0 }
      this.pose[ch] = next
      target[ch] = next
    }
    applyJointLimits(target)
    this.pose.set(target)
    return target
  }
}
