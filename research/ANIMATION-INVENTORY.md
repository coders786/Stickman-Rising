# STICKMAN RISING — Animation Audit, Inventory & Migration Map

Status: **living document** — the coverage checklist for every authored clip and
animated behavior. Written during the rig/animation rework pass that wired the
PAVE variation engine, the live QA harness (`window.__srQA`) and the
kill-frame execution hold into the game.

---

## 1. Audit summary

| Area | Finding |
|---|---|
| Renderer / framework | Next.js 16 + custom Canvas 2D engine (`src/game/`), TypeScript strict, fixed-substep sim (≤1/90 s) under a rAF loop with a performance governor (3×1/60 substep cap). |
| Rig | Procedural **pseudo-3D skeletal rig** (`anim/rig3d.ts`): 28 pose channels (`anim/pose.ts`) — 17 classic sagittal + 11 depth (yaw) channels; mild perspective projection (FOCUS=620) so the visible blade **is** the hitbox plane. |
| Animation runtime | `anim/animator.ts` — clip sampling with eased keyframes, Fritsch–Carlson monotone (shape-preserving C1) option, inertial crossfade transitions (velocity-preserving), wrist shortest-path unwrapping, optional stepped "anime on-twos" clock (`stepRate`, currently unused — see §7). |
| Data | `anim/clips.ts` (+`patrol-walk.ts`, `power-dash.ts`) — authored keyframe literals via `keyframe(t, channels, ease)`, guard-merged onto the NEUTRAL pose. |
| IK | Arms: sphere-intersection elbow pole + `ikArm3D` clamp solver (`rig3d.ts`), hand-space solver (`hand-kinematics.ts`), sword-led arc (`armarc.ts`), two-hand grip IK (player). Legs: `legik.ts` GaitPlanner + 2-bone solve with world-locked stance feet. |
| Limits | `anim/limits.ts` — anatomical ROM gate (elbow/knee flexion sign-lock + soft reflection, shoulder/hip envelopes, spine pitch sum) applied immediately before every FK solve. |
| Combat | `combat/attacks.ts` — 20 `AttackDef`s; per-def hit window (`hit.start/end`), trail window, cancel window, chain map, multi-hit, aoe, launch/juggle. Hits resolve through swept blade quads (anti-tunneling) in `player.ts`. |
| Input | `core/input.ts` KEYMAP — J/Z light, K/X heavy, L/C/Shift dash, Space jump, O/F parry, U ability, I ult, E execute, Q sheathe-toggle. |
| Workbench | `debug/inspect.ts` (F9): skeleton/sheet/trajectory/pose-editor views, scrub, channel nudge, mirror, `exportPose()`, named-pose preset library (`window.__srPoseLib`). |
| QA | `debug/animQA.ts` (`window.__srQA.run()`) — scripted live-gameplay harness, checks A–I. Node test suite: `bun run test` (34 files incl. `tests/pave.test.ts`). |
| Commands | `bun run dev` · `bun run lint` · `bun run typecheck` · `bun run test` · `bun run test:animations` · `bun run check` (all of the above). |

## 2. Architecture decision (rigging approach)

Following the order of preference:

1. **Extend the existing skeleton/rig runtime** — chosen. The repo already owns
   a genuine hierarchical rig + animation runtime + IK + limits + a dev
   workbench (built in earlier passes). Extending it is strictly smaller and
   safer than any migration.
2. 2D asset-based rig workflow — N/A (no external authored rig assets exist).
3. Canvas procedural → small 2D skeletal rig — **this is what the repo already
   is**, taken further (depth channels, girdle counter-rotation, perspective).
4. No 3D renderer introduced; PixiJS not used; Rive/Spine **evaluated and
   rejected**: the art is procedural stick anatomy (no authored deformable
   assets to skin), hitboxes must equal the projected blade segment, and a
   runtime-editor asset pipeline would add a build dependency for zero
   gameplay benefit at this art style.

Conventions (single source of truth, `pose.ts` / `rig3d.ts`): character-local
space, +X facing, +Y down, +Z toward camera; angles in radians, raw floats
(never wrapped — continuous spins allowed); yaw ψ swings toward camera;
weapon pitch = π/2 − (shR+elR+wrR), weapon depth from `bladeYaw/bladeZ`.

### Solve order (per player frame — brief §6 contract)

```
animator.update            sample clip (+ crossfade / inertial bridge)
pose.set(animator.pose)    base layer fully owns the pose (write, never accumulate)
applyProcedural            bounded additive gameplay layer
contextMotion / motion     context posture + anatomical smoothing
sprint exposure / dash acting / dash recovery / charge stabilization
updateBladeZ               zArc → bladeYaw
swordArc.update            sword-led arm arc solver
updateBladeDynamics        wrist lag spring + kinetic chain (feeds hitboxes)
applyTwoHandGrip           off-hand IK onto the tsuka
PAVE  (applyPave)          bounded organic variation — MOVING HOLDS, breath,
                           hurt posture, sword voice, escalation flair
applyJointLimits           anatomical ROM gate (bounds every writer above)
solveFighter3D             FK solve → projected joints + blade segment
applyDrawContact           draw-socket hand pinning (draw ritual only)
updateFootLock / applyGroundIK   weight + leg IK (feet exactly planted)
captureDisplayPose         final constrained pose seeds the next blend
```

