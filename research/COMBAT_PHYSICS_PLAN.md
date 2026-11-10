# Combat map and physics enhancement plan

> Follow-up: `COMBAT_EXTERNAL_RESEARCH.md` adds external developer/animation/
> biomechanics research, revises the proposed combat direction, and links an
> analytical timing study. This original document remains the code-audit baseline;
> do not treat its example sequences as proven true combos.

## Scope and status

This is a source-code audit and implementation plan, not a gameplay rewrite.
Current attacks and combo rules are mapped below; proposed moves/mechanics are
explicitly labeled. No attack damage, timing, physics, controls or visuals were
changed in this audit. Preserve the completed null-black anatomy, walk, draw/grip,
weather and hold→release airborne dash work.

Companion files:
- `COMBAT_CATALOG.md`: every base and empty-hand attack with damage, active
  window, duration, cancel, reaction parameters and declared follow-ups.
- `combat-map.json`: the same data, movement events, 6 elemental kits, 50
  declared edges and 2,019 structural paths of length 1–5.
- `scripts/audit-combat-map.ts`: reproducible catalog generation and 180
  assertions checking timing bounds and referenced attack IDs.

“All possible combos” is a graph plus conditions, not a finite move list:
`a3 → a1 → a2 → a3` already forms a declared cycle, and dash/jump/parry/restart
routes expand it further. Structural paths are not playable-route certification,
true-combo proof, damage totals, or an infinite-combo guarantee. Enemy reactions,
spacing, charge, input history, movement, equipment and cooldowns matter.

## 1. Current action vocabulary

Notation: L = light (J/Z), H = heavy (K/X), ↑/↓ = held direction,
D = dash (Shift/L/C), JUMP = Space, P = parry (O/F), Q = stance toggle,
U = ability, I = ultimate, E = execution. `→` means a candidate sequence;
use the legal windows below, not button mashing at an arbitrary time.

### Sword-drawn attacks

| Family | IDs | Purpose / physics identity |
|---|---|---|
| Ground light | l1–l5 | Iai draw, descending diagonal, rising diagonal, horizontal cut, overhead finisher. Last hit has strong horizontal knockback. |
| Directional light | launcher, spin, retreat | Up-light rising attack/self-hop; down-light area sweep; facing-opposed light backstep cut when contextual facing permits it. |
| Ground heavy | h1–h3 | Overhead commitment, long forward thrust, ground-impact finisher. H3 also launches. |
| Charge | charged | Hold heavy, release into armored power cut; charge release threshold is .4s, readiness cue .55s. |
| Dash strikes | dashSlash, dashHeavy | Light through-cut and grounded heavy piercing attack. |
| Counter | riposte | Successful parry grants a .95s counter opportunity. |
| Air chain | a1–a3 | Alternating cuts and multi-hit horizontal air cut, with attack-specific gravity reduction and enemy juggle values. |
| Air enders | dive, slam | Down-light forward dive or air-heavy meteor; separate landing impact definitions. |

20 attack IDs are not 20 separate input buttons: context and combo history
select the definition. `l5` and `h1` even share a display label but differ in
startup, damage and commitment. Catalog retains the IDs to avoid ambiguity.

### Empty hand / sword sheathed

Same input intents are adapted, not a hidden sword damage shape:
- l1/l2/l3/l4/l5: jab → cross → hook → elbow → power palm.
- h1/h2/h3: power hook → power palm → power hammer.
- launcher: uppercut; spin: hook; retreat: elbow.
- a1/a2/a3: airborne jab/cross/hook; dive/slam: descending hammer.
- dashSlash/dashHeavy: palm / power palm; riposte: power cross.
- charged: power palm. Adapter uses its own durations and speed 1.
- Contact is visible hand/forearm or elbow, not an invisible sword.
- U is a 30-damage focused palm using current sword ability energy cost;
  E routes to guard-break strike (40 base damage), I to focused-palm finisher
  (65 base damage, consumes full meter). Air variants select a2 intent.

