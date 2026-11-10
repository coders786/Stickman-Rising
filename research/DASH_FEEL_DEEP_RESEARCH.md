# Dash feel: deep research and design directions for Stickman Rising

Research date: 2026-11-09
Status: research and proposals, **not implemented changes**.

## Scope and evidence

This is a curated survey of public Reddit discussions, game-development forums, developers' own notes, animation articles and accessibility guidance. It cannot cover every forum or every post on the internet. Reddit comments are individual experiences and opinions, not representative surveys or measurements; where players disagree, both sides are useful. Source-linked facts below are separated from recommendations. Numbers in the prototype sections are **starting hypotheses**, not verified best settings or current-game measurements.

## Executive conclusion

The most appealing dash is not necessarily the one with the most effects. It is the one where players can **predict the outcome, feel an immediate response, see their trajectory, understand when they are safe and recover control**, then learn to use the same movement creatively. A special charged dash can have visible anticipation, but a defensive dash should not accidentally inherit a long mandatory wind-up.

For this project, the best creative direction is **Shadow Ronin: grounded preparation, a sharp low silhouette, a physical thrust, a sparse ink-black wake, and a controlled landing**. The blade and effects can carry elemental color; the character's established black silhouette remains intact. This should feel powerful without resembling a new character or a particle explosion.

## 1. What players and developers actually say

### Input and timing