Grip/foot IK run **after** PAVE on purpose: a gripping hand and a planted foot
never receive uncontrolled secondary motion; limits bound every additive
offset; the arm channels are gated (armGate ≈ 0.15) inside strike/trail
windows so hitboxes and trails stay crisp.

## 3. Weapon state machine (SHEATHED → DRAWING → DRAWN → SHEATHING)

Implemented as `swordDrawn` (bool) + `sheathAct` one-shot ritual **with
explicit transfer beats** — not a visible/hidden flip:

| State | Entered by | Left by (event) | Gameplay effect |
|---|---|---|---|
| SHEATHED | default / sheath ritual completes (`t≤0`) | Q → `startDraw` (DRAW_CLIP 0.30 s) | locomotion arms hands-only (`equipmentClip(clip,false)`); attacks route to `unarmedAttack()` — combat never silently draws (pinned by `tests/dual-stance.test.ts`) |
| DRAWING | `startDraw` | beat `DRAW_CLEAR=.19` (tip clears saya mouth) flips `swordDrawn=true` + `drawBurst()` flash/sfx | hands pinned to saya mouth/hilt by `drawSocket()` + `applyDrawContact()` Jacobian IK; hitboxes inactive |
| DRAWN | DRAW_CLEAR beat | Q → `startSheath` (SHEATHE_CLIP 0.85 s) or interrupt (dash/jump/attack/parry → completes on whichever side of the gate was reached) | locomotion arms sword-carry (`equipmentClip(clip,true)`); attacks use real `atk_*` defs |
| SHEATHING | `startSheath` | beat `t = dur−0.42` (slide-home begins) flips `swordDrawn=false`; completion rests in sheathed neutral | rooted friction, `swordSwitch` sfx |

Interruptions preserve a valid visible weapon transform (dual-stance + jump-draw
test suites pin this: "jump does not force a snap draw", exactly one screen
flash, `swordDrawn` flips exactly once through the ritual).

## 4. Legacy animation inventory → migration map

Every discovered animated behavior, its trigger, and where it lives now. "OK"
current-condition entries were already re-authored in the overhaul passes;
this pass's changes are marked **[this pass]**.

### Locomotion / posture

| Clip | Dur/loop | Trigger | Mode | Status → replacement |
|---|---|---|---|---|
| `idle` | 5.40 loop | grounded, speed<36, no threat | free/armed | OK; **[this pass]** PAVE moving-holds now keep it alive |
| `walk` | 1.04 loop | speed 36–210, cadence-synced | free/armed | OK (patrol-walk rework) |
| `run` | 0.50 loop | speed>210 | free/armed | OK |
| `sprint` | 0.56 loop | latch+>300 / >420 | free/armed | OK (10 Hz arm acting) |
| `sprintDrive` | 0.56 loop | sprint while accelerating | free/armed | OK |
| `combatIdle` | 1.80 loop | threat engaged, standstill | free/armed | OK |
| `combatStep` | 0.44 loop | threat + moving <310 | free/armed | OK |
| `backpedal` | 0.56 loop | fwd<-60 + threat | free/armed | OK |
| `brake` | 0.24 | input reversal >240 | free/armed | OK |
| `stop` | 0.50 | no-input decel; dashCharge entry; dash exit | free/armed | OK |
| `jump` / `jumpLeap` / `airJump` | .34/.42/.32 | Space (standstill / momentum / mid-air) | free/armed | OK; **[this pass]** PAVE aerial pose evolution (tuck→extend→spread) + leap silhouette |
| `fall` | 0.90 loop | airborne descent | free/armed | OK |
| `land` | 0.26 | onLand in move | free/armed | OK |
| flourishes ×4 (`flourishTsubaPop`…) | .95–1.30 | standstill >7.2 s, sheathed, no threat | sheathed-only | OK |
| `draw` | 0.30 | Q sheathed / dashCharge+Q | ritual | OK (draw-detail beats, socket IK) |
| `sheathe` | 0.85 | Q drawn | ritual | OK |
| `parry` / `unarmedParry` | 0.30 | O/F | armed / sheathed | OK |
| `charge` / `unarmedCharge` | 0.60/0.80 loop | K held | armed / sheathed | OK; **[this pass]** PAVE coiled-tension layer reads `chargeRatio` |
| `hurt` | 0.34 | takeDamage | both | OK; **[this pass]** PAVE flinch carryover (0–1 s) + posture collapse from hp |
| `powerDash` | 0.45 | charged dash release | free/armed | OK |
| dash family ×9 + `dashAir` | .20–.32 | L tap (context-evaluated variant) | free/armed | OK |
| `execPose` | hold | execution kill frame | armed | **ORPHAN → [this pass] wired**: kill-frame hold after the third exec slash (samurai-film settle; PAVE keeps the hold alive) |

