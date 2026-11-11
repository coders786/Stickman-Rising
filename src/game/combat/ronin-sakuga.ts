/** STICKMAN RISING — THE SHADOW RONIN SET
 *
 * A 1:1 transcription of upload/Shadow_Ronin.html ("SHADOW RONIN — Cinematic
 * Dual-Blade Animation Studio") into this engine's clip format — matched to
 * the game's animation system (see scripts/match-ronin.ts for the full
 * channel map; conversion report at the bottom of this header).
 *
 * WHAT WAS MATCHED:
 *  · every authored key pose at the reference's exact 24fps beat grid
 *    (chamber loads, stillness frames, 2-frame strike snaps, apex hangs,
 *    impact holds, settle timing — all preserved in seconds);
 *  · per-segment eases (lin/io/in/out → linear/inOutCubic/inCubic/outCubic)
 *    riding the ARRIVING key — the reference's own bake() law. These clips
 *    deliberately do NOT use monotone interpolation: the authored in/out
 *    asymmetry IS the choreography (explosive ignition 'out', decelerating
 *    settles 'io', weight-shift accelerations 'in');
 *  · hand/foot IK targets derived from the reference's arm/leg geometry, so
 *    the visible fist/heel/blade lands on the authored spot;
 *  · THE 3D DEPTH LAYER the reference introduced: z + fov → rootZ (the
 *    perspective-band depth pulse), rotY → the counter-yaw chain
 *    (pelvis/chest twist + arm yaw sweep + bladeYaw), z → bladeZ (thrust
 *    travel that spears the lens). VORTEX rotates through real depth;
 *    OMEGA dives to the far plane and bursts past the camera;
 *  · trunk lean, head pitch, hip height, world-planted feet (the reference
 *    stores feet in world space — planted stances keep their lunge splits
 *    while the hips drive forward), ground vs airborne feet.
 *
 * DOCUMENTED ADAPTATIONS (rig differences, kept honest):
 *  · DUAL BLADES: our ronin carries one katana (near/lead hand — the
 *    reference's lead blade) + a live off-hand (the reference's rear blade
 *    becomes unarmed counters, saya control and X-slash crossings).
 *  · TAIL: no 5th limb — beats carried by the counter-rotation + the
 *    player's scarf physics layer.
 *  · AURA (pw): dropped — the house law is physical, non-magical.
 *  · SHOULDER ENVELOPE: the reference's planar windmills cross ±180°;
 *    those targets rotate to the nearest legal glenohumeral line so the IK
 *    lands the hand exactly where authored everywhere else.
 *  · DEPTH COMPRESSION: the reference's fovScale 0.4..2.8 / z ±350 excursions
 *    compress into the rig's perspective band (rootZ ±~55 around FOCUS 620
 *    → body scale 0.92..1.10) — the depth READ without breaking 2D
 *    gameplay geometry.
 *
 * Impact events + slow map (hitstop windows) survive as RONIN_META —
 * the AttackDef layer (combat/ronin.ts) places hit windows, hitstop, slam
 * impacts and finisher FX on these exact beats.
 *
 * Conversion report (auto-generated):
 *  IAIJUTSU CROSS-DRAW IMPACT: 7 reference keys → 9 emitted (2 continuity mids)
 *   TWIN MOMENTUM CRESCENT: 7 reference keys → 10 emitted (3 continuity mids)
 *   AVALANCHE METEOR DROP: 7 reference keys → 11 emitted (4 continuity mids)
 *   HELIX VORTEX CUTTER: 7 reference keys → 11 emitted (4 continuity mids)
 *   VIPER CROSS-PIERCE: 7 reference keys → 10 emitted (3 continuity mids)
 *   ONSLAUGHT CHAIN X-SLASH: 8 reference keys → 10 emitted (2 continuity mids)
 *   FINISHER — OMEGA HORIZON DUAL FLASH: 9 reference keys → 15 emitted (6 continuity mids)
 * 
 */