Important mismatch: unarmed adaptation drops sword `moveX`, launcher hop,
explicit juggle values and landing shockwave definitions. These are real
mechanical differences, not simply smaller sword damage. Do not promise the
sword launcher route works unchanged with fists.

### Abilities, ultimate and execution

Six drawn kits: katana Blade Storm, inferno Inferno Wave, thunder Thunder Rush,
void Void Step, gravity Gravity Crush, phantom Phantom Barrage; each has its
named ultimate (catalog lists costs/names). They mix scripted sequences,
projectiles, teleportation, pulls and delayed strikes. They are not regular
`AttackDef.chain` nodes; no claim that U/I cancels any attack at any frame.

Normal U is selected in movement/combat input processing if energy is sufficient.
I is handled by Game at meter ≥100 and no running execution/ultimate. E searches
for a living, non-spawning, non-boss target at ≤50% HP in stun/launched/down,
within horizontal 170 and vertical 190 world pixels. Drawn E enters a cinematic;
empty-hand E performs a guard-break attack instead. Bosses are not executable.

## 2. Runtime combo grammar — actual rules

### Normal selection
1. Ground neutral L advances a persistent light index, capped at l5. Idle gap
   >1.1 game seconds resets it. It is not reset to l1 by every heavy.
2. Ground ↑L selects launcher; ↓L selects spin. Opposed-direction light may
   select retreat if facing context has not already flipped toward that input.
3. Air L cycles a1→a2→a3→a1; air ↓L chooses dive.
4. Ground heavy tap/release advances h1→h2→h3 in normal movement, with 1.15s
   history decay. Ground held H enters charge. Air H selects slam.
5. During dash: L selects dashSlash; H selects grounded dashHeavy or air slam.
6. After dash: ground L can still select dashSlash for .18s if |vx|>110 and
   no riposte override. After the charged airborne dash, air L instead selects
   the air-chain context; requirement fallback may turn ground moves into a1.
7. Successful parry sets riposteT=.95. Ground in-attack chaining checks this
   explicitly; ordinary light input also gives the counter precedence.

### Transition windows and selectors
- Dash and parry cancels open at `animT ≥ hit.end * .6`, OR at normal cancel.
  This can be during the active attack; “after all contact frames” is NOT the
  current rule. Dash still checks cooldown/air-use availability.
- Ground forward/neutral dash cancel now enters planted dashLoad and launches
  on release; air/backward/vertical/high-speed reversal dashes remain immediate.
- Attack-to-attack chains and grounded jump cancels open at `def.cancel`.
- Buffered L has priority over buffered H. Input buffering uses real input time;
  authored clip clocks and game-time history counters are different clocks.
- L computes the contextual next attack using the global index, then validates it.
- H in air chooses slam; held ground H enters charge; ground H tap chooses the
  FIRST declared h1/h2/h3 follow-up, otherwise proposes l1 for heavy-kind attacks
  or h1 for others. It does not offer a free choice among all listed heavies.
- `fromChain`: riposte always passes; launcher permits air-family/dive/slam;
  explicit declared links pass; a grounded light can restart if any light
  follow-up is listed; an airborne air-family choice can pass if any air-family
  follow-up is listed. Requirements are rechecked in startAttack, with a1/l1
  fallback. Thus raw `chain[]` is neither the complete nor exact input graph.
- Finishers with empty chain lists do not automatically flow into another
  ordinary attack mid-animation. They can still use valid defense cancels,
  grounded jump cancel at normal cancel, or return to movement on completion.

### Useful route families to exercise

These are input/definition routes to test for contact, not claims of guaranteed
hitstun locks. Reset index history before comparing routes.