### Attacks (`combat/attacks.ts`, clips authored in `clips.ts` / generated by `unarmed.ts`)

| id | label | trigger | hit window | Notes |
|---|---|---|---|---|
| l1–l5 | light chain | J (ground, chain w/ decay) | .04–.35 by move | l1 = IAI draw-cut; **[this pass]** PAVE reseeds per combo start |
| retreat / spin | contextual lights | J + back / down input | .09–.42 | OK |
| h1–h3 | heavy chain | K | .20–.60 | OK |
| launcher | RISING FANG | J + up | .04–.12 | OK |
| dashSlash / dashHeavy | dash attacks | J/K during or ≤0.18 s after dash | .07–.26 | OK |
| charged | OVERLOAD SLASH | K hold ≥0.4 release | .15–.31 | hyper-armor 0.5 s |
| riposte | JUDGMENT CUT | J/K within 0.95 s of parry | .11–.24 | OK |
| a1/a2/a3/dive/slam | air family | J/K airborne | .07–.50 | juggle/float authored |
| unarmed* (jab/cross/hook/elbow/palm/uppercut/hammer + air) | generated | any attack while sheathed | .34–.56 of dur | fists never draw steel (dual-stance contract) |

All attack windows, damage, target rules, cooldowns and combo behavior are
unchanged by this pass. PAVE is gated (armGate≈0.15) across each def's
`trail.start−0.07 … trail.end+0.09` window so hitbox/trail timing is
bit-identical to before.

### Enemies

Fully procedural `buildPose` per state (8 kinds, GaitPlanner + leg IK shared
with the player). PAVE is **not** wired for enemies yet (see §7) — their
procedural sine gait already never repeats exactly.

## 5. What this pass changed (files)

- `src/game/anim/pave.ts` — **wired** (was orphaned, unwritten-to-game): fixed
  stale 17-entry noise tables vs 28-channel pose (NaN on depth channels —
  caught by the new tests), added depth-channel amplitudes + a load-time
  table/CH_COUNT validation guard.
- `src/game/entities/player.ts` — PAVE integration: per-frame `applyPave`
  (solve order above), `PaveState` lifecycle (reset / per-combo reseed),
  `airT`/`sinceHitT`/`jumpStyle` context, `armGate` strike-window gate,
  contextual breath rate; `takeDamage` feeds the flinch window.
- `src/game/core/types.ts` — `WorldRef.combo?` (optional, read defensively).
- `src/game/anim/skeleton.ts` — exported `isPoseValid` (QA gate).
- `src/game/debug/animQA.ts` — **wired** (was orphaned): fixed dangling
  `animDebug()` references to the structural-cast convention.
- `src/game/game.ts` — `installQA(this)` replaces the old `__srQA` shim;
  execution kill-frame now settles into `EXECUTE_POSE_CLIP`.
- `tests/pave.test.ts` — new: boundedness/finiteness, ROM gate, moving holds,
  determinism, 30/60/120 Hz invariance, arm-gate, escalation table, spin
  accumulator, per-combo reseed.

## 6. Verification commands

- `bun run lint` — clean.
- `bun run typecheck` — only the two pre-existing environment errors
  (`skills/image-edit` SDK typing; `src/lib/db.ts` generated-client path).
- `bun run test` — see run log; `tests/pave.test.ts` 8/8. Baseline failure
  `tests/scores.test.ts` (database fixture, pre-existing) unchanged.
- Browser: `window.__srQA.run()` (scripted live harness, checks A–I) and the
  combat golden path (`startRun('katana')` → walk → light chain →
  `combo.hits > 0`) — run in the dev session, see the final report.

## 7. Remaining limitations (documented, not hidden)

- `stepRate` (anime on-twos clip clock) is implemented in the Animator but no
  caller uses it — deliberately not wired in this pass because it visibly
  changes combat beat timing; candidate for a per-attack opt-in later.
- `peaceT` accumulates but nothing consumes it (auto-sheathe was removed by
  design — dual-stance contract). Kept for future use.
- PAVE not yet wired for enemies (procedural poses; would need per-enemy
  context plumbing).
- `jumpStyle` covers `standard|leap`; `spin|backflip` silhouettes exist in
  PAVE and the spin accumulator is called, but no gameplay jump sets them yet
  (no fake features).
- Foot-plant drift tolerance: measured by QA check B (≤18 px band incl. 4 px
  line thickness) and inspect's trajectory view; not a formal unit test.
