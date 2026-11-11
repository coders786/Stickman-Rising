/** STICKMAN RISING — THE SAKUGA SET
 *
 * A 1:1 transcription of the uploaded "THE DARK LORD — Sakuga Study" into
 * this engine's clip format — matched to the game's animation system
 * (see scripts/match-darklord.ts for the full channel map; conversion
 * report at the bottom of this header).
 *
 * WHAT WAS MATCHED:
 *  · every authored key pose at the study's exact 24fps beat grid
 *    (anticipation lengths, 2-frame strike snaps, apex hangs, 3-frame
 *    holds, settle timing — all preserved in seconds);
 *  · per-segment eases (lin/io/in/out → linear/inOutCubic/inCubic/outCubic);
 *  · hand/foot IK targets derived from the study's arm/leg geometry, so
 *    the visible fist/heel lands on the study's authored spot;
 *  · trunk lean, head pitch, hip height, foot contacts, ground vs airborne
 *    feet (flat/point), and the lead/rear arm asymmetry → chest/pelvis
 *    counter-yaw (lands in our CROSS/guard authored ranges).
 *
 * DOCUMENTED ADAPTATIONS (rig differences, kept honest):
 *  · TAIL: our ronin has no 5th limb. The study's tail strikes become
 *    choreography beats carried by the body (SCORPION's whip unroll reads
 *    through the coiled spine + sweeping arm arc at the same frames;
 *    WRATH's tail-to-floor spike becomes the rear-foot stomp contact at
 *    the same beat).
 *  · AURA (pw): dropped — the house law is physical, non-magical.
 *  · SHOULDER ENVELOPE: the study's planar windmills cross ±180°; those
 *    targets rotate to the nearest legal glenohumeral line so the IK
 *    lands the hand exactly where authored everywhere else.
 *  · ELBOW POLE: our elbow channel is sign-locked to the negative
 *    flexion side (house anatomy law); the study's hand POSITIONS are
 *    matched through IK, so the fold reads in the game's own elbow style
 *    while fists/knuckles stay on the authored spot.
 *
 * Conversion report (auto-generated):
 *  JAB — CROSS — SLIP: 11 study keys → 11 emitted (0 continuity mids)
 *   HAMMERFIST LEAP: 11 study keys → 11 emitted (0 continuity mids)
 *   RISING DRAGON: 11 study keys → 11 emitted (0 continuity mids)
 *   SCORPION TAIL STRIKE: 10 study keys → 10 emitted (0 continuity mids)
 *   BARRAGE — SIX-POINT FLURRY: 15 study keys → 15 emitted (0 continuity mids)
 *   FINISHER — DARK LORD'S WRATH: 12 study keys → 14 emitted (2 continuity mids)
 * 
 */