| Route | Inputs / conditions | Main constraint |
|---|---|---|
| Five-light string | neutral L×5 → l1/l2/l3/l4/l5 | Buffer at each normal cancel; l5 ends ordinary chain. |
| Heavy string | tap/release H×3 → h1/h2/h3 | Release before charge threshold; h3 ends ordinary chain. |
| Early heavy branch | l1 → H → h1 → H → h2 → H → h3 | First matching heavy follow-up, not arbitrary h selection. |
| Late heavy branch | l4 → H → h2 → H → h3 | Requires reaching l4 under light history. |
| Light/heavy mix | l1 → h1 → L | Usually l2, not l1, because global light history persists. |
| Ground crowd route | ↓L spin → ↑L launcher | Both contextual choices must survive declared/runtime validation. |
| Sword air route | ↑L launcher → release ↑ → L/L/L → H slam | Hop/state, target height, juggle and gravity must line up. |
| Air dive ender | jump → L → L → ↓L dive | Descending damage + landing impact are separate events. |
| Air loop | a1 → a2 → a3 → a1 … | Structurally cyclic, limited by altitude/target state; verify anti-infinite policy. |
| Dash opener | quick D release → L → grounded light/heavy | Cooldown and chosen dash variant apply. |
| Loaded leap opener | hold D → release → air L → L → H | Real airborne release; cannot assume ground dashHeavy remains valid. |
| Ground dash pierce | grounded dash → H | Requires ground; air H becomes slam. |
| Counter | P succeeds → L riposte | .95s opportunity; counter is not an always-available move. |
| Charge punish | hold H≥.4s → release | .55s ready cue; .5s armor on sword charged release, not invulnerability. |
| Defense reset | attack → D/P | Earlier window, but D may now stop to load; no guaranteed offensive link. |
| Jump reset | ground attack at cancel → jump → air L | A state transition, not a direct declared chain edge. |
| Empty-hand uppercut route | ↑L → jump-cancel → air L | Self-hop is not preserved; upward enemy launch sign is currently suspect. |
| Resource ender | hit sequence → recover → U/I/E if eligible | State/resource/target conditions; not universal chain cancels. |

## 3. Physics findings — fix correctness before adding moves

Source locations are functions/files, not brittle line numbers.

### P0: vertical conventions and gravity
1. `unarmedAttack()` in combat/unarmed.ts authors uppercut `launch:420` while
   Y-down coordinates require negative upward launch. Sword launcher uses -640.
   `Enemy.hit()` consumes launch directly. Test upward displacement against all
   eligible enemy types; choose an upward value based on intended juggle height.
2. `Enemy.update()` adds 1350*dt inside launched and another 1900*dt in shared
   physics for non-drone launched enemies: effective 3250. Make gravity have one
   owner. Do not simply remove one term without rebalancing existing launch
   heights/times. Drones differ and need separate tests.
3. `kbY` is carried in runtime info but not applied as a general vertical impulse
   in Enemy.hit. Define distinct vertical impulse/launch/juggle semantics instead
   of making designers enter unused values. Gravity ability also manipulates
   launch state directly; route it through the same policy after migration.

### P1: motion/contact and route truth
4. `Player.updateAttack()` replaces vx/vy at move events; enemy hit reactions also
   replace velocities. Dash-carried speed may be cut to a fixed attack speed.
   Replace with intentional, bounded force profiles rather than a blanket
   additive impulse that would accelerate chains indefinitely.
5. Adapter preserves chains but removes sword launcher self-hop and air juggle.
   Author independent empty-hand follow/recovery, not copied impossible routes.
6. Sword dash attacks use a synthetic rear124→front66 horizontal hit corridor at
   y-55; fists use visible contact instead. Tie future through-cuts to the actual
   traveled path plus visible strike envelope, with bounded grace and auditing.
7. Hit tests run when current animT lies inside active interval. Test interval
   crossings at high playback speeds/large dt, swept geometry and multi-hit
   rearm during hitstop. Static definitions passing does not prove collision
   timing is robust.
8. Combo data and input resolver disagree in meaning. Add explicit input edges,
   conditions and window types, then auto-generate in-game help and tests from
   the same resolver. Do not advertise every chain-array entry as an input route.

