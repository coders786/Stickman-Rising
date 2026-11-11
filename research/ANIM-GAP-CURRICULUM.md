# ANIM-GAP-CURRICULUM — Becker-Grade Animation Gap Program

> MISSION: Detail the animation-quality gap between **Stickman Rising** (us) and **Alan Becker's stickman craft**
> (Animator vs. Animation, his stick-fighting work) — which exemplifies *proper animation technique* + *human
> creative vision* — and then FILL that gap, one session after another, until our animation is Becker-grade.

This file is the **state machine** for the program. Every scheduled run:
1. Finds the first session below **not** marked ✅
2. Executes it following the protocol
3. Marks it ✅ with a detailed log entry (gap found / fixes applied / what remains)
4. The next run advances to the next session — hence "one after one"

---

## PROTOCOL (every session, no exceptions)

**Session steps:**
1. **LOCK** — Append to Session Log: `LOCK set <iso timestamp> (GAP session N)`. If a lock exists that is
   **< 3 hours old**, exit immediately ("skipped — session already in progress"). If older than 3h, it is stale:
   clear it and proceed.
2. **AUDIT** — Read the audit-target files (listed per session). Use offset/limit reads + Grep for large files
   (`clips.ts` is big). Study our actual keyframes/timings/eases for that session's principle. Also consult prior
   knowledge: `research/ANIMATION-INVENTORY.md`, `research/COMBAT_TIMING_STUDY.md`,
   `research/30_FPS_COMBAT_ANIMATION.md`, `agent-ctx/ANIMATION_AUDIT.md`.
3. **BECKER STANDARD** — Write what Alan Becker does for this principle in his stick work (style emulation ONLY —
   never copy frames). Ground it in classic animation technique + human creative vision.
4. **GAP DETAIL** — Name exact clips, keyframe indices, timings, and numbers (ms, frames @30fps, degrees).
   "Clip X: wind-up is 2 frames where Becker loads for 6-8; hips never counter-rotate (-0° vs his ~20-30°)…"
   This detail IS the deliverable — be specific, be ruthless.
5. **FILL** — Surgical edits: added anticipation keys, retimes, eased transitions, follow-through keys. STRICTLY
   ADDITIVE — preserve every existing clip ID, alias, event, cancel window, and gameplay mechanic.
6. **VERIFY** — `bun run lint` must pass. Read the last ~80 lines of `/home/z/my-project/dev.log` — no NEW runtime
   errors from your edits. If `bun test` exists in package.json, baseline the animation tests BEFORE edits
   (so you can prove you added no new failures). **NEVER run `bun run build`. NEVER restart the dev server** (it
   already runs on port 3000).
7. **COMMIT + PUSH** — `feat(anim): GAP SESSION N — <principle> <one-line>` then `git push origin main`
   (auth token already embedded in the remote URL). If push fails, note it in the log honestly.
8. **MARK ✅** — Append the session log entry; clear the lock.

**Hard rules:** surgical diffs (no rewrites) · TypeScript strict · Becker = inspiration, never frame-copying ·
total session ≤ ~60 min of work · if a fix is too risky/large, log it as a **PROPOSAL** instead of forcing it ·
**honest reporting — only claim results you actually ran.**

---

## THE CURRICULUM (12 sessions, ordered by expected impact)

### 1. Anticipation & Wind-up — ✅
**Principle:** Every action loads opposite first. The body gathers before it explodes.
**Becker standard:** Strikes coil 2-4 frames minimum before launching (punches pull the shoulder/hand back and
down, slashes pull the blade across the body, jumps crouch, dashes lean BACK before leaping forward).
Whole-body involvement: hips counter-rotate ~20-30° opposite the incoming swing; weight visibly sinks before
rises. Anticipation poses read clearly at a glance — the audience *predicts* the hit, which is what makes the
hit feel powerful.
**Our audit targets:** `clips.ts` (attack strings: light/heavy strings, RENZOKU TSUKI, RAIJIN ZAN/KEN/KYAKU,
unarmed 30-movset punches/kicks — check their first keys for counter-motion), `attacks.ts` (startup windows).
**Failure modes to hunt:** attacks that start moving forward on frame 0 · wind-up keys present but too short
(≤2 frames) or same-direction (fake anticipation) · arms load but hips/torso never counter-rotate · dashes that
lunge without a rearward gather · idle→attack transitions with zero anticipation.