import { keyframe, makeClip, type Clip } from '../anim/animator'
import { type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { handPose, kickPose } from './moveset'

const kf = (t: number, d: PoseInput, ease?: string) => {
  const f = keyframe(t, d, ease)
  applyJointLimits(f.p)
  return f
}
const clip = (name: string, frames: ReturnType<typeof kf>[]): Clip => {
  const c = makeClip(name, frames)
  c.interpolation = 'monotone'
  return c
}

/* ================================================================== */

/** JAB — CROSS — SLIP — study keys 1:1 (24fps beat grid). */
const SAKUGA_JABCROSS = clip('sakugaJabcross', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.125, { rootX: -0.891, rootY: 7.795, rootRot: 0.244, spine: 0.02, head: 0, pelvisYaw: -0.095, chestYaw: 0.027, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 18.932, 36.75, 'flat'), ...handPose('left', 14.2, -0.993), ...handPose('right', 17.569, -3.098), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.208, { rootX: 0.445, rootY: 7.795, rootRot: 0.244, spine: 0.02, head: 0, pelvisYaw: -0.054, chestYaw: -0.047, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 23.386, 31.182, 'point'), ...handPose('left', 14.2, -0.993), ...handPose('right', 26.768, -2.342), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.292, { rootX: 2.227, rootY: 7.795, rootRot: 0.279, spine: 0.02, head: -0.052, pelvisYaw: 0.073, chestYaw: -0.279, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 27.841, 36.75, 'flat'), ...handPose('left', 14.2, -0.993), ...handPose('right', 36, 0), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.333, { rootX: 2.45, rootY: 7.795, rootRot: 0.279, spine: 0.02, head: -0.052, pelvisYaw: 0.067, chestYaw: -0.267, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 27.841, 36.75, 'flat'), ...handPose('left', 14.2, -0.993), ...handPose('right', 35.978, 1.256), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.417, { rootX: 1.782, rootY: 9.466, rootRot: 0.105, spine: 0.02, head: 0.035, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 35.08, 'flat'), ...kickPose('right', 27.841, 35.08, 'flat'), ...handPose('left', 11.883, -1.67), ...handPose('right', 23.62, -3.741), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.542, { rootX: 5.345, rootY: 7.795, rootRot: 0.489, spine: 0.02, head: 0.07, pelvisYaw: -0.353, chestYaw: 0.497, ...kickPose('left', -17.261, 33.966, 'point'), ...kickPose('right', 28.955, 36.75, 'flat'), ...handPose('left', 35.863, -3.138), ...handPose('right', 15.418, -1.078), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.625, { rootX: 6.459, rootY: 8.909, rootRot: 0.541, spine: 0.02, head: 0.07, pelvisYaw: -0.33, chestYaw: 0.454, ...kickPose('left', -17.261, 35.636, 'flat'), ...kickPose('right', 28.955, 35.636, 'flat'), ...handPose('left', 35.978, 1.256), ...handPose('right', 15.418, -1.078), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.792, { rootX: 4.9, rootY: 11.136, rootRot: -0.105, spine: 0.02, head: 0.14, pelvisYaw: -0.081, chestYaw: 0.002, ...kickPose('left', -14.477, 28.955, 'point'), ...kickPose('right', 28.955, 33.409, 'flat'), ...handPose('left', 15.998, -1.4), ...handPose('right', 23.167, -3.256), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1, { rootX: 3.564, rootY: 7.795, rootRot: 0.314, spine: 0.02, head: -0.07, pelvisYaw: -0.075, chestYaw: -0.01, ...kickPose('left', -11.136, 36.75, 'flat'), ...kickPose('right', 26.727, 36.75, 'flat'), ...handPose('left', 12.965, -0.907), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.333, { rootX: 3.118, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])

/** HAMMERFIST LEAP — study keys 1:1 (24fps beat grid). */
const SAKUGA_HAMMER = clip('sakugaHammer', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.167, { rootX: -1.782, rootY: 15.591, rootRot: 0.524, spine: 0.02, head: 0, pelvisYaw: -0.101, chestYaw: 0.039, ...kickPose('left', -18.932, 28.955, 'flat'), ...kickPose('right', 16.705, 28.955, 'flat'), ...handPose('left', -5.98, 33.916), ...handPose('right', -1.531, 35.074), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.25, { rootX: -1.782, rootY: 16.705, rootRot: 0.593, spine: 0.02, head: 0, pelvisYaw: -0.101, chestYaw: 0.039, ...kickPose('left', -18.932, 27.841, 'flat'), ...kickPose('right', 16.705, 27.841, 'flat'), ...handPose('left', -5.98, 33.916), ...handPose('right', -1.531, 35.074), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.333, { rootX: 1.336, rootY: -8.909, rootRot: 0.105, spine: 0.02, head: -0.105, pelvisYaw: -0.101, chestYaw: 0.039, ...kickPose('left', -12.25, 45.659, 'point'), ...kickPose('right', 15.591, 42.318, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.5, { rootX: 7.573, rootY: -38.977, rootRot: -0.105, spine: 0.02, head: -0.209, pelvisYaw: -0.122, chestYaw: 0.076, ...kickPose('left', 11.136, 40.091, 'point'), ...kickPose('right', 33.409, 36.75, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.583, { rootX: 10.245, rootY: -42.318, rootRot: -0.244, spine: 0.02, head: -0.244, pelvisYaw: -0.125, chestYaw: 0.082, ...kickPose('left', 16.705, 40.091, 'point'), ...kickPose('right', 38.977, 36.75, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.667, { rootX: 12.918, rootY: -17.818, rootRot: 0.244, spine: 0.02, head: 0.105, pelvisYaw: -0.122, chestYaw: 0.076, ...kickPose('left', 20.045, 35.636, 'point'), ...kickPose('right', 45.659, 31.182, 'point'), ...handPose('left', 34.334, -10.825), ...handPose('right', 33.609, -12.901), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.75, { rootX: 15.145, rootY: 20.045, rootRot: 0.908, spine: 0.02, head: 0.244, pelvisYaw: -0.148, chestYaw: 0.124, ...kickPose('left', 20.045, 24.5, 'flat'), ...kickPose('right', 55.682, 24.5, 'flat'), ...handPose('left', 14.643, 32.888), ...handPose('right', 12.313, 33.829), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.833, { rootX: 16.036, rootY: 17.818, rootRot: 0.803, spine: 0.02, head: 0.175, pelvisYaw: -0.148, chestYaw: 0.124, ...kickPose('left', 20.045, 26.727, 'flat'), ...kickPose('right', 55.682, 26.727, 'flat'), ...handPose('left', 16.344, 32.076), ...handPose('right', 14.643, 32.888), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(1, { rootX: 15.591, rootY: 12.25, rootRot: 0.524, spine: 0.02, head: 0, pelvisYaw: -0.118, chestYaw: 0.069, ...kickPose('left', 20.045, 32.295, 'flat'), ...kickPose('right', 56.795, 32.295, 'flat'), ...handPose('left', 27.352, 6.064), ...handPose('right', 30.067, 8.056), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.333, { rootX: 15.591, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])

/** RISING DRAGON — study keys 1:1 (24fps beat grid). */
const SAKUGA_DRAGON = clip('sakugaDragon', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.208, { rootX: -1.336, rootY: 17.818, rootRot: 0.419, spine: 0.02, head: 0, pelvisYaw: -0.303, chestYaw: 0.405, ...kickPose('left', -23.386, 26.727, 'flat'), ...kickPose('right', 16.705, 26.727, 'flat'), ...handPose('left', 29.89, -3.935), ...handPose('right', 3.763, 35.803), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.292, { rootX: -1.336, rootY: 18.932, rootRot: 0.489, spine: 0.02, head: 0, pelvisYaw: -0.353, chestYaw: 0.497, ...kickPose('left', -23.386, 25.614, 'flat'), ...kickPose('right', 16.705, 25.614, 'flat'), ...handPose('left', 29.89, -3.935), ...handPose('right', -4.699, 35.692), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.375, { rootX: 1.782, rootY: -6.682, rootRot: -0.035, spine: 0.02, head: -0.244, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -12.25, 43.432, 'point'), ...kickPose('right', 16.705, 45.659, 'point'), ...handPose('left', -18, 31.177), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.458, { rootX: 4.009, rootY: -24.5, rootRot: 0.035, spine: 0.02, head: -0.105, pelvisYaw: 0.151, chestYaw: -0.419, ...kickPose('left', -2.227, 41.205, 'point'), ...kickPose('right', 23.386, 43.432, 'point'), ...handPose('left', -6.251, 35.453), ...handPose('right', 25.954, -6.954), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.583, { rootX: 6.236, rootY: -32.295, rootRot: 0.244, spine: 0.02, head: 0.035, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 3.341, 41.205, 'point'), ...kickPose('right', 27.841, 45.659, 'point'), ...handPose('left', 21.665, -28.751), ...handPose('right', 21.713, -1.9), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.625, { rootX: 6.905, rootY: -33.409, rootRot: 0.279, spine: 0.02, head: 0.035, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 3.341, 42.318, 'point'), ...kickPose('right', 27.841, 46.773, 'point'), ...handPose('left', 19.077, -30.53), ...handPose('right', 18.711, 3.299), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.75, { rootX: 8.464, rootY: -24.5, rootRot: 0.14, spine: 0.02, head: 0, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 7.795, 44.545, 'point'), ...kickPose('right', 34.523, 45.659, 'point'), ...handPose('left', 35.863, -3.138), ...handPose('right', -31.177, 18), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.875, { rootX: 10.245, rootY: 12.25, rootRot: 0.454, spine: 0.02, head: 0.105, pelvisYaw: -0.169, chestYaw: 0.161, ...kickPose('left', 8.909, 32.295, 'flat'), ...kickPose('right', 40.091, 32.295, 'flat'), ...handPose('left', 27.578, 23.14), ...handPose('right', 21.665, 28.751), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(1.083, { rootX: 10.691, rootY: 6.682, rootRot: 0.244, spine: 0.02, head: 0, pelvisYaw: -0.068, chestYaw: -0.022, ...kickPose('left', 7.795, 37.864, 'flat'), ...kickPose('right', 45.659, 37.864, 'flat'), ...handPose('left', 12.355, -0.647), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.333, { rootX: 10.691, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])

/** SCORPION TAIL STRIKE — study keys 1:1 (24fps beat grid). */
const SAKUGA_SCORPION = clip('sakugaScorpion', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.167, { rootX: -2.227, rootY: 13.364, rootRot: 0.419, spine: 0.02, head: 0, pelvisYaw: -0.101, chestYaw: 0.039, ...kickPose('left', -22.273, 31.182, 'flat'), ...kickPose('right', 13.364, 31.182, 'flat'), ...handPose('left', 31.009, -2.713), ...handPose('right', 34.309, -3.002), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.333, { rootX: -3.118, rootY: 15.591, rootRot: 0.524, spine: 0.02, head: -0.244, pelvisYaw: 0.235, chestYaw: -0.572, ...kickPose('left', -24.5, 28.955, 'flat'), ...kickPose('right', 12.25, 28.955, 'flat'), ...handPose('left', -23.14, 27.578), ...handPose('right', 34.309, 3.002), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.458, { rootX: -3.341, rootY: 17.261, rootRot: 0.559, spine: 0.02, head: -0.244, pelvisYaw: 0.235, chestYaw: -0.572, ...kickPose('left', -24.5, 27.284, 'flat'), ...kickPose('right', 12.25, 27.284, 'flat'), ...handPose('left', -23.14, 27.578), ...handPose('right', 34.309, 3.002), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.542, { rootX: 1.782, rootY: 15.591, rootRot: 0.611, spine: 0.02, head: -0.279, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -22.273, 27.284, 'flat'), ...kickPose('right', 27.841, 21.159, 'point'), ...handPose('left', -30.362, 19.343), ...handPose('right', 36, 0), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.583, { rootX: 4.455, rootY: 15.591, rootRot: 0.663, spine: 0.02, head: -0.314, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -18.932, 27.284, 'flat'), ...kickPose('right', 37.864, 28.955, 'flat'), ...handPose('left', -31.177, 18), ...handPose('right', 36, 0), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.667, { rootX: 5.345, rootY: 15.591, rootRot: 0.698, spine: 0.02, head: -0.314, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -18.932, 27.284, 'flat'), ...kickPose('right', 37.864, 28.955, 'flat'), ...handPose('left', -31.177, 18), ...handPose('right', 36, 0), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.833, { rootX: 5.791, rootY: 13.364, rootRot: 0.489, spine: 0.02, head: -0.14, pelvisYaw: 0.235, chestYaw: -0.572, ...kickPose('left', -16.705, 29.511, 'flat'), ...kickPose('right', 37.864, 31.182, 'flat'), ...handPose('left', -18, 31.177), ...handPose('right', 35.863, 3.138), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.042, { rootX: 6.682, rootY: 8.909, rootRot: 0.314, spine: 0.02, head: 0, pelvisYaw: -0.068, chestYaw: -0.022, ...kickPose('left', -7.795, 32.295, 'point'), ...kickPose('right', 37.864, 35.636, 'flat'), ...handPose('left', 19, 0), ...handPose('right', 26.768, -2.342), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.333, { rootX: 7.573, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])

/** BARRAGE — SIX-POINT FLURRY — study keys 1:1 (24fps beat grid). */
const SAKUGA_BARRAGE = clip('sakugaBarrage', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.083, { rootX: 0.891, rootY: 7.795, rootRot: 0.244, spine: 0.02, head: 0, pelvisYaw: -0.054, chestYaw: -0.047, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 22.273, 30.068, 'point'), ...handPose('left', 12.926, -1.359), ...handPose('right', 25.453, -3.351), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.167, { rootX: 1.782, rootY: 7.795, rootRot: 0.314, spine: 0.02, head: -0.052, pelvisYaw: 0.077, chestYaw: -0.285, ...kickPose('left', -18.932, 36.75, 'flat'), ...kickPose('right', 25.614, 36.75, 'flat'), ...handPose('left', 12.926, -1.359), ...handPose('right', 35.995, -0.628), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.25, { rootX: 2.227, rootY: 7.795, rootRot: 0.209, spine: 0.02, head: -0.052, pelvisYaw: -0.054, chestYaw: -0.047, ...kickPose('left', -12.25, 32.295, 'point'), ...kickPose('right', 25.614, 36.75, 'flat'), ...handPose('left', 12.279, -1.508), ...handPose('right', 24.055, -4.242), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.333, { rootX: 3.564, rootY: 8.909, rootRot: 0.454, spine: 0.02, head: 0.052, pelvisYaw: -0.33, chestYaw: 0.454, ...kickPose('left', -10.023, 35.636, 'flat'), ...kickPose('right', 25.614, 35.636, 'flat'), ...handPose('left', 35.863, -3.138), ...handPose('right', 17.123, -2.102), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.417, { rootX: 4.009, rootY: 7.795, rootRot: 0.209, spine: 0.02, head: 0.052, pelvisYaw: -0.128, chestYaw: 0.088, ...kickPose('left', -10.023, 36.75, 'flat'), ...kickPose('right', 30.068, 31.182, 'point'), ...handPose('left', 13.516, -1.66), ...handPose('right', 11.104, -4.55), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.5, { rootX: 5.345, rootY: 10.023, rootRot: 0.524, spine: 0.02, head: 0.105, pelvisYaw: 0.083, chestYaw: -0.297, ...kickPose('left', -10.023, 34.523, 'flat'), ...kickPose('right', 32.295, 34.523, 'flat'), ...handPose('left', 13.45, -2.13), ...handPose('right', 31.141, -16.211), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.583, { rootX: 6.236, rootY: 13.364, rootRot: 0.244, spine: 0.02, head: 0.105, pelvisYaw: 0.107, chestYaw: -0.34, ...kickPose('left', -2.227, 26.727, 'point'), ...kickPose('right', 32.295, 31.182, 'flat'), ...handPose('left', -4.387, 35.732), ...handPose('right', 21.053, -5.641), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.667, { rootX: 7.127, rootY: 4.455, rootRot: 0.209, spine: 0.02, head: -0.14, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 0, 40.091, 'flat'), ...kickPose('right', 32.295, 40.091, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 21.713, -1.9), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.75, { rootX: 8.018, rootY: 7.795, rootRot: 0.244, spine: 0.02, head: 0.035, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', 0, 36.75, 'flat'), ...kickPose('right', 36.75, 31.182, 'point'), ...handPose('left', 19, 0), ...handPose('right', 14.484, -32.639), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.833, { rootX: 8.909, rootY: 11.136, rootRot: 0.628, spine: 0.02, head: 0.14, pelvisYaw: 0.107, chestYaw: -0.34, ...kickPose('left', 0, 33.409, 'flat'), ...kickPose('right', 40.091, 33.409, 'flat'), ...handPose('left', 15.418, -1.078), ...handPose('right', 35.803, 3.763), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.917, { rootX: 9.355, rootY: 14.477, rootRot: -0.105, spine: 0.02, head: -0.105, pelvisYaw: -0.101, chestYaw: 0.039, ...kickPose('left', 5.568, 25.614, 'point'), ...kickPose('right', 44.545, 24.5, 'point'), ...handPose('left', -5.715, 32.409), ...handPose('right', 0, 32.909), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(1.083, { rootX: 12.473, rootY: 12.25, rootRot: 0.663, spine: 0.02, head: -0.07, pelvisYaw: -0.115, chestYaw: 0.063, ...kickPose('left', 12.25, 32.295, 'flat'), ...kickPose('right', 50.114, 32.295, 'flat'), ...handPose('left', 35.912, -2.511), ...handPose('right', 35.803, -3.763), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(1.167, { rootX: 12.918, rootY: 13.364, rootRot: 0.733, spine: 0.02, head: -0.07, pelvisYaw: -0.115, chestYaw: 0.063, ...kickPose('left', 12.25, 31.182, 'flat'), ...kickPose('right', 50.114, 31.182, 'flat'), ...handPose('left', 35.978, 1.256), ...handPose('right', 35.995, -0.628), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(1.333, { rootX: 12.473, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])

/** FINISHER — DARK LORD'S WRATH — study keys 1:1 (24fps beat grid). */
const SAKUGA_WRATH = clip('sakugaWrath', [
  kf(0, { rootX: 0, rootY: 0, rootRot: 0.314, spine: 0.02, head: 0.454, pelvisYaw: -0.088, chestYaw: 0.014, ...kickPose('left', -8.909, 44.545, 'flat'), ...kickPose('right', 8.909, 44.545, 'flat'), ...handPose('left', 0, 36), ...handPose('right', 6.251, 35.453), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.167, { rootX: -1.336, rootY: 2.227, rootRot: -0.14, spine: 0.02, head: -0.349, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -22.273, 42.318, 'flat'), ...kickPose('right', 18.932, 42.318, 'flat'), ...handPose('left', -31.177, 18), ...handPose('right', 35.077, -8.098), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(0.292, { rootX: -1.336, rootY: 1.67, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -22.273, 42.875, 'flat'), ...kickPose('right', 18.932, 42.875, 'flat'), ...handPose('left', -31.177, 18), ...handPose('right', 35.077, -8.098), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.458, { rootX: -1.336, rootY: 1.67, rootRot: -0.279, spine: 0.02, head: -0.454, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -22.273, 42.875, 'flat'), ...kickPose('right', 18.932, 42.875, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.583, { rootX: -1.336, rootY: 2.227, rootRot: -0.349, spine: 0.02, head: -0.524, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -22.273, 42.318, 'flat'), ...kickPose('right', 18.932, 42.318, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'),
  kf(0.75, { rootX: -3.118, rootY: 15.591, rootRot: 0.524, spine: 0.02, head: -0.175, pelvisYaw: 0.25, chestYaw: -0.6, ...kickPose('left', -24.5, 28.955, 'flat'), ...kickPose('right', 12.25, 28.955, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 35.65, -5.01), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(0.771, { rootX: 0.891, rootY: 13.364, rootRot: 0.489, spine: 0.02, head: -0.14, pelvisYaw: 0.125, chestYaw: -0.372, shL: 1.551, elL: -0.653, shR: 1.382, elR: -0.653, hipL: 0.252, kneeL: -1.7, footL: -0.939, hipR: 1.356, kneeR: -1.612, footR: 0.021, armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'), // continuity mid
  kf(0.792, { rootX: 4.9, rootY: 11.136, rootRot: 0.454, spine: 0.02, head: -0.105, pelvisYaw: -0.001, chestYaw: -0.144, ...kickPose('left', -11.136, 23.386, 'point'), ...kickPose('right', 24.5, 26.727, 'point'), ...handPose('left', -9.317, 34.773), ...handPose('right', 15.214, 32.627), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.813, { rootX: 8.241, rootY: 11.693, rootRot: 0.628, spine: 0.02, head: -0.087, pelvisYaw: -0.205, chestYaw: 0.228, shL: 0.994, elL: -0.653, shR: 0.047, elR: -0.653, hipL: 0.762, kneeL: -1.853, footL: -0.939, hipR: 1.264, kneeR: -0.828, footR: 0.021, armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'), // continuity mid
  kf(0.833, { rootX: 11.582, rootY: 12.25, rootRot: 0.803, spine: 0.02, head: -0.07, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 5.568, 32.295, 'flat'), ...kickPose('right', 47.886, 32.295, 'flat'), ...handPose('left', 35.933, -2.198), ...handPose('right', -29.489, 20.649), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inCubic'),
  kf(0.917, { rootX: 12.918, rootY: 12.25, rootRot: 0.873, spine: 0.02, head: -0.07, pelvisYaw: -0.41, chestYaw: 0.6, ...kickPose('left', 5.568, 32.295, 'flat'), ...kickPose('right', 47.886, 32.295, 'flat'), ...handPose('left', 35.933, -2.198), ...handPose('right', -29.489, 20.649), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(1.083, { rootX: 12.918, rootY: 5.568, rootRot: 0.349, spine: 0.02, head: -0.209, pelvisYaw: -0.051, chestYaw: -0.053, ...kickPose('left', 14.477, 34.523, 'point'), ...kickPose('right', 44.545, 38.977, 'flat'), ...handPose('left', -4.699, 35.692), ...handPose('right', 7.792, 35.147), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
  kf(1.208, { rootX: 12.918, rootY: 1.114, rootRot: 0.209, spine: 0.02, head: 0.175, pelvisYaw: -0.075, chestYaw: -0.01, ...kickPose('left', 20.045, 43.432, 'flat'), ...kickPose('right', 41.205, 43.432, 'flat'), ...handPose('left', -1.884, 35.951), ...handPose('right', 5.632, 35.557), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'outCubic'),
  kf(1.333, { rootX: 12.918, rootY: 0, rootRot: 0.314, spine: 0.02, head: 0.454, pelvisYaw: -0.088, chestYaw: 0.014, ...kickPose('left', -8.909, 44.545, 'flat'), ...kickPose('right', 8.909, 44.545, 'flat'), ...handPose('left', 0, 36), ...handPose('right', 6.251, 35.453), armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'inOutCubic'),
])
export const SAKUGA_JABCROSS_CLIP = SAKUGA_JABCROSS
export const SAKUGA_HAMMER_CLIP = SAKUGA_HAMMER
export const SAKUGA_DRAGON_CLIP = SAKUGA_DRAGON
export const SAKUGA_SCORPION_CLIP = SAKUGA_SCORPION
export const SAKUGA_BARRAGE_CLIP = SAKUGA_BARRAGE
export const SAKUGA_WRATH_CLIP = SAKUGA_WRATH