## 4. Proposed physics architecture

Stylized arcade mechanics in world pixels/seconds; preserve strong anime timing.
Do not replace readable attack posing with uncontrolled ragdolls.

### One motor and one simulation clock per physical action
`AttackMotionProfile` proposal: load duration, thrust duration, impulse budget,
max assist speed, brake strength, support mode, air-gravity profile and recovery
settle. Keep damage/contact clock separate from display pose smoothing.
Use fixed substeps (e.g. ≤1/240s), split at load/drive/contact boundaries, and
integrate displacement rather than repeatedly setting vx. Carry inherited
momentum into the motor, with explicit reversal/braking branches.

For a desired Δv, use impulse budget `J=m*Δv`; distribute force over drive with
a normalized pulse (e.g. 6u(1-u)/T). Track spent impulse so cancels cannot apply
it twice. Use finite positive work and speed-assist limits to prevent dash→cut
loops pumping unlimited energy. Whiff and block do not earn hit-confirm assists.

### Support/contact model by move family
| Family | Support / force plan | Contact / recovery |
|---|---|---|
| Jab/cross and quick light | Rear-foot push, opposite shoulder/hip lag; low translation | Visible fist/blade sweep; retract without torso snapping upright. |
| Hook/horizontal sweep | Short planted pivot and bounded yaw torque | Preserve arm lengths; plant switches only through release/replant. |
| Overhead heavy/hammer | Compression then vertical/forward unloading | Feet absorb on impact; whiff overshoot longer than confirmed contact settle. |
| Thrust/palm | Rear-leg extension with reach-limited front lunge | No arm stretch; block arrests body more than hit-through does. |
| Launcher/uppercut | Crouch→leg drive; explicit self-hop policy per stance | Negative-Y target impulse, capped follow height; reliable air-state handoff. |
| Dash slash/pierce | Carry dash momentum; spend only additional finite drive | Through-path must correspond to actual recent travel; catch on miss/wall. |
| Loaded-release flight | Charge planted→ballistic launch→streamline→landing | No extra jump charge or invulnerability; air strike cannot reset launch impulse. |
| Aerial string | Bounded reduced-gravity window, not repeated vy reset | Diminishing juggle lift and explicit aerial-time budget. |
| Dive/meteor | Finite downward drive with terminal speed | Swept floor collision, one landing impact, time/normal-speed-based compression. |
| Counter | Small grounded brace→intentional return impulse | Resolve block/parry normal; no magical target-distance pull. |

Grounded foot support must constrain reachable pelvis height; temporary foot
release must be explicit. Never solve an unreachable foot and stretch anatomy.
Use smooth phase envelopes for pose targets, not 2-pose A/B blends. Keep the
existing hand/sword endpoints and contact IK authoritative for hit geometry.

### Enemy response and weight
Use a common hit-response contract: contact point/normal, horizontal and vertical
impulse, hit type, stagger/guard pressure and juggle cost. Preserve intentional
arcade knockback but attenuate by enemy class/resistance; bosses use stagger
budgets rather than being launched like light enemies. Constrain ground normal
and floor penetration in one integration path. Direction must be deterministic
when attacker/victim overlap, not based on noisy near-zero position differences.

Define hit, block, armored, parried, whiff, killed outcomes explicitly. Apply
hitstop, recoil and resource rewards according to resolved outcome. Test current
world callbacks before changing reward behavior. Avoid recoil that pulls the
player away so far that the next intended light cannot connect.

### Air combo / anti-infinite policy
Track target juggle budget and decay per new confirmed air hit. Use a small,
bounded vertical assist after genuine contact, not infinite float on whiffs.
Reset budget on landing with a short re-launch resistance interval. Keep a3
multi-hit and Phantom echoes from granting a new full lift on each tick. Ground
slam should terminate an aerial route, not refresh its budget. Expose these
rules to the catalog so combo descriptions can say what is actually repeatable.

