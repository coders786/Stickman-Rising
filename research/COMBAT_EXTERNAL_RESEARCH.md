# Deeper combat research: evidence, trade-offs, revised direction

> Continued in `COMBAT_REVIEW_RUNTIME_AND_ENCOUNTERS.md`: actual 1,080-case
> Player/Enemy investigation, outcome/reward findings, further encounter and
> collision research, and revised implementation dependencies.

## What changed from the first plan

The first document mostly cataloged our implementation. This pass researches
external combat design, fighting-game combo systems, animation and biomechanics,
then tests the implications against our authored timing. It does not add attacks
or change gameplay. This is a targeted design investigation, not an exhaustive
survey of every action game or proof of real-world sword technique.

**Main revision:** don't start by making every attack more physical and every
combo longer. First decide which actions should flow, which should commit, and
how the opponent communicates the consequences. Physics supports those decisions;
it cannot choose them for us.

## 1. Evidence ledger — what was actually read

### R1. Eric Williams: Combat Canceled (2008)
Former God of War combat designer distinguishes partial/complete cancels and
buffered/instant execution; describes differing commitment policies in God of
War, Ninja Gaiden and Devil May Cry. Read the main article text (chunks 0–1).
Primary developer account, but its comparisons concern contemporary versions
and sometimes explicitly express the author's interpretation, not universal
rules for every sequel. [1](https://www.gamedeveloper.com/game-platforms/combat-canceled-i-god-of-war-i-action-game-design)

**Application:** replace one generic cancel-time idea with action-specific
windows and outcome conditions. Keep defense forgiving on quick lights while
charge, thrust enders and meteor landings retain visible commitment. A buffer
must be replaceable by a later higher-priority intent, not blindly execute a
stale attack after the threat changes. This is our recommendation, not a rule
copied wholesale from the article.

### R2. Mariel Cartwright: Powerful and Effective Animation for 2D/3D Games
Read the returned GDC presentation text through the available first-30-page
PDF extraction, including silhouette, anticipation, favoring keys, follow-through,
smears, overshoot, variable holds and hitstop. References include Skullgirls,
Naruto Ultimate Ninja Storm 3 and Metal Gear Rising. This is presentation text;
the talk video and its moving examples were NOT watched.
[4](https://media.gdcvault.com/gdcchina14/presentations/833784_MarielCartwright_PowerfulAndEffective_EN.pdf)

**Application:** “smoother” must not mean equal spacing and equal frame holds.
Use fast travel between strongly readable keys, then longer contact/catch holds
where appropriate. Reject the deck's extreme limb-breaking examples for our
continuous anatomical character: keep bone lengths and contact IK, exaggerate
spacing, silhouette and trail instead. Do not reduce the simulation frame rate.

### R3. Nicolas Kraj: Anatomy of an Attack
Read introduction/enemy anticipation (chunk 0), Hornet timing analysis and
player/input-lag sections (chunk 2). This is a designer's analysis, not source
code or independently verified frame data. It separates anticipation, attack
and recovery and connects them to windows of opportunity.
[1](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/)

**Application:** author enemy tells before extra player moves. A long sweep,
straight lunge and overhead must be distinguishable in black silhouette. Treat
its reaction-time numbers as heuristics, not a universal minimum for every
player jab or every enemy. Measure our browser input-to-visible-response time
rather than importing another game's latency figures.

### R4. PlatinumGames official blog: Interview with Saurian Dash, Part 1
Read chunks 0–1. An official-hosted interview with the strategy-guide author,
not an engine specification. Describes learning cancel safety against a boss,
Dodge Offset, and enemy/scoring systems that give offensive choices purpose.
[1](https://www.platinumgames.com/official-blog/article/6421)

**Application:** consider a bounded combo-position bookmark across one evasive
step, rather than resetting the entire string or granting unrestricted cancels.
But distinguish offensive held-release leap from immediate defensive retreat:
forcing the new dash load onto every defensive situation would undermine flow.
Do not call our persistent global light index “Dodge Offset”; it lacks an
explicit bookmark, expiry and eligibility contract.

### R5. Dustloop: Infinite Prevention and Combo Mechanics
Read the author essay's chunks 0–1: scaling families, timer/tally/repeat systems,
air recovery, pushback, gravity and state-usage limits. Community analysis,
not developer testimony; game-specific claims need patch/version checking.
[1](https://www.dustloop.com/w/User:Slimegirl-scientist/Infinite_Prevention_and_Combo_Mechanics)

**Application:** damage scaling alone does not prevent indefinite crowd control.
Time decay penalizes delays and links; raw hit-count penalties disproportionately
punish multi-hit animations. Prefer an action-level juggle budget plus repeated
move cost, with a separate total airborne safety cap. These are design choices
for our PvE game, not a copy of the competitive games' burst mechanics.

### R6. Dustloop: DNF Duel damage
Read combo-system and scaling portions of chunk 0. The page explicitly warns
that it is incomplete/potentially inaccurate; do NOT transplant its exact frame
constants. It documents separately tracked ground/air hitstun decay and a
non-increasing damage-rate concept.
[2](https://www.dustloop.com/w/DNFD/Damage)

**Application:** track ground and air routes distinctly; landing/launch transitions
must not accidentally refresh a victim's whole combo budget. Keep damage
scaling, stun decay and physics assistance as independent knobs.

### R7. Liu et al., Biomechanics of the lead straight punch (2022)
Read abstract/methods portions in chunk 1; 16 male boxers, motion capture,
force platforms and target sensors. Study discusses acceleration/braking and
lead-leg measures, not just arm speed. Small, controlled sporting sample, not
universal evidence for hooks, uppercuts, sword cuts or free combat.
[1](https://pmc.ncbi.nlm.nih.gov/articles/PMC9798280/)

**Application:** don't animate every punch with the same “rear foot initiates,
hips turn equally” template. Lead jab needs compact preparation and support;
cross gets greater rear-side drive; recovery/braking deserves its own key.
Avoid importing SI force measurements as game damage. The paper's abstract
also has suspiciously repeated numerical entries/units for impulse versus RFD;
we do not use those numbers to calibrate our motor.

### R8. Chen et al., Biomechanics of fencing sport: a scoping review (2017)
Read abstract, introduction and methodological limits (chunk 1), plus PubMed
figure caption. Review covers 37 studies, with evidence rated fair and heavy
representation of male foil fencers/lunges. It supports coordinated upper/lower
limb action, not one mandatory timing sequence for all blade attacks.
[1](https://pubmed.ncbi.nlm.nih.gov/28187164/)
Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC5302478/

**Application:** thrust needs a rear propulsive leg, front-foot flight/catch and
braking support, unlike a rotational sweep. A sporting lunge is not proof of
traditional katana or near-horizontal anime flight. Use it for force/contact
logic, not as literal choreography for every sword move.

### R9. Anticipation in fencing (2024)
Read introductory mechanisms and methods (chunk 1): six elite female epee
fencers, EMG/force plates and coach-stimulus task. Small specialist sample;
readiness/anticipatory activation is not the same as a prescribed visible
wind-up or a charge-button duration.
[1](https://pmc.ncbi.nlm.nih.gov/articles/PMC11079120/)

**Application:** the load pose should show organized readiness through foot
pressure, knee compression and orientation—not simply pause an idle pose.
Do not translate measured millisecond EMG lead into an exact animation delay.

### R10. Tuula Rantala, 2D fighting-game animation thesis (2013)
Read abstract/contents and timing/overlap sections (chunks 0 and 2). Educational
thesis and secondary synthesis, not controlled biomechanics. Separates timing
from frame count and explains staggered body-part starts/stops.
[4](https://www.theseus.fi/bitstream/handle/10024/59254/Rantala_Tuula.pdf?sequence=1&isAllowed=y)

**Application:** recoil should travel through torso/shoulder/hand with staggered
settling, rather than all channels returning to neutral together. Qualify its
blanket opposite-direction anticipation statement: small player attacks need
subtle preparation, not an obvious reverse lean every time.

### Additional leads deliberately not treated as evidence
- Newer 2026 punch-sensor paper: abstract retrieved, but older primary study
  and review above provide a firmer, limited basis; no numerical calibration
  from it was used.
- Mocap vendors' broad timing guides and Reddit advice: useful leads, not
  grounds for fixed universal timing or force prescriptions.
- GitHub combat demos: inspected a README describing sword-contact forces + IK
  (Apolok99/ML-Agents-Fighting-Animations). Its demonstration video is hosted on
  user-images.githubusercontent.com, outside the terminal download allowlist.
  No claim of watching or reproducing it.
- No commercial game or anime episode was newly watched in this pass. GDC deck
  excerpts naming anime games do not count as watching those games' footage.

## 2. A real revision: classify attack opportunities, not just animations

### A. Initiators
Jab, compact first cut, short dash cut. Their job is quick readable contact and
position establishment. Tight startup; low target displacement; safe recovery
on hit, meaningful vulnerability on whiff. Don't give every initiator a long
cinematic load just to display more frames.

### B. Connectors
Cross, reverse diagonal, short hook. Their endpoint should prepare the next
move without obligatory return to idle. Use stance-specific incoming shoulder,
hip and blade orientation. A connector that knocks the enemy outside all
subsequent reach fails even if chain validation says “allowed.”

### C. Converters
Launcher, guard crush, counter, air chase. Change combat state, not just damage.
They need explicit ground→air/guard→stagger transitions, target eligibility and
resource/commitment costs. The launch must produce a reachable follow-up height.

### D. Extenders
Air cuts, optional dash bookmark, one bounce. Spend a finite extension budget.
A3's internal hits and Phantom echoes should count as one action for route
structure, while damage ticks remain individually accounted. Otherwise the
same animation can unpredictably exhaust or refill the entire juggle system.

### E. Enders
Heavy thrust, overhead finisher, palm blast, meteor. Deliberately create distance,
knockdown or landing recovery. An ender does not have to reconnect to light 1
for the system to feel fluid. Its visible aftermath is part of the reward.

### F. Defensive responses
Parry, retreat, evade, jump reset. Their purpose differs from the loaded release
leap. Use explicit defense eligibility/window rules. If bookmarking a combo,
allow one short retention window and invalidate on damage, stance change,
expiry, target recovery or a second bookmarked dodge.

**Proposed combinations:** initiator→connector→ender; initiator→launcher→air
connector→dive; successful counter→thrust; sweep→single conversion→ender;
loaded leap→air cut→landing catch. These are proposed route shapes, not existing
newly certified inputs. Their value is distinct decisions, not longer strings.

## 3. Quantitative check against our game

Added `scripts/research-combat-timing.ts` and generated `COMBAT_TIMING_STUDY.md`
plus JSON: 84 pair/context rows (7 pairs × 6 weapons × 2 stances). It is an
analytical screen, not a gameplay simulation.

For first contact at c, attack A cancel at k, next attack startup s, clip speed r:

`gap = (k + s - c)/r - nominalEnemyStun`

Positive gap indicates recovery may happen before the next contact. Negative
gap only permits a combo in timing; it says nothing about reach, travel or
opponent defenses. Compute both earliest and latest first-hit contact bounds.
Symmetric hitstop cancels from this simplified comparison; asymmetric freeze,
slow motion, simulation order and frame quantization require runtime tracing.

Selected estimates with the current katana speed 1.18:
- l1→l2: early-contact gap **+79.7ms**, late-contact gap **-22.0ms**.
- l2→l3: **+8.8ms** early versus **-92.9ms** late.
- l3→l4: **+90.5ms** early versus **-36.6ms** late.
- l4→l5: **+175.9ms** early; even late bound **+23.4ms**. A multi-hit l4's
  actual last hit and target spacing require runtime verification.

This corrects the implication that the neutral five-light string is necessarily
a five-hit true combo. It is currently a sequence grammar; different contact
frames and opponent state can change whether it links.

Gravity sensitivity, ideal ballistic -640 launch:
- g=1350 → apex ~151.7px at .474s.
- g=1900 → apex ~107.8px at .337s.
- g=3250 → apex ~63.0px at .197s.

Our non-drone launched enemy currently receives terms summing to 3250. Removing
the second term without retuning would more than double this idealized height
if 1350 remained. Therefore “fix duplicate gravity” must include a target apex,
airborne duration and reachable follow-up specification—not a blind deletion.
These figures are mathematical estimates, not measured enemy trajectories.

## 4. Revised physical direction by strike

| Action | Physical story | Motion policy | Reaction policy |
|---|---|---|---|
| Jab | Compact lead-side initiation, quick brace | Minimal COM travel; don't reuse heavy cross wind-up | Small directional stun, limited separation |
| Cross | Drive and rotation into contact, lead-side catch | More trunk/hip travel than jab; finite push | Torso rotation plus a controlled step, not full-body launch |
| Hook/elbow | Rotational impulse around support | Short pivot; shoulder follows pelvis with lag | Lateral fold/turn before translation |
| Sword diagonal | Chamber→accelerating edge path→follow | Whole core drives; preserve hand/grip endpoints | Cut-direction reaction, bounded push |
| Sword thrust/palm | Rear drive→extension→front catch | Carry incoming momentum within assist budget | Block arrests; clean hit permits through-motion |
| Uppercut/launcher | Compression→unload→vertical conversion | Explicit self-hop policy, negative-Y target impulse | One launch authority, reachable target height |
| Loaded flight cut | Planted charge→ballistic launch→strike | Preserve launch velocity; no second free jump impulse | Match swept path and airborne target envelope |
| Meteor/hammer | Downward commitment→impact absorption | Finite down drive; swept ground contact | One impact event; compression/recovery scales with normal speed |

Everything in this table is a proposal, informed by R1–R10. No paper validates
anime flight, damage amounts, fixed game frame counts or automatic hit tracking.
Keep support grounded until actual takeoff; use flight behavior only when collider
physics leaves the ground. Favor authored animation over unstable ragdolls.

## 5. Revised cancel/physics policy to prototype

1. **Quick light:** defense interrupt allowed in defined early window; offensive
   chaining primarily after contact opportunity. Test whether fast reactions
   remain legible when cancelled on the first eligible frame.
2. **Heavy/charge:** limited pre-contact exit or explicit feint; full defensive
   cancel only after commitment. No borrowed invulnerability while charging.
3. **Confirmed hit:** spend a bounded assist to preserve range and chain intent.
   **Whiff:** no assist, longer visible follow-through. **Block:** recoil and
   different pressure/stun rules. Do not make these three outcomes identical.
4. **Velocity:** integrate finite action impulses, preserving inherited velocity
   when compatible. Reversal spends impulse on braking first. Collision, not
   animation, owns wall stop and ground normal.
5. **Juggle:** single gravity owner + target action budget + repeat penalty.
   Start simple; do not combine strong time decay, gravity increase, hit-count
   penalty and damage scaling all at once and make the cause of failure opaque.
6. **Bookmark experiment:** only after clear cancel policy exists. One evasive
   reposition can retain sequence position; offensive charged leap should not
   silently grant the same defensive privilege.
7. **Hitstop:** configure who freezes and which clocks stop. No accumulation of
   motor work during freeze; input can still be captured. Multi-target hits must
   not stack endless freezes. Keep physics, animation, input and resource clocks
   explicitly named.

## 6. Next research experiments before implementation

- Instrument real attack events: input, chosen ID, cancel accepted/rejected,
  active-window crossing, contact, resolved outcome, enemy recovery and next
  contact. Trace game-time and input-time separately.
- Evaluate starter→connector pairs at near/mid/tip range against light, shield,
  heavy and boss. Log actual gap and miss reason, not only attack selection.
- Capture isolated jab/cross/hook/thrust/launcher/hit/block/whiff with effects
  disabled and both directions. Verify silhouette, weight shift, support change,
  contact and recovery without camera shake concealing problems.
- Test action-level versus raw-hit juggle budgets on a3 and Phantom sequences.
- Prototype force motor in an isolated light/thrust experiment before migrating
  every move. Compare travel/apex/landing at 30/60/120Hz.
- Obtain uploaded anime/action-game excerpts for actual frame-level choreography
  research; record clip time range and what was inspected. Do not substitute
  generated art, thumbnails or article descriptions for watched footage.

**Decision:** retain the previous code inventory as a factual baseline, but use
this research to replace its “physics first, more moves later” framing with
**combat role → cancel commitment → contact outcome → physical execution →
verified route**. More moves without those foundations would multiply ambiguity.