import { keyframe, makeClip, type Clip } from '../anim/animator'
import { type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { handPose, kickPose } from './limb-ik'

const kf = (t: number, d: PoseInput, ease?: string) => {
  const f = keyframe(t, d, ease)
  applyJointLimits(f.p)
  return f
}
const clip = (name: string, frames: ReturnType<typeof kf>[]): Clip => makeClip(name, frames)

/* ================================================================== */

/** IAIJUTSU CROSS-DRAW IMPACT — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Iai = clip('roninIai', [
  kf(0, { rootX: 0, rootY: 0, rootRot: 0.314, spine: 0.02, head: 0.454, pelvisYaw: -0.088, chestYaw: 0.014, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -8.909, 44.545, 'flat'), ...kickPose('right', 8.909, 44.545, 'flat'), ...handPose('left', 0, 36), ...handPose('right', 6.251, 35.453), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.208, { rootX: 0, rootY: 2.227, rootRot: 0.14, spine: 0.02, head: 0.175, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -8.909, 42.318, 'flat'), ...kickPose('right', 8.909, 42.318, 'flat'), ...handPose('left', 18, 31.177), ...handPose('right', 18, 31.177), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.375, { rootX: 0, rootY: -2.227, rootRot: -0.105, spine: 0.02, head: -0.349, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -8.909, 46.773, 'flat'), ...kickPose('right', 8.909, 46.773, 'flat'), ...handPose('left', -8.517, 31.788), ...handPose('right', -8.517, 31.788), wrL: 0, wrR: 0.2 }, 'inCubic'),
  kf(0.417, { rootX: 1.559, rootY: 3.898, rootRot: 0.297, spine: 0.02, head: -0.105, pelvisYaw: -0.152, chestYaw: 0.131, rootZ: 13.8, bladeYaw: -0.21, bladeZ: 2.4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 40.648, 'flat'), ...kickPose('right', 16.705, 40.648, 'flat'), ...handPose('left', 12.908, 10.481), ...handPose('right', 13.587, 13.544), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.458, { rootX: 3.118, rootY: 10.023, rootRot: 0.698, spine: 0.02, head: 0.14, pelvisYaw: -0.169, chestYaw: 0.161, rootZ: 27.6, bladeYaw: -0.21, bladeZ: 4.8, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -31.182, 34.523, 'flat'), ...kickPose('right', 24.5, 34.523, 'flat'), ...handPose('left', 34.334, -10.825), ...handPose('right', 35.692, -4.699), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.542, { rootX: 4.009, rootY: 8.909, rootRot: 0.593, spine: 0.02, head: 0.07, pelvisYaw: -0.16, chestYaw: 0.146, rootZ: 17.65, bladeYaw: -0.21, bladeZ: 3.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -33.409, 35.636, 'flat'), ...kickPose('right', 22.273, 35.636, 'flat'), ...handPose('left', 35.021, -5.413), ...handPose('right', 35.632, -0.793), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.625, { rootX: 4.9, rootY: 7.795, rootRot: 0.489, spine: 0.02, head: 0, pelvisYaw: -0.152, chestYaw: 0.131, rootZ: 7.7, bladeYaw: -0.21, bladeZ: 1.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -35.636, 36.75, 'flat'), ...kickPose('right', 20.045, 36.75, 'flat'), ...handPose('left', 35.708, 0), ...handPose('right', 35.572, 3.112), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(0.917, { rootX: 4.009, rootY: 5.568, rootRot: 0.279, spine: 0.02, head: 0, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -33.409, 38.977, 'flat'), ...kickPose('right', 22.273, 38.977, 'flat'), ...handPose('left', 24.055, 4.242), ...handPose('right', 24.055, 4.242), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(1.333, { rootX: 4.009, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -28.955, 38.977, 'flat'), ...kickPose('right', 8.909, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** TWIN MOMENTUM CRESCENT — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Cross = clip('roninCross', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.167, { rootX: 0.891, rootY: 8.909, rootRot: 0.349, spine: 0.02, head: 0, pelvisYaw: 0.25, chestYaw: -0.6, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -21.159, 35.636, 'flat'), ...kickPose('right', 16.705, 35.636, 'flat'), ...handPose('left', -9.211, 19.754), ...handPose('right', 22.953, -27.354), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.292, { rootX: 2.673, rootY: 12.25, rootRot: 0.611, spine: 0.02, head: -0.175, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -21.159, 32.295, 'flat'), ...kickPose('right', 23.386, 32.295, 'flat'), ...handPose('left', 29.11, 0), ...handPose('right', 0, 24.426), wrL: 0, wrR: 0.2 }, 'inCubic'),
  kf(0.354, { rootX: 3.786, rootY: 10.023, rootRot: 0.445, spine: 0.02, head: 0.035, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 6.9, bladeYaw: -0.21, bladeZ: 1.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.602, 34.523, 'flat'), ...kickPose('right', 24.5, 34.523, 'flat'), ...handPose('left', 23.589, -13.752), ...handPose('right', 14.25, 20.44), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.417, { rootX: 4.9, rootY: 7.795, rootRot: 0.279, spine: 0.02, head: 0.244, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 13.8, bladeYaw: -0.21, bladeZ: 2.4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 36.75, 'flat'), ...kickPose('right', 25.614, 36.75, 'flat'), ...handPose('left', 18.069, -27.505), ...handPose('right', 28.5, 16.454), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.5, { rootX: 6.014, rootY: 9.466, rootRot: 0.506, spine: 0.02, head: 0.07, pelvisYaw: -0.08, chestYaw: 0, rootZ: 24.15, bladeYaw: -0.21, bladeZ: 4.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -19.489, 35.08, 'flat'), ...kickPose('right', 26.727, 35.08, 'flat'), ...handPose('left', 8.299, 3.085), ...handPose('right', 21.492, -8.092), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.583, { rootX: 7.127, rootY: 11.136, rootRot: 0.733, spine: 0.02, head: -0.105, pelvisYaw: 0.25, chestYaw: -0.6, rootZ: 34.5, bladeYaw: -0.21, bladeZ: 6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 33.409, 'flat'), ...kickPose('right', 27.841, 33.409, 'flat'), ...handPose('left', -1.47, 33.674), ...handPose('right', 14.484, -32.639), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.667, { rootX: 7.573, rootY: 9.744, rootRot: 0.593, spine: 0.02, head: -0.105, pelvisYaw: 0.057, chestYaw: -0.25, rootZ: 19.575, bladeYaw: -0.21, bladeZ: 3.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 34.801, 'flat'), ...kickPose('right', 26.727, 34.801, 'flat'), ...handPose('left', 13.599, 19.365), ...handPose('right', 21.576, -13.792), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.75, { rootX: 8.018, rootY: 8.352, rootRot: 0.454, spine: 0.02, head: -0.105, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 4.65, bladeYaw: -0.21, bladeZ: 1.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -21.159, 36.193, 'flat'), ...kickPose('right', 25.614, 36.193, 'flat'), ...handPose('left', 28.667, 5.055), ...handPose('right', 28.667, 5.055), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(1.333, { rootX: 8.018, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -38.977, 38.977, 'flat'), ...kickPose('right', -1.114, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** AVALANCHE METEOR DROP — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Meteor = clip('roninMeteor', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.167, { rootX: -1.336, rootY: 16.705, rootRot: 0.611, spine: 0.02, head: 0, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -15.591, 27.841, 'flat'), ...kickPose('right', 22.273, 27.841, 'flat'), ...handPose('left', -23.27, 13.435), ...handPose('right', -23.27, 13.435), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.25, { rootX: 0.445, rootY: -6.96, rootRot: 0.175, spine: 0.02, head: -0.157, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: -7.7, bladeYaw: -0.21, bladeZ: -1.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -16.148, 33.409, 'flat'), ...kickPose('right', 22.83, 31.46, 'flat'), ...handPose('left', -4.695, -9.891), ...handPose('right', -4.695, -9.891), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.333, { rootX: 2.227, rootY: -30.625, rootRot: -0.262, spine: 0.02, head: -0.314, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: -15.4, bladeYaw: -0.21, bladeZ: -3.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -16.705, 38.977, 'point'), ...kickPose('right', 23.386, 35.08, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.417, { rootX: 4.455, rootY: -36.193, rootRot: -0.305, spine: 0.02, head: -0.349, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: -19.25, bladeYaw: -0.21, bladeZ: -4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -12.528, 39.813, 'point'), ...kickPose('right', 24.222, 35.08, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.5, { rootX: 6.682, rootY: -41.761, rootRot: -0.349, spine: 0.02, head: -0.384, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: -23.1, bladeYaw: -0.21, bladeZ: -4.8, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -8.352, 40.648, 'point'), ...kickPose('right', 25.057, 35.08, 'point'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.542, { rootX: 8.018, rootY: -25.892, rootRot: 0.105, spine: 0.02, head: -0.087, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 14.45, bladeYaw: -0.21, bladeZ: 1.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -8.074, 40.926, 'point'), ...kickPose('right', 26.449, 36.472, 'point'), ...handPose('left', 24.923, -15.823), ...handPose('right', 24.923, -15.823), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.583, { rootX: 9.355, rootY: -10.023, rootRot: 0.559, spine: 0.02, head: 0.209, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 52, bladeYaw: -0.21, bladeZ: 8, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -7.795, 41.205, 'point'), ...kickPose('right', 27.841, 37.864, 'point'), ...handPose('left', 35.966, 1.57), ...handPose('right', 35.966, 1.57), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.646, { rootX: 10.023, rootY: 1.67, rootRot: 0.716, spine: 0.02, head: 0.262, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 29.05, bladeYaw: -0.21, bladeZ: 4.4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -7.795, 36.193, 'point'), ...kickPose('right', 28.955, 34.523, 'point'), ...handPose('left', 25.59, 17.099), ...handPose('right', 25.59, 17.099), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.708, { rootX: 10.691, rootY: 13.364, rootRot: 0.873, spine: 0.02, head: 0.314, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 6.1, bladeYaw: -0.21, bladeZ: 0.8, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -7.795, 31.182, 'flat'), ...kickPose('right', 30.068, 31.182, 'flat'), ...handPose('left', 15.214, 32.627), ...handPose('right', 15.214, 32.627), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(1.333, { rootX: 10.691, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -45.659, 38.977, 'flat'), ...kickPose('right', -7.795, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** HELIX VORTEX CUTTER — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Vortex = clip('roninVortex', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.167, { rootX: 0.891, rootY: 7.795, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.55, chestYaw: 0.348, rootZ: -5.6, bladeYaw: -0.81, bladeZ: -2.8, armRz: -0.216, armLz: 0.216, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -21.159, 36.75, 'flat'), ...kickPose('right', 16.705, 36.75, 'flat'), ...handPose('left', 32.409, 5.715), ...handPose('right', -5.055, 28.667), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.25, { rootX: 2.45, rootY: 9.466, rootRot: 0.48, spine: 0.02, head: 0.052, pelvisYaw: -0.329, chestYaw: 0.245, rootZ: 11.8, bladeYaw: -0.46, bladeZ: 1.4, armRz: -0.09, armLz: 0.09, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -25.057, 35.08, 'flat'), ...kickPose('right', 12.807, 35.08, 'flat'), ...handPose('left', 25.239, -10.895), ...handPose('right', 6.507, 0.581), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.333, { rootX: 4.009, rootY: 11.136, rootRot: 0.785, spine: 0.02, head: 0.105, pelvisYaw: -0.108, chestYaw: 0.142, rootZ: 29.2, bladeYaw: -0.11, bladeZ: 5.6, armRz: 0.036, armLz: -0.036, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -28.955, 33.409, 'flat'), ...kickPose('right', 8.909, 33.409, 'flat'), ...handPose('left', 18.069, -27.505), ...handPose('right', 18.069, -27.505), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.417, { rootX: 5.345, rootY: 12.25, rootRot: 0.785, spine: 0.02, head: 0.105, pelvisYaw: -0.014, chestYaw: 0.289, rootZ: 7.3, bladeYaw: 0.24, bladeZ: 1.4, armRz: 0.162, armLz: -0.162, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -32.295, 32.295, 'flat'), ...kickPose('right', 5.568, 32.295, 'flat'), ...handPose('left', -5.216, -5.525), ...handPose('right', -5.216, -5.525), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.5, { rootX: 6.682, rootY: 13.364, rootRot: 0.785, spine: 0.02, head: 0.105, pelvisYaw: 0.081, chestYaw: 0.436, rootZ: -14.6, bladeYaw: 0.59, bladeZ: -2.8, armRz: 0.288, armLz: -0.288, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -35.636, 31.182, 'flat'), ...kickPose('right', 2.227, 31.182, 'flat'), ...handPose('left', -28.5, 16.454), ...handPose('right', -28.5, 16.454), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.583, { rootX: 8.018, rootY: 11.693, rootRot: 0.724, spine: 0.02, head: 0.017, pelvisYaw: 0.097, chestYaw: 0.46, rootZ: 7.3, bladeYaw: 0.94, bladeZ: 1.4, armRz: 0.344, armLz: -0.344, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -38.977, 32.852, 'flat'), ...kickPose('right', -1.114, 32.852, 'flat'), ...handPose('left', -1.645, -2.349), ...handPose('right', -1.645, -2.349), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.667, { rootX: 9.355, rootY: 10.023, rootRot: 0.663, spine: 0.02, head: -0.07, pelvisYaw: 0.113, chestYaw: 0.485, rootZ: 29.2, bladeYaw: 1.29, bladeZ: 5.6, armRz: 0.4, armLz: -0.4, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -42.318, 34.523, 'flat'), ...kickPose('right', -4.455, 34.523, 'flat'), ...handPose('left', 25.21, -21.153), ...handPose('right', 25.21, -21.153), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.792, { rootX: 9.8, rootY: 8.352, rootRot: 0.663, spine: 0.02, head: -0.07, pelvisYaw: 0.113, chestYaw: 0.485, rootZ: 14.6, bladeYaw: 1.32, bladeZ: 2.8, armRz: 0.4, armLz: -0.4, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -43.432, 36.193, 'flat'), ...kickPose('right', -5.568, 36.193, 'flat'), ...handPose('left', 25.331, -8.901), ...handPose('right', 25.331, -8.901), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.917, { rootX: 10.245, rootY: 6.682, rootRot: 0.663, spine: 0.02, head: -0.07, pelvisYaw: 0.113, chestYaw: 0.485, rootZ: 0, bladeYaw: 1.35, bladeZ: 0, armRz: 0.4, armLz: -0.4, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -44.545, 37.864, 'flat'), ...kickPose('right', -6.682, 37.864, 'flat'), ...handPose('left', 25.453, 3.351), ...handPose('right', 25.453, 3.351), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(1.333, { rootX: 10.245, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -44.545, 38.977, 'flat'), ...kickPose('right', -6.682, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** VIPER CROSS-PIERCE — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Viper = clip('roninViper', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.167, { rootX: -1.336, rootY: 5.568, rootRot: 0.314, spine: 0.02, head: 0, pelvisYaw: 0.1, chestYaw: -0.328, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -15.591, 38.977, 'flat'), ...kickPose('right', 22.273, 38.977, 'flat'), ...handPose('left', -4.699, 35.692), ...handPose('right', 26.87, 0), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.229, { rootX: 0.891, rootY: 7.795, rootRot: 0.524, spine: 0.02, head: -0.087, pelvisYaw: -0.155, chestYaw: 0.136, rootZ: 20.7, bladeYaw: -0.21, bladeZ: 3.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -24.5, 34.523, 'flat'), ...kickPose('right', 26.17, 35.08, 'flat'), ...handPose('left', 5.423, 2.107), ...handPose('right', 6.986, 15.57), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.292, { rootX: 3.118, rootY: 10.023, rootRot: 0.733, spine: 0.02, head: -0.175, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 41.4, bladeYaw: -0.21, bladeZ: 7.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -33.409, 30.068, 'point'), ...kickPose('right', 30.068, 31.182, 'point'), ...handPose('left', 15.545, -31.478), ...handPose('right', -12.899, 31.141), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.354, { rootX: 4.455, rootY: 10.58, rootRot: 0.803, spine: 0.02, head: -0.209, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 49.7, bladeYaw: -0.21, bladeZ: 8.4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -33.409, 31.739, 'point'), ...kickPose('right', 32.295, 32.295, 'point'), ...handPose('left', 15.339, -31.716), ...handPose('right', -15.059, 29.085), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.417, { rootX: 5.791, rootY: 11.136, rootRot: 0.873, spine: 0.02, head: -0.244, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 58, bladeYaw: -0.21, bladeZ: 9.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -33.409, 33.409, 'flat'), ...kickPose('right', 34.523, 33.409, 'flat'), ...handPose('left', 15.133, -31.954), ...handPose('right', -17.22, 27.03), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.5, { rootX: 6.236, rootY: 9.466, rootRot: 0.698, spine: 0.02, head: -0.087, pelvisYaw: -0.373, chestYaw: 0.533, rootZ: 32.85, bladeYaw: -0.21, bladeZ: 5.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -32.295, 35.08, 'flat'), ...kickPose('right', 35.08, 35.08, 'flat'), ...handPose('left', 22.192, -21.3), ...handPose('right', 3.025, 20.232), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.583, { rootX: 6.682, rootY: 7.795, rootRot: 0.524, spine: 0.02, head: 0.07, pelvisYaw: -0.337, chestYaw: 0.467, rootZ: 7.7, bladeYaw: -0.21, bladeZ: 1.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -31.182, 36.75, 'flat'), ...kickPose('right', 35.636, 36.75, 'flat'), ...handPose('left', 29.251, -10.646), ...handPose('right', 23.27, 13.435), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(0.917, { rootX: 6.236, rootY: 6.682, rootRot: 0.279, spine: 0.02, head: 0, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -30.068, 37.864, 'flat'), ...kickPose('right', 36.75, 37.864, 'flat'), ...handPose('left', 24.055, 4.242), ...handPose('right', 24.055, 4.242), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(1.333, { rootX: 6.236, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -34.523, 38.977, 'flat'), ...kickPose('right', 3.341, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** ONSLAUGHT CHAIN X-SLASH — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Onslaught = clip('roninOnslaught', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.125, { rootX: 1.336, rootY: 8.352, rootRot: 0.384, spine: 0.02, head: 0, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -22.273, 36.193, 'flat'), ...kickPose('right', 15.591, 36.193, 'flat'), ...handPose('left', 28.999, -2.537), ...handPose('right', 2.537, 28.999), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.25, { rootX: 3.564, rootY: 12.25, rootRot: 0.611, spine: 0.02, head: 0.14, pelvisYaw: -0.286, chestYaw: 0.375, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -23.386, 32.295, 'flat'), ...kickPose('right', 24.5, 32.295, 'flat'), ...handPose('left', 16.211, -31.141), ...handPose('right', 26.957, -15.564), wrL: 0, wrR: 0.2 }, 'inCubic'),
  kf(0.375, { rootX: 6.236, rootY: 10.023, rootRot: 0.733, spine: 0.02, head: -0.14, pelvisYaw: 0.25, chestYaw: -0.6, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -23.943, 34.523, 'flat'), ...kickPose('right', 26.17, 34.523, 'flat'), ...handPose('left', 2.868, 32.784), ...handPose('right', 16.501, -30.229), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(0.438, { rootX: 7.35, rootY: 11.693, rootRot: 0.803, spine: 0.02, head: 0.035, pelvisYaw: -0.08, chestYaw: 0, rootZ: 10.75, bladeYaw: -0.21, bladeZ: 2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.881, 32.852, 'flat'), ...kickPose('right', 27.563, 32.852, 'flat'), ...handPose('left', 9.685, 1.277), ...handPose('right', 20.173, -5.11), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.5, { rootX: 8.464, rootY: 13.364, rootRot: 0.873, spine: 0.02, head: 0.209, pelvisYaw: -0.41, chestYaw: 0.6, rootZ: 21.5, bladeYaw: -0.21, bladeZ: 4, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -17.818, 31.182, 'flat'), ...kickPose('right', 28.955, 31.182, 'flat'), ...handPose('left', 16.501, -30.229), ...handPose('right', 23.845, 20.009), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(0.583, { rootX: 9.355, rootY: 12.25, rootRot: 0.716, spine: 0.02, head: 0.07, pelvisYaw: -0.239, chestYaw: 0.289, rootZ: 13.075, bladeYaw: -0.21, bladeZ: 2.6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -16.705, 32.295, 'flat'), ...kickPose('right', 29.511, 32.295, 'flat'), ...handPose('left', 21.729, -24.552), ...handPose('right', 21.361, -3.474), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.667, { rootX: 10.245, rootY: 11.136, rootRot: 0.559, spine: 0.02, head: -0.07, pelvisYaw: -0.068, chestYaw: -0.022, rootZ: 4.65, bladeYaw: -0.21, bladeZ: 1.2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -15.591, 33.409, 'flat'), ...kickPose('right', 30.068, 33.409, 'flat'), ...handPose('left', 26.957, -18.876), ...handPose('right', 18.876, -26.957), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(1, { rootX: 9.8, rootY: 6.682, rootRot: 0.314, spine: 0.02, head: 0, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -14.477, 37.864, 'flat'), ...kickPose('right', 31.182, 37.864, 'flat'), ...handPose('left', 25.453, 3.351), ...handPose('right', 25.453, 3.351), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(1.333, { rootX: 9.8, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -43.432, 38.977, 'flat'), ...kickPose('right', -5.568, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])

/** FINISHER — OMEGA HORIZON DUAL FLASH — reference keys 1:1 (24fps beat grid, eased segments). */
const RONIN_Omega = clip('roninOmega', [
  kf(0, { rootX: 0, rootY: 5.568, rootRot: 0.175, spine: 0.02, head: 0, pelvisYaw: -0.061, chestYaw: -0.034, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -18.932, 38.977, 'flat'), ...kickPose('right', 18.932, 38.977, 'flat'), ...handPose('left', 11.989, -0.523), ...handPose('right', 22.213, -2.335), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.083, { rootX: -0.668, rootY: 3.898, rootRot: -0.017, spine: 0.02, head: -0.209, pelvisYaw: -0.098, chestYaw: 0.033, rootZ: -12.75, bladeYaw: -0.21, bladeZ: -3, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -19.489, 40.648, 'flat'), ...kickPose('right', 20.602, 40.648, 'flat'), ...handPose('left', 12.934, -16.87), ...handPose('right', 18.047, -17.776), wrL: 0, wrR: 0.2 }, 'linear'), // continuity mid
  kf(0.167, { rootX: -1.336, rootY: 2.227, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: -25.5, bladeYaw: -0.21, bladeZ: -6, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 42.318, 'flat'), ...kickPose('right', 22.273, 42.318, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: 0.2 }, 'outCubic'),
  kf(0.271, { rootX: -1.336, rootY: 2.227, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: -0.101, chestYaw: 0.153, rootZ: -32.8, bladeYaw: -0.085, bladeZ: -7, armRz: 0.045, armLz: -0.045, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 42.318, 'flat'), ...kickPose('right', 22.273, 42.318, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: 0.2 }, 'linear'), // continuity mid
  kf(0.375, { rootX: -1.336, rootY: 2.227, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: -0.067, chestYaw: 0.205, rootZ: -40.1, bladeYaw: 0.04, bladeZ: -8, armRz: 0.09, armLz: -0.09, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 42.318, 'flat'), ...kickPose('right', 22.273, 42.318, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
  kf(0.542, { rootX: -1.336, rootY: 2.227, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: -0.027, chestYaw: 0.268, rootZ: -47, bladeYaw: 0.19, bladeZ: -8, armRz: 0.144, armLz: -0.144, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -20.045, 42.318, 'flat'), ...kickPose('right', 22.273, 42.318, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 13.88, -33.217), wrL: 0, wrR: 0.2 }, 'linear'),
  kf(0.625, { rootX: -3.118, rootY: 11.693, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: 0.132, chestYaw: -0.134, rootZ: -40.825, bladeYaw: 0.065, bladeZ: -7.6, armRz: 0.099, armLz: -0.099, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -15.591, 32.852, 'flat'), ...kickPose('right', 26.727, 32.852, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 19.668, -29.336), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(0.708, { rootX: -4.9, rootY: 21.159, rootRot: -0.209, spine: 0.02, head: -0.419, pelvisYaw: 0.291, chestYaw: -0.537, rootZ: -34.65, bladeYaw: -0.06, bladeZ: -7.2, armRz: 0.054, armLz: -0.054, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -11.136, 23.386, 'flat'), ...kickPose('right', 31.182, 23.386, 'flat'), ...handPose('left', 13.88, -33.217), ...handPose('right', 25.456, -25.456), wrL: 0, wrR: -0.3 }, 'inOutCubic'),
  kf(0.771, { rootX: 2.895, rootY: 17.818, rootRot: 0.419, spine: 0.02, head: -0.314, pelvisYaw: 0.024, chestYaw: -0.302, rootZ: 11.675, bladeYaw: -0.335, bladeZ: 1.4, armRz: -0.045, armLz: 0.045, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -30.625, 26.727, 'flat'), ...kickPose('right', 11.693, 26.727, 'flat'), ...handPose('left', 21.685, -6.284), ...handPose('right', 27.473, -2.404), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(0.833, { rootX: 10.691, rootY: 14.477, rootRot: 1.047, spine: 0.02, head: -0.209, pelvisYaw: -0.243, chestYaw: -0.068, rootZ: 58, bladeYaw: -0.61, bladeZ: 10, armRz: -0.144, armLz: 0.144, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -50.114, 30.068, 'flat'), ...kickPose('right', -7.795, 30.068, 'flat'), ...handPose('left', 29.489, 20.649), ...handPose('right', 29.489, 20.649), wrL: 0, wrR: -0.3 }, 'inCubic'),
  kf(1, { rootX: 12.918, rootY: 14.477, rootRot: 1.047, spine: 0.02, head: -0.209, pelvisYaw: -0.202, chestYaw: -0.005, rootZ: 58, bladeYaw: -0.46, bladeZ: 10, armRz: -0.09, armLz: 0.09, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -55.682, 30.068, 'flat'), ...kickPose('right', -13.364, 30.068, 'flat'), ...handPose('left', 29.489, 20.649), ...handPose('right', 29.489, 20.649), wrL: 0, wrR: -0.3 }, 'outCubic'),
  kf(1.083, { rootX: 12.918, rootY: 10.58, rootRot: 1.047, spine: 0.02, head: -0.209, pelvisYaw: -0.169, chestYaw: 0.048, rootZ: 33.25, bladeYaw: -0.335, bladeZ: 6, armRz: -0.045, armLz: 0.045, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -55.682, 33.966, 'flat'), ...kickPose('right', -13.364, 33.966, 'flat'), ...handPose('left', 11.619, 28.051), ...handPose('right', 11.619, 28.051), wrL: 0, wrR: -0.3 }, 'linear'), // continuity mid
  kf(1.167, { rootX: 12.918, rootY: 6.682, rootRot: 1.047, spine: 0.02, head: -0.209, pelvisYaw: -0.135, chestYaw: 0.1, rootZ: 8.5, bladeYaw: -0.21, bladeZ: 2, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -55.682, 37.864, 'flat'), ...kickPose('right', -13.364, 37.864, 'flat'), ...handPose('left', -6.251, 35.453), ...handPose('right', -6.251, 35.453), wrL: 0, wrR: -0.3 }, 'inOutCubic'),
  kf(1.25, { rootX: 12.918, rootY: 3.341, rootRot: 0.681, spine: 0.02, head: 0.122, pelvisYaw: -0.111, chestYaw: 0.057, rootZ: 4.25, bladeYaw: -0.21, bladeZ: 1, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -48.443, 41.205, 'flat'), ...kickPose('right', -18.375, 41.205, 'flat'), ...handPose('left', -3.126, 35.727), ...handPose('right', 0, 35.453), wrL: 0, wrR: -0.05 }, 'linear'), // continuity mid
  kf(1.333, { rootX: 12.918, rootY: 0, rootRot: 0.314, spine: 0.02, head: 0.454, pelvisYaw: -0.088, chestYaw: 0.014, rootZ: 0, bladeYaw: -0.21, bladeZ: 0, armRz: 0, armLz: 0, foreRz: 0.08, foreLz: -0.02, ...kickPose('left', -41.205, 44.545, 'flat'), ...kickPose('right', -23.386, 44.545, 'flat'), ...handPose('left', 0, 36), ...handPose('right', 6.251, 35.453), wrL: 0, wrR: 0.2 }, 'inOutCubic'),
])
export const RONIN_Iai_CLIP = RONIN_Iai
export const RONIN_Cross_CLIP = RONIN_Cross
export const RONIN_Meteor_CLIP = RONIN_Meteor
export const RONIN_Vortex_CLIP = RONIN_Vortex
export const RONIN_Viper_CLIP = RONIN_Viper
export const RONIN_Onslaught_CLIP = RONIN_Onslaught
export const RONIN_Omega_CLIP = RONIN_Omega

