# Third combat review: runtime evidence, encounters and decision boundaries

## Context that remains non-negotiable

Keep the minimal continuous null-black fighter: no glowing eyes, ponytail,
capsule costume, visible bones or joint discs. Preserve the rebuilt patrol walk,
10FPS sprint presentation (not lower simulation FPS), equipment-specific hands,
actual draw grip/extraction, and persistent storm. Hold dash means planted load
followed by release into real horizontal airborne travel, not hold-to-sustain.
Transitions must show a force/contact sequence, not merely interpolate A→B.
No reset or broad rewrite of this work is justified by the new research.

This document supplements COMBAT_EXTERNAL_RESEARCH.md and the original code
catalog. It contains concise findings and design decisions, not private internal
reasoning. No production gameplay code was changed during this investigation.

## 1. New research questions

The previous review still centered on the attacker. This pass asks:
1. Does the resolved outcome agree with rewards, damage, reactions and death?
2. Does a visually valid attack actually contact at realistic ranges?
3. How should multiple enemies create openings for the planned combo roles?
4. Where should target alignment stop, so assistance does not become snapping?
5. Which collision/clock assumptions remain untested?

## 2. Actual project experiments

Reproduce: `node --import tsx scripts/research-combat-runtime.ts`.
Output: `combat-runtime-study.json`.

### Matrix and limits

20 attack IDs × 2 stances × 3 rates (30/60/120Hz) × 3 starting ranges
(35/75/140 world pixels) × 3 classes (grunt/shield/heavy) = **1,080 cases**.
Each case runs 1 second of combat: **75,600 measured combat updates**, totaling
1,080 simulated combat seconds; warm-up updates are additional, not included.
Player and enemy use their real update/collision/reaction methods. Heavy starts
in windup, shield starts guarding, then ordinary enemy updates continue.
Air-required attacks start the player at y=-90. Real target movement is enabled.
All player/enemy pose channels and checked world positions remained finite.

Limitations: startAttack is called directly, not through the input selector;
world hit callback calls actual Enemy.takeHit but does not run Game scoring,
elite parry, projectiles, actual hitstop/slowmo or player damage from enemies.
Three initial ranges do not measure full attack reach: enemies and attacker move.
Different matrix rows consume a seeded random stream, so this is not an
identical-input frame-rate equivalence test. Seed is 123456; Math.random is
restored on exit. A repeat run produced byte-identical JSON (SHA256
f8e8cfe8e1b4432aa168dff2b14cfff981ebf528e4fc2daaef83bcb94a638e88).

### Measured findings

| Finding | Observed result | Meaning / next action |
|---|---|---|
| Contact coverage | 858 contact callbacks across 697 cases | Not a hit-rate/balance grade. Some attacks intentionally miss ranges/heights or are adapted by requirements. Inspect per-row outcomes. |
| Block reward coupling | 68 cases had exclusively blocked outcomes and positive energy beyond passive regeneration | Player calls onLandedHit after a void hitEnemy callback, so it cannot distinguish block/parry/armor outcomes. Make outcome policy explicit. |
| Uppercut direction | Unarmed launch +420, immediate vy +420, minimum y=0 | Actual reaction goes downward; this is no longer only a static sign suspicion. |
| Sword comparison | Launch -640, minimum y≈-60.375 at 120Hz | Confirms actual upward arc, distinctly smaller than a single-1350-gravity estimate. |
| Combined gravity | Launched grunt at y=-100, vy=-640; .01s update implies g=3250 | Confirms both gravity terms operate for this state/class. |
| Shield chip death | HP starts 1; blocked jab leaves HP≈-.44, outcome blocked, dead=false | Death is not resolved in the chip branch. Either explicitly forbid lethal chip with an HP floor or resolve lethal chip consistently. |
| Armor semantics | Light sword strike on windup heavy: outcome armored, HP loss≈6.48, state windup | Armor prevents interruption, not damage. This can be intentional; do not “fix” it into invulnerability by accident. |

### New source-code findings, not claimed as runtime observations

