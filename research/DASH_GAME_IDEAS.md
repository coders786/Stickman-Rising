# Stickman Rising: research-backed ideas for a better 2D dash game

Research date: 2026-11-09. This is a curated, non-exhaustive survey—not a review of the entire internet. External examples are inspirations, while the proposed mechanics and numbers below are new ideas to prototype, not claims about the cited games.

## Starting point

Stickman Rising is already a wave-survival combat game with a custom canvas engine, ten context-selected dash variants, momentum physics, light/heavy attacks, parries, a sheathed stance, six swords, and a boss every fifth wave. It already has input buffering, camera shake controls and touch input. The opportunity is not to add more buttons for their own sake: **make dash decisions legible, rewarding and tactically varied.**

## What other designs suggest

- **Forgiveness can preserve challenge.** Celeste creator Maddy Thorson describes input buffering, coyote time and small positional corrections as ways to favor player intent. Apply the principle only where it fits this arena game; it does not currently need platform-specific coyote time everywhere. [1](https://threadreaderapp.com/thread/1238338574220546049.html)
- **Combat feels fair when the question is readable.** Enemy telegraphs communicate what is about to happen, using motion, sound and effects; Into the Breach's designers describe clear enemy intentions as the basis for tactical puzzles. [1](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing) [2](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- **Builds are most interesting when mechanics combine.** Hades dash-related boons can interact with other effects, encouraging runs with distinct strategies rather than just bigger numbers. [1](https://www.digitaltrends.com/gaming/hades-best-builds/)
- **Practice and instant retries support mastery.** Katana ZERO uses short encounters and fast retries; that suggests an optional challenge mode, not turning the existing survival mode into a one-hit-death game. [3](https://katana-zero-aqd.en.softonic.com/)
- **Juice should communicate mechanics, not bury them.** Animation and sound can emphasize physical properties and impact; prioritize action clarity before adding effects. [2](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient)
- **Accessibility is broader than difficulty.** The Game Accessibility Guidelines recommend remapping, alternatives to repeated inputs and holds, and sizable touch targets. [1](https://gameaccessibilityguidelines.com/full-list/) W3C-style flash guidance is particularly relevant to the game's storm and impact effects; test actual combined output rather than assuming individual effects are safe. [1](https://www.thewcag.com/criteria/2.3.1)

## Priority 0 — make the existing dash understandable

1. **Dash laboratory.** Add a safe training room with a reset button, stationary and attacking dummies, and selectable enemy types. Show dash direction, variant, cooldown, attack cancel and invulnerability windows in a simple optional overlay. Include a short guided sequence: move → dash through a threat → dash-attack → parry → draw sword. This exposes existing depth without changing the core balance. A practice room is a better place for exact frame data than the normal HUD.
2. **Intent-aware buffering.** Audit existing input buffering around dash → attack, dash → jump and landing → jump. Prototype a short, tunable buffer (start testing at 80–120 ms) without extending invulnerability or permitting an extra attack. Buffer only the latest compatible action; clear on pause, focus loss and death. Test at 30, 60 and 120 Hz. Hades' own patch notes illustrate that dash-attack buffering is an iterative design concern. [2](https://www.supergiantgames.com/blog/8/)
3. **Readability budget.** Make enemy windups visible above rain, trails and lightning; use shape and sound as well as color. Test off-screen projectile warnings and a minimum visible spawn cue before an enemy can attack. Existing enemies already have windups and attack-token behavior, so improve their clarity before multiplying enemy count.
4. **Comfort and touch controls.** Add remappable keyboard/gamepad controls; move/resize touch buttons; offer a dedicated sprint control as an alternative to double tapping; add hold/toggle options. Provide separately adjustable rain, screen flashes, lightning, hitstop and camera motion while retaining clear threat cues. Test rapid combinations of flashes, not just individual effects. Support a slower assist mode as an optional setting; decide explicitly how assist runs are represented on scoreboards.

## Priority 1 — add a tactical dash identity

5. **Perfect evade → counter window.** A near-miss during the existing invulnerability period grants a short, clearly signaled counter opportunity. Prototype: next attack within 0.6 seconds gains a small stagger bonus, not guaranteed immunity or a free kill. Once per enemy attack, with an internal cooldown; reward deliberate risk without encouraging perpetual invulnerability.
6. **Dash strike choices.** Use existing dash and attack inputs: light during a valid dash window becomes a quick through-cut; heavy becomes a slower guard-breaking shoulder or rising cut. Preserve momentum and make cancel and damage windows visible in training. Don't silently replace other actions or remove the sheathed/unarmed variants.
7. **Wall rebound with a cost.** An optional directional follow-up after dashing into an arena wall converts some incoming momentum into a return leap. Require a deliberate press, preserve the current wall-stop as the default, cap velocity, and avoid trapping or auto-reversing the player. The feature should create a tactical escape, not change every collision.
8. **Precision lane / danger corridor.** Briefly telegraph a horizontal or vertical boss attack, leaving at least one plausible escape route. Dashing across at the right time opens a weak point. Test whether the silhouette reads at low quality and without color; do not require precise dash chains for the main survival mode.
9. **Adaptive audio, not audio dependence.** Give launch, evade, guard break and confirmed hit distinct sounds, with a small musical layer that responds to action intensity. Every gameplay cue must also have a visual equivalent, and music/effects remain independently adjustable.

## Priority 2 — make runs replayable

10. **Three-choice wave rewards.** During selected intermissions, pause combat and let the player choose one of three upgrades with clear numbers. Start with a small pool: *Slipstream* (dash exit carries more momentum), *Echo Edge* (a delayed, weaker slash after a dash-attack) and *Grounding* (perfect evade briefly restores energy). These are proposed effects: tune through playtests, avoid making a single choice mandatory, and ensure all offers are useful to sheathed players too.
11. **Sword-specific interactions.** Add one meaningful dash modifier per existing sword, not merely a recolored trail. Examples: Inferno leaves a short-lived hazard, Thunder chains a small hit to a nearby enemy, Void trades recovery for repositioning, Gravity pulls foes slightly, Phantom repeats a delayed low-damage strike, Katana favors precision counters. Place hard caps on chain effects and test readability and performance with many enemies.
12. **Hand-authored wave templates.** Build reusable scenarios—pincer, protect-the-center, ranged crossfire and heavy-plus-escort—then vary order and spawn positions under fairness rules. Current `WaveDirector` already has an enemy budget, staggered spawns and boss intervals; extend it rather than replacing the game with a procedural platformer. Leave breathing room and avoid spawning threats on top of the player.
13. **Boss teaches a dash skill.** Give the fifth-wave boss one clearly telegraphed sweep that invites a cross-through evade, followed by an attack that punishes repeated blind dashes. Keep a valid non-dash response. Later boss phases can combine previously learned patterns, not introduce multiple unreadable new rules at once.
14. **Optional short-form challenges.** Add a separate 30–60-second dojo trial with instant retry, a fixed seed and a clear objective such as “land five counters without taking damage.” Keep rewards cosmetic or practice-oriented until timing and accessibility are validated. Show personal records separately from normal survival results.
15. **Post-run coaching.** Report a few actionable facts: damage taken by source, successful parries, dash evades and longest combo. Offer a “practice this enemy” shortcut. Do not label players' play styles as mistakes or send telemetry without consent.

## Experiments and acceptance criteria

| Experiment | Prototype | Pass criteria to validate with players |
|---|---|---|
| Dash clarity | Training overlay and one tutorial | New players can describe when dash protects them and reliably demonstrate a dash-attack without reading code. |
| Telegraphs | One gunner and one heavy cue | Players can identify the source and type of attack with effects low, muted and in crowded scenes. |
| Perfect evade | Counter window with bounded reward | Players recognize why it triggered; repeated dashes do not yield permanent protection. |
| Rewards | Three upgrades, then one additional combination | Players can explain the trade-off and select at least two distinct viable builds over several runs. |
| Performance | Fixed stress scenarios with weather, effects and mixed enemies | Record frame times and input responsiveness on target desktop and touch hardware; compare against a baseline before setting release targets. |
| Accessibility | Remapping, touch sizing and reduced-motion prototype | Verify all essential actions, menus and cues with keyboard, gamepad and touch, including effects and sound disabled. |

Suggested playtest approach: observe 5–8 people across novice and experienced groups, record where intent and outcome differ, and ask what they believed happened before explaining the mechanics. This sample is useful for finding problems, not for proving statistical success.

## Implementation map

- Dash timing, variants and momentum: `src/game/combat/dash.ts`, `src/game/physics/dash-body.ts`, `src/game/entities/player.ts`.
- Input and remapping: `src/game/core/input.ts`; touch and menu UI: `src/app/page.tsx`.
- Enemies, cue timing and wave composition: `src/game/entities/enemy.ts`, `src/game/world/waves.ts`.
- Feedback, audio and accessibility settings: `src/game/fx/`, `src/game/audio/`, `src/game/render/`, `src/game/core/types.ts`, `src/lib/persistence.ts`.
- Regression coverage: extend `tests/input.test.ts`, `tests/dash-physics.test.ts`, `tests/hit-resolution.test.ts` and browser/animation harnesses before tuning defaults.

## Recommended first milestone

Build **the dash laboratory + readable enemy cues + optional reduced effects** first. Then prototype perfect evade in isolation, measure whether it actually improves decision-making, and only afterward add one sword interaction and one wave reward. This keeps the existing game's identity intact while creating a testable foundation for bigger additions.