/** Reference metadata on the 24fps beat grid: impact events (limb, power,
 * ground, inversion flag) and the slow-map (per-frame playback dilation
 * around impact — the hitstop windows). Consumed by combat/ronin.ts. */
export interface RoninEvent { t: number; limb: string; p: number; ground?: boolean; inv?: boolean }
export interface RoninSlow { t: number; mult: number }
export const RONIN_META: Record<string, { events: RoninEvent[]; slow: RoninSlow[] }> = {
  iai: {
    events: [{ t: 0.458, limb: 'la', p: 1, ground: true, inv: true }],
    slow: [{ t: 0.375, mult: 2 }, { t: 0.417, mult: 2.5 }, { t: 0.458, mult: 4 }, { t: 0.5, mult: 3 }, { t: 0.542, mult: 2 }],
  },
  cross: {
    events: [{ t: 0.292, limb: 'la', p: 0.8 }, { t: 0.583, limb: 'ba', p: 1, inv: true }],
    slow: [{ t: 0.25, mult: 2 }, { t: 0.292, mult: 3 }, { t: 0.542, mult: 2 }, { t: 0.583, mult: 4 }],
  },
  meteor: {
    events: [{ t: 0.583, limb: 'ffoot', p: 1, ground: true, inv: true }],
    slow: [{ t: 0.5, mult: 2 }, { t: 0.542, mult: 3 }, { t: 0.583, mult: 4.5 }, { t: 0.625, mult: 3 }, { t: 0.667, mult: 2 }],
  },
  vortex: {
    events: [{ t: 0.5, limb: 'bh', p: 1, inv: true }],
    slow: [{ t: 0.292, mult: 2 }, { t: 0.333, mult: 3 }, { t: 0.458, mult: 2 }, { t: 0.5, mult: 4 }, { t: 0.542, mult: 2.5 }],
  },
  viper: {
    events: [{ t: 0.417, limb: 'la', p: 1, ground: true, inv: true }],
    slow: [{ t: 0.292, mult: 2 }, { t: 0.333, mult: 3 }, { t: 0.375, mult: 4 }, { t: 0.417, mult: 4.5 }, { t: 0.458, mult: 2.5 }],
  },
  onslaught: {
    events: [{ t: 0.5, limb: 'ba', p: 1, inv: true }],
    slow: [{ t: 0.25, mult: 2 }, { t: 0.375, mult: 2.5 }, { t: 0.5, mult: 4 }, { t: 0.542, mult: 3 }],
  },
  omega: {
    events: [{ t: 0.833, limb: 'tip', p: 1, ground: true, inv: true }, { t: 0.917, limb: 'tail', p: 1 }],
    slow: [{ t: 0.708, mult: 1.5 }, { t: 0.75, mult: 2 }, { t: 0.792, mult: 3 }, { t: 0.833, mult: 5.5 }, { t: 0.875, mult: 4 }, { t: 0.917, mult: 3 }],
  },
}