### Damage and physical motion are related, not identical
Do not derive damage directly from raw relative speed: fast dash chains would
break balance. Use authored damage; bounded speed/contact-direction weighting
can affect knockback and effects first. Hitstop freezes the selected clocks
consistently; never accumulate motor force while frozen and release it as a burst.

## 5. Proposed new attack space — not implemented

| Candidate | Input / role proposal | Required foundation |
|---|---|---|
| Low cut / leg sweep | Directional ground branch with trip, not another spin alias | Ground-height contact and knockdown/get-up resistance. |
| Stop-thrust / intercept palm | Attack during braking, small range but counter pressure | Relative approach-speed check and explicit counter outcome. |
| Charged flight cut | Release leap → contact-timed L, with distinct landing recovery | Actual flight-path sweep and inherited-momentum motor. |
| Aerial downward palm | Empty-hand dive distinct from meteor hammer | Separate visible hand trajectory and landing endpoint. |
| Guard crush | Committed heavy vs blocking target | Guard-pressure budget and recoil; not unconditional break. |
| Wall rebound strike | Contact wall, deliberate follow-up input | Wall normal, clearance checks and non-looping rebound budget. |
| Dodge counter | Attack after a genuinely avoided enemy strike | Threat/avoid event confirmation; no reward on arbitrary dashes. |
| Disarm/grab/throw | Optional close-range control branch | Paired sockets, size eligibility, contact ownership and escape policy. |
| Charged feint | Cancel load into guard/step at a cost | Explicit input edge and finite spent-force/resource rules. |

Do not add every option at once. Highest-value additions after correctness:
stance-specific launcher/air follow, momentum-preserving dash strike, distinct
empty-hand dive, then guard-crush/intercept. Throws and wall attacks are later
scope because they need substantially different collision/contact contracts.

## 6. Delivery order and acceptance gates

1. **P0 reaction consistency:** signed launch, single gravity owner, kbY semantics;
   snapshot current heights first. Enemy-class tests, 30/60/120Hz, floor clamp.
2. **P1 truthful combo resolver:** explicit conditioned input graph, generated
   player help, rejected-input reasons; test fresh and nonzero light/heavy history,
   stance switching, charge release, ground/air fallback, buffer priorities.
3. **P1 finite attack motor:** migrate one light and one thrust first. Preserve
   contact frames and damage. Test standing, running, opposing and dash momentum;
   wall collision; block/whiff/hit; cancel on every phase; no double impulse.
4. **P1 stance-specific launcher/air reactions:** prove upward motion, reachable
   targets and landing reset for fists and sword. Tune finite juggle budgets.
5. **P2 all families + impact polish:** migrate remaining heavies, dash attacks,
   dives, charge/counter, then ability exceptions. Preview each in a real game.
6. **P2 new moves:** choose the additions above only after the catalog and physics
   tests describe the same runtime behavior.

Validation matrix: 2 stances × 6 sword stat sets × 30/60/120Hz × key enemy classes
× hit/block/whiff/armored/parried × stance/ground/air/velocity contexts. Generate
pairwise coverage for the broad set and exhaustive critical route cases rather
than pretending one enormous Cartesian run proves gameplay quality.

Hard gates: no NaNs; no joint length changes; no floor/wall penetration; no damage
outside crossed active intervals; once-per-target/declared rearm; single landing
AoE; single motor impulse; no unbounded speed/juggle; resource/cooldown conservation;
no auto-draw or hidden-blade fist damage. Measure displacement/apex/contact-time
agreement at each Hz (start target ≤5% difference, tighten after baseline).

Visual review: actual-player contact sheets and 60Hz captures for load→drive→hit
or miss→follow-through→catch→settle, both directions and stances. Use bright audit
backgrounds for anatomy and dark storm gameplay for silhouette. Preserve null
black body/no glowing eyes/no costume tubes; camera effects cannot hide contact
errors. Do not claim a true combo until an enemy simulation shows every next
contact precedes escape/recovery while staying in range.