- In a Reddit thread about dash implementation, one commenter argues for a dedicated dash key because double taps can introduce accidental input and execution delay. Another recommends recording press/release events instead of sampling only per-frame key state. Those are useful design suggestions, not proof that one input fits everyone. [1](https://www.reddit.com/r/gamedev/comments/qgm0xs/how_would_you_go_about_a_dash_ability/)
- A fighting-game design discussion recommends input buffering across cancel windows, while another commenter warns that excessive buffering can trigger unintended actions. The lesson is to **buffer deliberately and consume once**, rather than make every action queue indefinitely. [3](https://www.reddit.com/r/gamedesign/comments/17l9ocd/tricks_to_make_fighting_games_motion_inputs_feel/)
- A Dead Cells discussion praises recovery cancels, but another older thread reports frustration when perceived roll-cancels became queued until an attack completed. Treat these as player reports about particular versions, not verified claims about the game's current behavior. The applicable lesson: a late automatic action can feel worse than an explicitly rejected input if it fires after danger has passed. [3](https://www.reddit.com/r/deadcells/comments/14kxls0/what_exactly_is_it_about_dead_cells_combat_that/) [1](https://www.reddit.com/r/deadcells/comments/a9kcr4/11_update_known_issues_look_here_before_posting/)
- Celeste community explanations show that a buffered jump, landing and dash-reset timing can interact in subtle ways. Other players describe situations where early buffering interferes with advanced movement. Do not assume “more buffering” always feels better: define event ordering and test it. [2](https://www.reddit.com/r/celestegame/comments/11kj251/how_do_you_do_wavedash_have_a_better_way_keyboard/) [4](https://www.reddit.com/r/celestegame/comments/18gn6ut/how_do_you_do_an_ultradash/)

### Chain-dash lessons, including disagreement

- In Hyper Light Drifter discussions, some players praise the satisfaction of learning a dash rhythm; others report difficulty noticing the correct timing, particularly during the opening beats. A commenter identifies a visual flash, while another says the audio helped them. The disagreement is valuable: a cue may exist yet still be too subtle or easy to miss for some players. [1](https://www.reddit.com/r/hyperlightdrifter/comments/fpybz2/chain_dash_cheese_on_switch_for_a_certain_section/) [4](https://www.reddit.com/r/hyperlightdrifter/comments/a0z6qm/any_advice_for_multidashing/)
- Another thread argues over whether tight chaining is a good skill test or needlessly opaque. A separate beginner reports not understanding why dashes sometimes failed; commenters point to cooldown and stamina. These are anecdotal reports, not reliable frame measurements. Make readiness and failure reasons observable, and reserve demanding rhythm tests for optional challenges. [2](https://www.reddit.com/r/hyperlightdrifter/comments/tepa0s/dash_champion/) [7](https://www.reddit.com/r/hyperlightdrifter/comments/ewhe1b/newbie_here_this_game_is_frustrating/)
- For short cooldowns, a developer discussion suggests the key information may be **the instant readiness returns**, rather than a permanent large countdown. For longer or variable restrictions, a visible resource/charge can matter more. These are opinions to test with our players. [8](https://www.reddit.com/r/gamedev/comments/1g4xl9h/how_important_is_it_for_you_to_see_the_dash/)

### Anticipation versus responsiveness

- Game-animation writers show a practical compromise: the character's physical action can begin immediately while parts of the pose visually squash or lag for a moment. The apparent preparation occurs *during* movement instead of blocking it. [1](https://www.gamedeveloper.com/design/5-tips-to-make-your-game-animations-better) [2](https://www.gamedeveloper.com/game-platforms/12-principles-for-game-animation)
- A Reddit animation discussion similarly distinguishes a reactive player action from a deliberately committed charge, and notes that intentional wind-up can be appropriate in some games. Recommendation: **instant tap defense, intentional hold-to-charge as a separate choice** is an experiment, not a rule that every action must be instantaneous. [3](https://www.reddit.com/r/gamedev/comments/fjgrw9/principles_of_animation_anticipation_tutorial/)
- Antegods' designer describes separately tuning dash duration, speed, cooldown and terrain interaction. A shorter burst can keep speed while reducing travel distance; terrain friction can alter impact without changing open-space speed. These parameters should be evaluated independently instead of using “speed” as a single feel knob. [10](https://www.gamedeveloper.com/design/antegods-design-update-tweaking-dash-gameplay)

### Juice and speed cues

- In a fast-dash prototype discussion, the creator says they tuned movement first, then added sound, score feedback and shake. The same creator reports strong parallax made some testers motion sick, while a commenter suggested a small camera catch-up delay. Both are reasons to A/B test modest camera changes, not mandate a large zoom or screen shake. [2](https://www.reddit.com/r/gamedev/comments/hk8y24/sharing_my_experience_with_a_fastpaced_dashing/)
- Developers discussing the sensation of speed suggest streaks, moving environmental reference points, audio and camera effects; some also warn that motion effects can be uncomfortable. For this 2D game, prioritize **world-relative rooftop cues, foot contact and a short silhouette trail** before simulated lens effects. [1](https://www.reddit.com/r/gamedev/comments/915uvx/how_can_a_game_give_the_player_a_sense_of_speed/) [9](https://gamedev.net/forums/topic/552271-giving-a-feel-of-speed-in-the-game/4551854/)
- A game animation post describes smear drawings and multiples as ways to bridge a very fast pose change. That does not require distorting the physical collider or making the whole game run at a lower frame rate. [1](https://metagames.studio/dev-blog) [3](https://www.polygon.com/videos/22394042/smears-animation-cuphead-overwatch-sonic/)
- A Godot discussion recommends world-positioned, individually controlled pooled trail sprites for modular characters; another identifies stale particles as a source of incorrectly positioned ghost trails. Our engine uses canvas rather than Godot, but the transferable principle is **snapshot the visible pose in world space and manage its lifetime explicitly**. [2](https://forum.godotengine.org/t/gpuparticles2d-with-global-position-and-local-rotation/111926) [4](https://forum.godotengine.org/t/need-help-understanding-why-particle2d-trail-is-spawning-particles-in-unexpected-location/18825)
- In a combat feedback thread, commenters emphasize prompt target reaction and synced audio; another thread discusses using hitstop selectively and avoiding excessive shake. Their proposed durations vary widely, so treat them as creative feedback, not universal values. [1](https://www.reddit.com/r/gamedev/comments/1iz2dxy/my_combat_system_feels_lifelesshow_can_i_make_it/) [5](https://www.reddit.com/r/gamedev/comments/1emc3cn/how_can_i_make_my_attacks_more_impactful/)

## 2. Existing implementation: what to preserve and investigate

These are code observations, not new user-tested findings:

- `src/game/combat/dash.ts` already selects among ten context-sensitive variants, including pivot, carry, hunt, pierce, retreat, carve and air. `DashBody` uses finite forces, drag, phase boundaries and a momentum-preserving handoff. Do not replace it with an unconditional velocity teleport just to add juice.
- In `src/game/entities/player.ts`, a **grounded forward dash press enters `dashLoad` and launches on release**; longer holds can produce a ballistic leap. Air, vertical, backward and qualifying reversal requests can start immediately. The load damps incoming horizontal speed. This is a deliberate charge mechanic but may feel delayed for players expecting a tap-on-press dodge. The old `research/HELD_SKIM_DASH.md` description is historical and does not match the current release-to-launch path.
- `updateDash` triggers the main propulsion cue only after the force phase and a real speed/direction threshold. That correctly avoids a false forward burst during a pivot. On a forward ground press, however, a player waits through the hold/release and subsequent propulsion timing for that cue; a distinct *quiet press acknowledgment* could help without falsely depicting travel.
- There are already three progress-based shadow ghosts, motion lines, ground dust, streaks, audio, chromatic effects and trauma shake. `Camera.focus` also uses velocity look-ahead and camera smoothing. The normal light/heavy dash attacks and a short post-dash light conversion already exist. New work should improve or selectively tune these systems rather than duplicate them.
- **Protection semantics require verification before visualizing them.** `startDash` sets a variant-specific dodge window, and `updateDash` grants it at drive; however, `Player.takeDamage` also rejects damage for the entire `state === 'dash'`. Therefore a UI showing only the `iframes` timer as the full effective protection window could mislead. Audit all damage paths and decide the intended rule before promising precise dodge cues or changing balance.
- Some comments about ghost beat timing differ from actual constants in the file. Use executable behavior and measurements, not historical comments, as the baseline.

## 3. Proposed dash experience: five perceptual beats

This is a presentation concept that can sit on the current engine. Timing ranges are *experimental starting points* and must not be confused with current values.

### A. Ready: build anticipation before the button is pressed

- A subtle stance/footweight change may reflect velocity, threat and facing. A small nearby readiness marker may appear only when cooldown meaningfully blocks a dash, or on an attempted dash during cooldown.
- Show readiness using shape/opacity and optionally a quiet audio cue—not color or sound alone. A ready indicator should not flicker constantly during high-frequency chains.
- When a dash request is unavailable, acknowledge it subtly and consistently; do not play a full propulsion sound or a fake trail.

### B. Intent: immediate input acknowledgment

- On press, make a **small silhouette change, foot-pressure mark or low-volume cloth/metal cue** visible/audible promptly, including when the action is charging. Keep this distinct from the actual propulsion event.
- For an immediate-dodge prototype, begin meaningful travel on the first simulation step and let a compressed torso / trailing garment suggest the preload *while the body is already moving*. Compare with the existing hold-release design; never silently change charge semantics or protection.
- For the deliberate hold-to-leap, expose charge progress with a grounded silhouette and a stable ring/bar; release commits the leap. A tap/hold toggle or separate binding must remain possible for players who cannot comfortably hold.

### C. Drive: physical force made visible

- Keep the head/torso directional and one clear supporting-leg thrust. Aim for a strong silhouette at normal gameplay scale, not just an attractive zoomed-in sprite sheet.
- At actual propulsion, fire one concise foot-contact burst and one short directional stroke. Give each an origin that matches real contact and velocity. For airborne dashes omit ground dust; for pivots wait until travel turns toward the selected direction.
- Test a single short-lived smear/ink wedge **behind the body** at peak motion. Do not move hitboxes, sword endpoints or enemy positions to match a visual smear.
- Use the existing three ghost captures as a baseline. Compare progress-timed vs distance-timed placement; time sampling communicates rhythm, distance sampling can keep visual spacing stable as speed varies. Use actual snapshots, pool them and clear on reset. No additional ghost is automatically better.

### D. Contact or exit: the payoff depends on what occurred

- **Clean dash:** a soft catch/plant and recovery cue; no generic hit flash.
- **Dash attack connects:** the target reacts promptly, with a directional sound and restrained spark; hitstop belongs to the confirmed hit, not every dash. Blocked, guarded and invulnerable contacts need distinct feedback and must not count as confirmed damage.
- **Wall:** resolve physics first, then show a foot brace or directional skid; avoid a forward-moving effect after momentum is absorbed.
- **Grounded landing after charged leap:** one contact/ripple or dust mark based on actual landing velocity, then recover. Don't emit on an airborne near miss.
- **Optional near-miss:** only after reliable threat-overlap detection exists, trial a restrained ring/sound for a successful dodge; one reward per distinct threat and no change in protection duration.

### E. Ready again: reward mastery without a metronome

- A small visual tick could mark when the next dash becomes available. Chain count can influence the *style* (e.g., mirrored pose or softer pitch variation) without making the main loop depend on a narrowly timed rhythm.
- Never make the readiness cue only a rapid flash or a high-frequency sound. Provide an optional practice overlay with a labeled timeline for exact windows.

## 4. Distinctive ideas to prototype

| Idea | Why a player may want it | Important constraint |
|---|---|---|
| **Ink-cut dash** | A brief black tapered slash in the wake makes the Shadow Ronin silhouette read as a deliberate cut through space. | Separate from live actor and enemy tells; no opaque screen-covering panel. |
| **Footprint ripple** | A tiny rooftop contact ring or short skid sells traction and rain-soaked ground. | Emit only on confirmed contact, and disappear cleanly at walls. |
| **Perfect evade → return strike** | A visible near-miss followed by a fast counter creates a skill story rather than movement for its own sake. | Require a genuine incoming threat; cap rewards; retain non-dash defenses. |
| **Dash-through vulnerability** | Crossing behind a shield enemy creates a positional opportunity instead of merely dealing more damage. | Should not turn every enemy or boss into a free target. |
| **Charge release leap** | The existing hold/release can become an expressive, voluntary power move. | Teach the distinction clearly; allow cancellation and alternate hold accessibility. |
| **Elemental punctuation** | Each sword's existing dash-attack gets a distinct small wake shape: ember flecks, lightning zigzag, void crease, gravity compression or phantom echo. | Effects are legible in monochrome and optional/reduced; avoid damage changes until separately balanced. |
| **Echo practice mode** | Record a recent dash path as a faint replay in the dojo, enabling route comparison. | Local-only optional practice; clear reset and no ghost overlay in normal combat. |
| **Boss sweep challenge** | A readable sweep gives a reason to dash *through* danger, then counter. | One safe alternative remains; its telegraph must survive low VFX and no audio. |
| **Dash lab with slow playback** | Players can see input, dash state, actual protection and cancel timings. | Diagnostic labels must reflect real damage behavior, not just one timer. |

## 5. Prototype / visual specification (first slice)

**Goal:** make one ordinary grounded dash more legible and compelling without rewriting the entire movement controller.

1. Capture a baseline first: standing, running, sprinting, reversal, air, wall, charged leap and dash-to-light/heavy. Record button-down, button-up, first meaningful displacement, first visible pose, sound, active protection and exit. The current forward release-to-launch design means press-to-displacement and release-to-displacement must be reported separately.
2. Create three variants under a debug-only switch: **A** current; **B** current mechanics + immediate quiet input cue; **C** experimental immediate tap/alternative charge control. Keep A as a rollback. Variant C is a gameplay change requiring explicit user/design approval before becoming default.
3. Give B a contact-driven wake and one optional directional smear, but keep the same speed, force, duration, dash variants, cancel windows and damage rules as A. Compare A and B with effects disabled as well as normal.
4. Test at **30, 60 and 120 Hz** plus throttled browser frames. Candidate starting values—not targets or rules—might be: one 20–50 ms contact accent, three existing ghosts, and a short 0.1–0.2 s trail fade. Test actual readability; don't assume that an effect lasting one simulated frame appears on every display.
5. Test separately: closed space/wall, both directions, enemies on either side, airborne, held charge, sheathed/drawn, rapid repeats, blur/pause, reduced effects, muted audio, and a busy boss wave.

### Visual hierarchy

1. Player's current opaque silhouette and hands/blade.
2. Enemy, telegraph and projectile.
3. Trajectory and contact.
4. Decorative rain, wake and ambient particles.

Ghosts should be behind the live character, constrained in count and alpha, and never make the dangerous attack harder to see. A glow or wake should not imply collision size or protection if it does not match mechanics.

### Audio hierarchy

- **Press:** quiet tactile acknowledgement if needed.
- **Real thrust:** short whoosh/scrape, synced to actual drive.
- **Confirmed hit:** distinct contact layer, separate from whiff and blocked hits.
- **Ready:** optional understated cue only when informative.

Use bounded variation and avoid a loud sound for every repeated dash. With audio muted, all important state still needs a visible or tactile alternative.

### Camera

The current camera already smooths toward a velocity-based look-ahead; measure it before adding another effect. If tested, use a bounded directional offset and a gradual return rather than repeated random jolts. Compare fixed camera, current camera and modest alternative in the same encounter. Keep the player and incoming threats visible and respect the existing shake setting; add separate reduced-motion options before enabling additional zoom/parallax.

## 6. Fairness, accessibility and risk

- **Protect the input contract.** A dash press must not be silently lost, unexpectedly execute much later, or fire when focus/pause resets held input. Visuals cannot repair a broken action state.
- **Make protection truthful.** Test actual hits at startup, drive, catch, cancel, airborne and wall. Decide whether full-state immunity is intentional before changing it; preserve compatibility until the game design is chosen.
- **Motion sensitivity and flashing:** offer independent controls for shake, camera motion, blur/chroma, trail density, lightning and impact flashes. W3C's flash criterion has specific thresholds and counts combined flashes; test recorded worst cases with an appropriate analysis tool, rather than claiming safety from a single dim effect. [1](https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html)
- **Motor access:** remap keys/gamepad, resize/move touch controls, and provide alternatives to repeated taps and long holds. Avoid making rhythmic chaining necessary for core progression. [2](https://gameaccessibilityguidelines.com/avoid-repeated-inputs-button-mashing-quick-time-events/) [5](https://gameaccessibilityguidelines.com/basic/)
- **Performance:** fixed caps, pooling, no per-frame unbounded allocations, and a deterministic test scenario with full weather/enemies. Compare frame-time percentiles and input latency against the baseline on target hardware. Do not claim a frame-rate improvement without measurements.

## 7. Playtest questions and decision gates

Ask players to perform a dash before explaining the feature. Record their input, not just their final score.

1. “When did the character begin responding?” Measure button-down → visible feedback, button-up → movement for release-based dashes, and button-down → movement separately. Use repeated trials; frame captures provide lower-bound estimates, not hardware-independent latency.
2. “When did you think you were protected?” Compare their answer to the actual `takeDamage` behavior and enemy hit events.
3. “Why didn't that dash happen?” Test cooldown, air-dash use, cancellation and focus loss. Count understandable vs mysterious failures.
4. “Where did you expect to end up?” Compare predicted and actual landing positions, including walls, reversals and charged leaps.
5. “Which version makes you want to dash again?” Blind-compare A/B/C in both empty and crowded scenes. Ask for reasons, including comfort and clarity.
6. Compare new and experienced players across keyboard, gamepad if implemented, and touch. A small qualitative study can uncover usability issues; it does not establish population-wide preferences.

**Ship gate:** no regression in input, dash distance, momentum, wall collision, hitbox alignment, cancel timing or accessible settings for a presentation-only pass; ensure gameplay changes have independent approval and regression tests.

## 8. Repository handoff

- `src/game/entities/player.ts`: request/load/launch, actual gameplay state, sound and ghost scheduling.
- `src/game/physics/dash-body.ts`, `src/game/combat/dash.ts`: force phases and variant tuning.
- `src/game/anim/clips.ts`, `src/game/anim/grounded-dash.ts`, `src/game/anim/animator.ts`: authored silhouette and pose transitions.
- `src/game/fx/fx.ts`, `src/game/render/renderer.ts`: bounded ghosts, streaks, layering and contact effects.
- `src/game/core/camera.ts`, `src/game/audio/audio.ts`, `src/game/core/types.ts`, `src/app/page.tsx`: camera/audio/comfort controls and player-facing UI.
- `tests/dash-physics.test.ts`, `tests/grounded-dash.test.ts`, `tests/input.test.ts`, `tests/hit-resolution.test.ts` and `.qa/player-motor-browser.mjs`: start with regressions, then visual and real-device studies.

## Recommended next action

Prototype **B: unchanged movement + immediate input acknowledgment + clearer actual-propulsion/contact cues** behind a debug flag. Before drawing an invulnerability indicator, test and resolve the difference between the configured timer and full dash-state immunity. If players still dislike the delayed ground response, present A vs C as a deliberate design choice rather than replacing the current charged leap by assumption.
