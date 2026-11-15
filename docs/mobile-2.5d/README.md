# Stickman Rising — mobile-first cinematic 2.5D research

## Expanded all-engine plan

**[Read the mobile/2.5D overhaul plan](docs/mobile-2.5d/PLAN.md)**

- [Technical designs: equations, controls, costs and rejection criteria](docs/mobile-2.5d/TECHNIQUES.md)
- [Primary research and developer/forum discussions](docs/mobile-2.5d/RESEARCH.md)
- [Evidence, test failures and important limitations](docs/mobile-2.5d/EVIDENCE.md)
- [20 classified additional findings](docs/mobile-2.5d/FINDINGS.json)
- [Reproduce the source/core/browser checks](audit/README.md)

Coverage includes input/frame scheduling, movement/collision, combat, authored animation/IK, enemies/waves, particles/weather/lightning, lighting/shadows/reflections/water/clouds/parallax, audio, HUD/touch, startup and resource lifecycle.

The direction remains a **2D game with cinematic anime-inspired 2.5D depth**, optimized first for agreed low-end mobile web hardware. One improved warm inn, quiet parallel mountains, sparse trees/snow and sakura; **no background village**. Ten useful lighting behaviors do not require ten passes. Combat timing, held poses, pseudo-3D fighters, elemental weapons, dashes and survival waves remain protected contracts.

### What was checked

- Pinned game: `coders786/Stickman-Rising@c857433b57f4a1e9fe514fddd5f190be60eed8c8`.
- **376 hash-pinned text references**, not a complete imported application.
- Supported Node 22.14.0 game-core suite: **215 tests, 207 pass, 8 assertion failures**. Same totals on Node20; failures are classified, not all labeled production bugs.
- Actual `Game` Canvas browser smoke at landscape/portrait sizes: no captured runtime errors; confirmed input-edge loss, missing recycled particles and mixed catch-up timing.
- Limited reference-model checks for command ownership, sequential AI summaries, stable order and same-kernel local bloom.

**This is a planning/evidence change, not implemented runtime optimization, a full Next build, or a phone-FPS claim.** The browser harness uses manual time and software rendering; its screenshots depict the existing game core. Real-device input, memory, GPU and 20-minute thermal evidence remain required.

No remote commit/push was made. Follow M0 in the plan before importing/building the production game. Do not ship research tools or evidence as runtime assets.

## Predecessor graphics audit

- [Original graphics/cache/art plan](docs/graphics-optimization/PLAN.md)
- [Original seven technique experiments](docs/graphics-optimization/EXPERIMENTS.md)
- [Earlier 20 findings](docs/graphics-optimization/FINDINGS.json)
- [318-file source manifest](docs/graphics-optimization/SOURCE-MANIFEST.json)
- [58 additional QA references](docs/graphics-optimization/MOBILE-SOURCE-MANIFEST.json)

The expanded mobile plan takes precedence for scope, budgets and evidence status. Historical standalone scene renderers and experiments remain under `work/`; the game's current Canvas Sakura reinterpretation and archived WebGL scene are not the same runtime. No complete standalone mountain revision or inline runtime-source port is included in this planning change.