### 2. Follow-through & Overlapping Action — ❌
**Principle:** Nothing stops all at once. Extremities continue after the torso stops; joints release sequentially.
**Becker standard:** After a punch lands, the fist keeps traveling, the shoulder rolls over it, the head settles a
beat later, hips finish rotating after the chest already stopped. Recovery never returns the pose to neutral
instantly — it overshoots, then settles with overlap (arm arrives, then hand, then fingers).
**Our audit targets:** `clips.ts` (recovery segments of every attack; end-of-clip poses), `animator.ts`
(crossfade durations), `skeleton.ts` (spring-damper secondary motion tuning).
**Failure modes:** recovery eases that stop every joint on the same frame · end poses that snap to idle ·
blade stops dead at extension instead of whipping past and settling · head/torso arrive simultaneously ·
secondary spring constants too stiff (no visible overlap) or too loose (mush).

### 3. Timing, Spacing & Easing — ❌
**Principle:** Weight and force live in the *distribution* of frames, not the poses.
**Becker standard:** Attacks are brutally asymmetric: slow-ish anticipation → 1-2 frame BLUR of a strike →
long cushioned settle. Spacing between frame pairs widens mid-swing (acceleration) and narrows into extremes
(deceleration). His walk cycles bounce with proper up-down spacing, not metronome evenness.
**Our audit targets:** `clips.ts` (every clip's keyframe intervals + explicit eases: step/linear/cubic choices).
**Failure modes:** evenly-spaced strike keys (no acceleration spike) · linear eases on impacts that should be
step/sharp · recoveries as fast as attacks (no cushion) · combo string windows uniform instead of tension-build-
release · cubics with symmetric handles everywhere (mechanical feel).

### 4. Arcs & Curvilinear Motion — ❌
**Principle:** Living things move in arcs, never straight lines. Disjointed = robotic/insect-like.
**Becker standard:** Fists travel on a rounded shoulder-driven arc, blades trace a clean circular path around the
body, heads orbit as the torso moves, knees/feet lift in arcs during locomotion. Even fast jabs follow a slight
bow. Hand path reversals trace a "C" or "S", never a "V".
**Our audit targets:** `clips.ts` (weapon-hand and foot key chains), `armarc.ts` (arc system), `legik.ts`.
**Failure modes:** blade/hand keys that interpolate linearly between extremes (corner-cutting V-paths) · foot
planted keys that teleport · arm swings whose intermediate keys sit ON the start-end chord · knee/ankle paths
that zigzag · the rig has arc tools (`armarc.ts`) but clips bypass them.

### 5. Smear Frames & Motion Streaks — ❌
**Principle:** On the fastest frames, the body deforms — multi-limb ghosts, stretched shapes — to sell velocity.
**Becker standard:** His signature. Punches/kicks/dashes render 1-2 frames where the limb is a stretched smear
or double-exposed ghost of itself. The sword becomes a curved arc-blur on the strike frame. It reads as speed
without motion-blur post-processing.
**Our audit targets:** `clips.ts` + `skeleton.ts` render path (is there any smear support?), `fx.ts` (existing
trail/streak FX), `pave.ts`.
**Failure modes:** fastest attacks rendered rigid even at 1-frame sampling · trails are pure particle FX bolted
on instead of limb deformation · no ghost/duplicate-limb draw mode exists at all.
**Note:** adding a renderer smear mode is ALLOWED here (this is the session to build it if missing) — but keep
it minimal and surgical (a limb-stretch factor or ghost-pose draw on flagged frames).

### 6. Weight Shift & Body Mechanics — ❌
**Principle:** The center of mass is always believably supported. Hips lead, extremities follow.
**Becker standard:** Every step re-weights the pelvis; before any kick, weight clearly transfers to the planted
foot; dashes push off a visible rear foot; landing absorbs through knees+hips. The character never floats —
gravity is a character.
**Our audit targets:** `clips.ts` (pelvis/hip keys across ALL clips), `grounded-dash.ts`, `patrol-walk.ts`,
`motion-laws.ts`, `player-motor.ts` (visual-vs-physics ground contact).
**Failure modes:** hip height constant through kicks (no support-leg loading) · kicks with no weight transfer to
the standing foot · dash poses with both feet off a plausible push point · landings that don't flex · torso
rotation with zero pelvis involvement (spine-first motion = puppet, not body).

### 7. Exaggeration & Pose Strength — ❌
**Principle:** Push every pose ~20% beyond realism for readability and impact. Silhouette first.
**Becker standard:** Extreme poses: a wind-up fist curls behind the ear, a sword chamber crosses the whole
torso, a dash stretches the figure near horizontal. Every key pose reads as a strong silhouette — test: can you
tell what's happening from the black shape alone?
**Our audit targets:** `clips.ts` (extreme pose amplitudes), `research/SILHOUETTE_MOTION.md`.
**Failure modes:** polite amplitude — poses at 60% of Becker's push · key poses that blur into each other ·
contact poses that hold 0 frames (never seen) · symmetric/hugging-center limbs (weak silhouettes).

### 8. Impact Frames & Hit Reactions — ❌
**Principle:** The "money frames" — contact pose, shockwave, enemy reaction — carry the entire exchange.
**Becker standard:** Contact frame is the most extreme pose in the clip and holds briefly. The victim's reaction
is choreographed as carefully as the attacker's strike: graded knockback matching force, secondary whip
through the spine, a beat of "dead air" on the heaviest hits.
**Our audit targets:** `clips.ts` (hit/contact events & holds), `attacks.ts` + `hit-resolution.ts` (hitstop,
knockback grading), `unarmed.ts` reactions, `enemies` render (enemy hit clips), `fx.ts` impact blooms.
**Failure modes:** contact frame lasts 0ms (sampling never shows it) · no hitstop on heavy hits · all knockbacks
equal regardless of attack power · enemy reactions start next frame with no transfer beat · kill/execution holds
(see existing work) inconsistent.

### 9. Secondary Motion & Accessory Physics — ❌
**Principle:** Things that AREN'T driven by muscle (blade inertia, scabbard, hair/cloth, breath) follow momentum.
**Becker standard:** The sword lags the hand, the scabbard swings from the belt, everything organic settles one
beat after the body stops. Adds life at zero gameplay cost.
**Our audit targets:** `equipment-motion.ts` (scabbard/blade), `skeleton.ts` spring-damper chain (solve order:
sample→blend→gameplay/root→secondary→limits→grip/foot IK→world→render), `context-motion.ts`,
`inertial-transition.ts`.
**Failure modes:** blade welded to the grip frame-perfectly (zero lag) · scabbard static during dashes ·
spring-dampers disabled/overdamped on the limbs that need them · no breathing micro-motion in idles.

### 10. Staging & Silhouette Readability — ❌
**Principle:** Action must read instantly: left-to-right flow, camera-clean silhouettes, key pose held 2-4 frames.
**Becker standard:** He stages exchanges so the attacker's motion crosses the viewer's eyeflow; big moments get
a held beat (~2-4 frames at full pose) so the eye can capture them; overlap of both fighters on the same
pixels is avoided at contact moments.
**Our audit targets:** `clips.ts` (held-key durations), `camera.ts` (does it frame/punch the action?), enemy
layering vs player render order.
**Failure modes:** 0-frame hold on the strongest poses · attacks that finish behind the enemy's body · camera
static during power moments (no micro-shake/punch-in) · multiple enemies overlapping the active strike silhouette.

### 11. Rhythm & Phrase Structure — ❌
**Principle:** Combos are sentences — tension, build, release, reset — with varied tempo, not metronome spam.
**Becker standard:** His fight sequences breathe: light rapid pressure, a pregnant pause, then the devastating
finisher. Tempo varies WITHIN a string; the last hit of a phrase is delayed a beat for punctuation.
**Our audit targets:** `moveset.ts` + `attacks.ts` (combo trees: light string, RENZOKU TSUKI, unarmed strings),
`clips.ts` (inter-hit timings), `stamina.ts` (rhythm economy).
**Failure modes:** string hits at perfectly even intervals (machine-gun) · finishers not given longer
startup+recovery · no pause-beat options mid-string · PAVE variation (`pave.ts`) not touching timing, only pose.

### 12. Character Acting — the "ALIVE" Factor (human creative vision) — ❌
**Principle:** Micro-behavior sells personhood: idle intent, breathing, eye-line/head tracking, weight
fidgeting, emotion readable from posture alone.
**Becker standard:** Even a stick figure emotes — the idle isn't a loop, it's a character thinking. Anticipation
of intent before action (looks before leaps), recovery attitude (a fighter settling with a small exhale dip),
victory/effort beats. This is the "human creative vision" layer beyond mechanics.
**Our audit targets:** `clips.ts` idles (ritual idle, sheath rest, combat idle), `patrol-walk.ts`, transitions
into/out of combat stance.
**Failure modes:** idles that are pure sinusoid loops with no phrase structure · no intent micro-poses before
player-initiated actions · combat idle identical to safe idle · no head/eye tracking of the nearest threat
(camera has the data — `enemy.ts`) · post-kill no settle attitude beat.

---

## CYCLE RULE
When all 12 are ✅: start **Cycle 2 — Deepening**. Reset marks to ⏳, raise the bar (re-audit every session with
fresh eyes at higher standard: e.g. Session 1 now demands 4-6 frame anticipations with hip counter-rotation
>25°). Cycle number and raised standards get appended to each session's header by the session that starts the
new cycle. The program never stops climbing.

---

## SESSION LOG

*(entries appended by each session run — newest last)*

```
LOCK: set 2026-11-11T05:46:30Z (GAP session 2 — follow-through & overlapping action)
```

### SESSION 1 — Anticipation & Wind-up (2026-11-10) — ✅

**AUDIT SCOPE:** `attacks.ts` (all 24 sword clips incl. RENZOKU TSUKI + RAIJIN ZAN), `moveset.ts`
(30-move unarmed set incl. RAIJIN KEN / FUJIN KYAKU), `power-dash.ts` (charge coils),
`clips.ts` DASH library, `combat/dash.ts` (anticipation fractions), prior studies
(ANIMATION-INVENTORY, COMBAT_TIMING_STUDY). Baselines taken BEFORE edits:
continuity-check = 10 pre-existing issues (RAIJIN-family smear-apex frames, accepted);
player-animation.test.ts 3/3; audit-player-anim.ts PASS.

**BECKER STANDARD (Session 1):** whole-body coil — the load happens in hips+legs+spine,
not just the weapon arm; 2-4+ frame counter-motion before every launch; weight sinks
before it rises; hips counter-rotate ~20-30° (0.35-0.5 rad) opposite the incoming
swing; readable load poses that let the audience predict the hit.

**GAP FINDINGS (ruthless numbers, @30fps = 33.3ms/frame):**
- **Zero hip counter-rotation across the ENTIRE sword family** except the RAIJIN/power
  clips: pelvisYaw/chestYaw are never authored in atk_l1–l5 / retreat / spin / stabs /
  h1–h3 / launcher / dashSlash / dashHeavy / charged / riposte / air — every key runs at
  NEUTRAL 0.04/−0.02 rad constant (≈2°). Becker bar: 20-30° (0.35-0.5 rad) counter-wind.
- **atk_launcher**: hit window opens at t=0.04 = **1.2 frames** after clip entry — worst
  anticipation-to-hit ratio in the moveset (pre-coiled kf0, no in-clip settle beat).
- **atk_l1**: wind-up 0→0.08 = 80ms/2.4f; only counter-motion = +1.2px rootY sink +
  rootRot 0.06→0.1; hand does not seat deeper on the saya.
- **atk_l2 / atk_l5**: chambers RISE (rootY −1.5 / −2) with **no pre-sink** — violates
  "weight sinks before it rises"; wind-ups 90ms/2.7f and 120ms/3.6f.
- **atk_stabs (RENZOKU TSUKI)**: chamber 0→0.09 = 2.7f, counter-pitch −0.12 ✓ but zero
  pelvis wind; thrusts rotate rootRot only.
- **atk_h2 (TSUKI)**: 120ms/3.6f chamber, counter-pitch −0.12, zero pelvis yaw — a
  passing lunge that Becker would load with a full hip wind.
- **atk_h3**: apex hang 200ms/6f ✓ (good) but the entry crouch carries no pelvis counter.
- **atk_dashheavy**: chamber-in-clip 0→0.06 = **1.8 frames**, no counter-wind.
- **Air family a1/a2/a3**: chambers 0→0.05 = **1.5 frames** each — below the 2-4f bar.
- **DASH entry (dashLaunch LOAD key)**: rearward gather rootX −1 (1px), rootY 8; held
  ~28ms of clip time + physical load phase = `anticipation .02 × .27s` = **5.4ms**
  drive delay → total visible gather ≈ 0.7 frame. Becker: 2-4 frames of visible
  rearward lean/weight shift.
- **Unarmed 30-movset: largely ALREADY Becker-grade** (design law mandates chamber beats,
  chest/pelvis counter-rotation, rootY sinks of 5.5-10.5px — ROUNDHOUSE/AXEKICK/HAMMER/
  SLIDEKICK/SPINHOOK are the models). Worst offenders: **unarmedKneeBarrage** first knee
  chamber 60ms/1.8f zero chest counter; **unarmedTackle** no rearward gather (chamber
  already pitched forward rootRot 0.5→0.55); **unarmedStepKick** 130ms chamber but no
  chest/pelvis counter-wind.
- **RAIJIN ZAN / RAIJIN KEN / FUJIN KYAKU / GALE BREAKER**: anticipation is BY DESIGN paid
  inside the planted DUAL_CHARGE/FIST_DUAL_CHARGE coils + SIT beat (.035) + authored
  pelvisYaw/chestYaw — these are the family exemplars; NOT edited (seamless-handoff law).

**FIXES APPLIED (all strictly additive inserts / channel adds — ZERO event retiming:
no hit.start/end, trail, swingSfx, cancel, moveX/moveXAt, moveY/moveYAt changed, so
no attacks.ts numeric-window sync was needed):**
- `attacks.ts` (11 clips): inserted counter-motion load keys inside existing wind-up
  spans + added pelvisYaw/chestYaw counter-wind→unwind to strike keys —
  l1 +0.04 coil (sink 2.2px, pelvis −0.14); l2 +0.04 sink-before-rise (1.8px, −0.16);
  l3 +0.05 load-deeper (1.6px, −0.14); l4 +0.05 counter-wind (rootRot −0.12, −0.15);
  l5 +0.05 crouch-before-jōdan (2px, −0.16); stabs +0.045 pressure-load (−0.20) + all
  3 THRUST keys gained escalating pelvisYaw +0.24/+0.26/+0.28; h1 +0.06 pre-sink
  (rootRot −0.26, −0.20); h2 +0.05 deeper chamber (2.2px, −0.22) + lunge/hold unwind
  +0.26/+0.20; h3 kf0 channels (−0.16); launcher +0.03 settle-deeper key (rootY 6→8,
  rootRot 0.32→0.26 counter-pitch, pelvis −0.16) — hit window unchanged; dashHeavy
  +0.03 micro-coil (rootY 2.6, pelvis −0.15, arm seats deeper). Contact/strike keys
  gained matching hip-unwind channels (+0.18…+0.28 pelvisYaw, −0.14…−0.24 chestYaw).
- `clips.ts`: DASH_LAUNCH_Q[0] LOAD strengthened — rootX −1→−2, rootY 8→8.6,
  kneeR −1.05→−1.15, kneeL −0.70→−0.75, head −0.12→−0.15, pelvisYaw −0.06→−0.10,
  chestYaw +0.04→+0.08 (the rearward gather now reads; flows to launch/chain/carry/
  hunt/pivot family entries; no timing change).
- `moveset.ts` (3 clips): unarmedKneeBarrage +kf(0.03) coil (rootY 5.5, knee pre-chamber
  −1.15, chestYaw 0.20 counter); unarmedStepKick +kf(0.06) coil (rootY 5, knee cocking
  hipR 1.35/kneeR −1.1, chestYaw 0.22/pelvis −0.14); unarmedTackle +kf(0.08) rearward
  gather (rootRot 0.16 vs the 0.5 drive, rootY 5.5, elbows fold, chestYaw 0.28/pelvis
  −0.12).

**VERIFY (all actually run):** `bun run lint` → exit 0. `.qa/continuity-check.ts` →
EXACTLY the 10 pre-existing baseline issues (RAIJIN smear-apex frames), ZERO new
(first pass introduced 13 new flags; every inserted key was re-bridged to respect the
≤0.72 rad/frame budget). `tests/player-animation.test.ts` → 3/3 pass.
`.qa/audit-player-anim.ts` → ALL CHECKS PASSED. `dev.log` → only GET 200 + ✓ Compiled
lines, zero new errors.

**PROPOSALS / FOLLOW-UPS:**
1. Air family a1/a2/a3: 1.5-frame chambers need pre-coil keys + counter-wind, but
   retiming hit windows (0.07→0.09+) requires attacks.ts sync — defer to a later
   session with smears.
2. Dash `anticipation:.02` (5.4ms visible load): raising to ~.045 gives a 1.5-2f
   readable gather but shifts the physical drive start — gameplay-feel change needing
   playtest signoff; LOAD-pose strengthening already improved the read.
3. Follow-through on the new hip winds: pelvisYaw settles straight back to NEUTRAL —
   Session 2 should author settle/overshoot keys so the unwind overshoots then settles.
4. atk_powerArc micro-load could gain a chest counter-wind; charged OVERLOAD could gain
   a coil-into-chamber entry key — both deferred (pose-lock / charge-hold pays it).
5. JAB 60ms chamber — acceptable for a kizami poke; revisit at Cycle 2 bar.

**COMMIT:** `407ffeb` — feat(anim): GAP SESSION 1 — anticipation & wind-up (Becker-grade coil) — pushed to origin/main
