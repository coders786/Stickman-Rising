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

/** Chūdan-no-kamae combat baseline — the guard every attack starts from and
 * returns to. Blade sum (shR+elR+wrR) ≈ 1.5 → blade points at the enemy's
 * throat, tip level. This is the in-between continuity anchor: partial
 * keyframes inherit these channels, so every clip blends guard→guard. */
const NEUTRAL_SRC: PoseInput = {
  rootX: 0,
  rootY: 0,
  rootRot: 0.1,
  spine: 0.05,
  head: -0.1,
  hipL: -0.3,
  kneeL: -0.42,
  footL: 0.12,
  hipR: 0.32,
  kneeR: -0.5,
  footR: 0.12,
  shL: 0.5,
  elL: -0.85,
  wrL: -0.3,
  shR: 0.85,
  elR: -0.5,
  wrR: 1.15,
}

export const NEUTRAL: Pose = (() => {
  const p = new Float32Array(CH_COUNT)
  for (const k of Object.keys(NEUTRAL_SRC) as ChannelKey[]) {
    p[CH[k]] = NEUTRAL_SRC[k] as number
  }
  return p
})()

export function makePose(src?: PoseInput): Pose {
  const p = new Float32Array(CH_COUNT)
  // ALWAYS base on the guard (NEUTRAL), then overlay specified channels.
  // The old semantics (zeros for unspecified channels) made every partial
  // keyframe blip unlisted joints to rigid-zero and back — the hidden
  // source of chained-attack snaps. With guard-merging, `keyframe(t, {})`
  // IS the chūdan guard and partial frames keep continuity for free.
  p.set(NEUTRAL)
  if (src) {
    for (const k of Object.keys(src) as ChannelKey[]) {
      p[CH[k]] = src[k] as number
    }
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