Game.hitEnemy calls combo.onHit and awards score after Enemy.takeHit but before
branching on blocked/armored/hit/killed. Elite parry returns before that path.
Player's caller nevertheless runs onLandedHit after the callback returns because
WorldRef.hitEnemy returns void. Therefore score/combo and player energy/meter
currently have different outcome visibility. Need an explicit policy, not a
blanket rule that only HP loss counts: block pressure and armored damage may
deserve some reward, but elite deflection should not masquerade as confirmed hit.

Enemy.takeHit subtracts normal damage and handles lethal results before the
heavy-windup armored branch. This agrees with the measured armor behavior.

Game hitstop is 5% time scale, not a literal simulation pause. Weather uses a
separate real visual clock. Player updates before enemies; input edges clear
after each simulation substep. Large-frame catch-up can use a .05s step. These
facts matter for frame-data interpretation and active-window crossing tests.
Do not assume the previous analytical timing table models this entire loop.

## 3. New external research

### Encounter orchestration: Bart Vossen
Read introduction/tells and enemy/group AI sections (chunks 0 and 2). Original
article page dates it May 4, 2015; search result date was misleading. It includes
interviews about spacing, regulating simultaneous attacks, offscreen warnings
and matching moves to enemy purposes. It also contrasts tightly regulated
attackers with Aztez's categorized simultaneous threats.
[1](https://www.gamedeveloper.com/design/enemy-design-and-enemy-ai-for-melee-combat-systems)

**Project implication:** don't blindly impose one attack token. Our action game
already describes/uses engagement limits; first measure overlap of threat
windows and the screen-space visibility of their tells. Separate melee, ranged
and aerial pressure budgets, with safe release of permissions on stun/death/
spawn/cinematic transitions. Targetable space and attack timing need separate
controls. In a side view use left/right approach bands and separation rather
than copying a 3D ring of slots.

### Complementary enemy counters: Death of a Wish
Read developer article text chunks 0–1. It explains enemy responses to a player
with free attacks/dodges, and pairs close-range strings with chase/ranged options;
contrasting rhythms punish rote defensive timing. Embedded GIFs were not
downloaded or watched; findings concern the article's written explanation.
[2](https://www.gamedeveloper.com/design/enemy-design-in-death-of-a-wish)

**Project implication:** longer player combos need enemies that make route choice
matter. Propose distinct interactions, not blanket resistance: grunt supports
launch practice; shield tests flank/guard pressure; heavy punishes unchecked
light flinches; ranged enemy tests approach timing. Do not hard-counter every
player tool and remove the stylish power fantasy. Give each encounter an
intended opening and a clearly signaled way to create it.

### Target alignment: Epic Motion Warping documentation
Read overview and window/translation/rotation options (chunk 0). Official engine
documentation demonstrates aligning root motion within authored windows; it
is not a balancing guide or evidence that constant target magnetism is good.
[1](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine)

**Project implication:** any future range assistance must have an explicit
window, maximum correction distance/angle, collision veto and target snapshot.
Stop tracking before committed contact; let a whiff remain a whiff if the target
escapes. Do not continuously rotate/reposition the fighter to follow a target
through their back. Preserve weapon/hand endpoints and ground reach limits.
Our Canvas engine need not adopt Unreal or skeletal root motion to use this
bounded-alignment principle.

### Continuous collision: Box2D primary documentation
Search returned official repository documentation explaining that sensors do
not detect pass-through within one time step and recommending ray/shape casts
for fast objects. This is a documentation excerpt, not a live Box2D experiment.
[1](https://github.com/erincatto/box2d/blob/main/docs/simulation.md)

**Project implication:** adding a physics library or an overlap sensor alone
would not certify fast dash cuts. Test temporal intersection of active interval
and motion sweep. Distinguish a moving endpoint sweep from the full moving blade
segment; include target movement as well as attacker movement. Full rotational
CCD is not automatically solved by larger padding or extra visual frames.
Do not replace the custom engine solely for this issue.

Rejected leads: unrelated/sensational search results about fighting-game
services, generic AI-produced engine prototypes and rollback marketing were
not accepted as evidence. Multiplayer rollback is not a requirement here.

## 4. Alternatives and decisions — bounded branching design summary

| Decision | Alternatives considered | Recommended direction / trade-off |
|---|---|---|
| Outcome transport | void callback + side effects; boolean hit; structured result | Structured resolution: hit/block/guard-break/armor/parry/killed plus actual HP loss, contact and reaction. Boolean loses too much information. |
| Reward policy | reward all overlaps; reward damage only; outcome-specific | Outcome-specific rewards, with explicit chip/armor/deflection choices. Prevent hidden farm loops without invalidating pressure play. |
| Chip lethality | nonlethal floor; lethal chip with death resolution | Choose deliberately and test both boundaries; don't leave negative HP with a live shield. |
| Gravity | retain double terms; blindly delete one; consolidate with target arc | One owner, preserve/tune measured apex and flight time. Arc and combo timing matter more than a familiar constant. |
| Attack assistance | none; continuous homing; bounded phase alignment | Bounded pre-contact help with collision/angle/range limits. Preserve meaningful spacing and readable whiffs. |
| Crowd orchestration | independent agents; one global token; categorized pressure | Measure current engagement behavior, then budget threat types and visibility. Avoid both dogpile and polite enemy queue. |
| True combo design | every string locks; no guaranteed links; intentional subsets | A few reliable starter→connector links, plus escapable pressure and committed enders. Explicitly label them. |
| Physical reactions | generic backward shove; ragdoll; authored reaction + bounded impulse | Direction/height-aware authored response with finite physical translation; keep silhouettes and control. |

These are concise design choices with trade-offs, not a transcript of internal
reasoning. Recommendations remain proposals until implemented and playtested.

## 5. Revised dependency order

1. **Combat resolution contract and telemetry.** A ContactResolution result must
   reach Player, Game score/meter, enemy response and FX. Audit damage and death
   in chip, armor, guard-break and elite-deflection paths first.
2. **Reaction-state consistency.** Upward sign, single gravity owner, general kbY
   semantics, launch/state synchronization, grounded reset and death interruption.
3. **Clock/active-window coverage.** Trace input receipt, animation phase, swept
   contact interval, resolved outcome, hitstop and recovery using named clocks.
   Preserve independent weather updates and one-substep input edges.
4. **Input-accurate combo graph.** Ground/air requirements, global indices,
   replaceable buffer, cancel type, opponent escape time and resource guards.
5. **Per-family finite attack motor and bounded alignment.** Start with one jab,
   cross and thrust. Test standing/run/dash/reversal entries, hit/block/whiff,
   walls and cancelled impulses. Do not reset velocity as a cosmetic shortcut.
6. **Victim extension budgets and encounter pressure.** Make reliable routes and
   counterplay visible before adding more animation variants.
7. **New moves.** Flight cut, empty-hand aerial ender, guard crush/intercept first;
   paired grabs and wall rebounds only when their contact contracts exist.

## 6. Next targeted tests

- Full Game/browser probe of block/elite parry/armor reward and score behavior;
  current entity matrix does not cover these Game-level branches.
- Chip at HP below/equal/above chip damage; guard break with lethal chip; lethal
  armored strike; same-frame death from multi-hit/echo/projectile.
- Matching input replay per case at each Hz with deterministic RNG per case,
  not just one seed across the whole matrix. Compare outcomes, not only finiteness.
- Temporal hit coverage at slow frames and fastest sword: enter and exit an
  active window in one step; rotating blade and moving enemy; no duplicate hit.
- Two enemies straddling player, projectile behind melee, and airborne player
  against grounded windup. Count unreadable overlap and offscreen threat starts.
- Real-input l1→l2 and l4→l5 at early/mid/late contact; log whether the enemy
  recovers before next contact. Test stance switch and buffered input changes.
- Contact sheets and 60Hz real-game captures with effects disabled, then full
  storm gameplay. Body/weapon grounding must be clear without camera shake.

## Validation of this research turn

Runtime harness: 1,080 cases, 75,600 combat updates, checked values finite;
repeat output hash matched. `bun run check`: 114 tests pass plus typecheck and
animation/continuity audits; lint has an existing ignored-cache study warning,
no errors. `git diff --check` checked separately. No gameplay or preview build
changed; no new claim of watching inaccessible anime footage.
