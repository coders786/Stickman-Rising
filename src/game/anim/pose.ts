/** STICKMAN RISING — pose channels.
 *
 * A pose is a compact Float32Array of joint angles (radians) + root offsets.
 * Character-local space: +X = facing direction, +Y = down, origin at the hips.
 * Torso angles are measured from vertical-up (positive = lean toward facing).
 * Limb angles are measured from straight-down (positive = swing toward facing).
 * Raw floats are never angle-wrapped, so continuous spin animations are possible.
 */

export const CH_COUNT = 17

export const CH = {
  rootX: 0,
  rootY: 1,
  rootRot: 2,
  spine: 3,
  head: 4,
  hipL: 5,
  kneeL: 6,
  footL: 7,
  hipR: 8,
  kneeR: 9,
  footR: 10,
  shL: 11,
  elL: 12,
  wrL: 13,
  shR: 14,
  elR: 15,
  wrR: 16,
} as const

export type ChannelKey = keyof typeof CH
export type PoseInput = Partial<Record<ChannelKey, number>>
export type Pose = Float32Array

/** Relaxed combat idle baseline. */
const NEUTRAL_SRC: PoseInput = {
  rootX: 0,
  rootY: 0,
  rootRot: 0.06,
  spine: 0.04,
  head: -0.08,
  hipL: 0.24,
  kneeL: -0.12,
  footL: 0.1,
  hipR: -0.26,
  kneeR: -0.14,
  footR: 0.12,
  shL: 0.12,
  elL: -0.42,
  wrL: -0.2,
  shR: 0.55,
  elR: -0.5,
  wrR: 1.7,
}

export const NEUTRAL: Pose = makePose(NEUTRAL_SRC)

export function makePose(src?: PoseInput): Pose {
  const p = new Float32Array(CH_COUNT)
  if (src) {
    for (const k of Object.keys(src) as ChannelKey[]) {
      p[CH[k]] = src[k] as number
    }
  } else {
    p.set(NEUTRAL)
  }
  return p
}

export function copyPose(dst: Pose, src: Pose): Pose {
  dst.set(src)
  return dst
}

export function blendPose(dst: Pose, a: Pose, b: Pose, t: number): Pose {
  const it = 1 - t
  for (let i = 0; i < CH_COUNT; i++) {
    dst[i] = a[i] * it + b[i] * t
  }
  return dst
}

/** Linear blend into dst (dst itself is one of the sources is NOT allowed). */
export function addPose(dst: Pose, amt: number, src: Pose): void {
  for (let i = 0; i < CH_COUNT; i++) {
    dst[i] += src[i] * amt
  }
}
