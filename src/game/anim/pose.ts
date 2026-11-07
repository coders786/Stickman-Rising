/** STICKMAN RISING — pose channels.
 *
 * A pose is a compact Float32Array of joint angles (radians) + root offsets.
 * Character-local space: +X = facing direction, +Y = down, origin at the hips.
 * Torso angles are measured from vertical-up (positive = lean toward facing).
 * Limb angles are measured from straight-down (positive = swing toward facing).
 * Raw floats are never angle-wrapped, so continuous spin animations are possible.
 *
 * ── 3D DEPTH CHANNELS (rig3d) ──────────────────────────────────────────
 * The rig is genuinely three-dimensional. Axis convention (documented once,
 * used everywhere — see anim/rig3d.ts):
 *   +X = facing direction (horizontal)
 *   +Y = DOWN (canvas vertical — character-local, feet at +49)
 *   +Z = TOWARD THE CAMERA (out of the gameplay plane)
 * Yaw channels rotate a limb/girdle around the vertical (Y) axis:
 *   positive yaw swings the limb/segment TOWARD the camera (+Z).
 * Channels 17–25 are appended AFTER the classic 2D set so every existing
 * keyframe, clip, and enemy pose stays bit-compatible (they simply read as
 * depth-zero until authored otherwise).
 */

export const CH_COUNT = 26

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
  /* ---- 3D depth channels (all default 0 = flat 2D pose) ---- */
  /** whole-body depth offset (visual lean into/out of the screen) */
  rootZ: 17,
  /** pelvis yaw around the vertical spine axis; + = near hip swings forward */
  pelvisYaw: 18,
  /** shoulder-girdle yaw ON TOP of the pelvis fraction (counter-rotation) */
  chestYaw: 19,
  /** per-leg hip yaw: + swings that leg toward the camera */
  hipLz: 20,
  hipRz: 21,
  /** per-arm shoulder yaw: + swings that arm toward the camera */
  armLz: 22,
  armRz: 23,
  /** blade yaw: + points the kissaki toward the camera (out-of-plane cut) */
  bladeYaw: 24,
  /** grip depth offset: translates the whole weapon along +Z (thrust paths) */
  bladeZ: 25,
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
  // 3D depth channels: the guard is square-on (0 depth articulation)
  rootZ: 0,
  pelvisYaw: 0,
  chestYaw: 0,
  hipLz: 0,
  hipRz: 0,
  armLz: 0,
  armRz: 0,
  bladeYaw: 0,
  bladeZ: 0,
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
