# 24 · Engine decision — Phaser, or the engine we have

**Trigger.** After the `InvalidStateError` crash (O-13) the ask was: *"kill all
hydration bugs for good and for all using Phaser.js"*, followed by *"if it's worth
changing the engine then change"*.

**Decision: do not migrate.** The engine stays Canvas2D; the crash is fixed at the
root and the class is closed by a gate rule. The rest of this page is the evidence
that made that the honest answer rather than the lazy one — with the numbers, and
with the conditions that would flip it.

---

## 1 · What the bug actually was

```
InvalidStateError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
The image argument is a canvas element with a width or height of 0.
  src/game/world/background.ts (1601:52)
  SkyVaultCache.draw      src/game/render/bhst.ts (137:7)
  CyberBackground.drawSky src/game/world/background.ts (1498:19)
  Renderer.draw           src/game/render/renderer.ts (102:8)
  Game.frame              src/game/game.ts (865:21)
```

That stack is a **live render frame**, ~N seconds after mount. Hydration had
finished long before. Nothing in the trace touches React, the server tree, or the
first client render.

The bug was a **surface lifetime** bug: one canvas acquired unpinned from the
ledger, evicted by an LRU sweep under bake pressure, then blitted. Fix and repro:
`22-BUG-BOUNTY.md` O-13.

**Phaser does not remove this hazard.** Phaser's `TextureManager` has exactly the
same ownership question: destroy or `remove()` a texture that a GameObject still
references and you get a thrown error or a blank sprite — the difference is that
Phaser's texture manager also caches canvas textures by source key, so the failure
is *harder* to trace, not easier. Swapping a renderer never fixes a lifetime bug;
inventorying the lifetimes does. That inventory is what `canvasLedger` is, and it
is why the fix is four layers deep (pin · `hasPixels` · gate rule · resilient
loop).

---

## 2 · What would have to be re-implemented

Measured at HEAD `5fd8b25`:

| Subsystem | Files | LOC | What it is | Phaser equivalent |
|---|---:|---:|---|---|
| `entities/` | 3 | 7,092 | procedural stickman rig — IK-free joint rig, 40+ authored poses, silhouettes, per-limb stroke | **none** (Phaser has no skeletal rig; you'd draw Graphics per bone and rebuild the pose table) |
| `combat/` | 15 | 6,782 | move tables, hit geometry, cancel windows, tiered swords, O-01…O-05 invariants | **none** (Phaser has no combat model) |
| `anim/` | 24 | 6,537 | clip system, beats, easing, joint continuity (ζ ≥ 0.2), blend curves | partial (`Tweens` covers a fraction; beat gating and continuity checks are ours) |
| `world/` | 13 | 6,666 | baked parallax city, weather, lighting, shadows, props, sky vault | partial (`TileSprite`/`Parallax` exist; every bake here is custom) |
| `fx/` | 3 | 2,417 | particle rigs, flash plates, hit sparks | partial (Phaser's `ParticleEmitter` is real, but our emitters are 1-D SoA buffers with tests) |
| `render/` | 10 | 2,062 | renderer, ledger, shadows, HUD, quality ladder, graphics tiers | **none** (Phaser's `ScaleManager`/`Pipeline` do not compute our tiers) |
| `audio/` | 1 | 894 | WebAudio synth + music, no assets | partial (`Sound` needs assets; ours is synthesised) |
| `debug/` | 2 | 1,635 | overlays, profiler, ledger readout | **none** |
| `core/` | 5 | 754 | determinism, RNG, fixed-step, utils | **none** (Phaser's loop is not our fixed step) |
| `physics/` | 3 | 181 | deliberate 2-D resolve for a fighter on a line | would be an *Arcade Physics* rewrite with different semantics |
| `gpu/` | 2 | 654 | sky/Oklab colour, no uniforms | **none** |
| **total** | **81** | **37,353** | | |

Plus **55 test files / 5,787 LOC**, and the suite's central property: it imports
engine modules **headlessly in Node** (`node --import tsx --test`) and runs the
deterministic sim with no DOM, no canvas, no rAF. 357 assertions today.

A Phaser migration invalidates that harness. Phaser needs a WebGL/canvas context
(or its `HEADLESS` renderer), a `Game` instance, and an **async scene lifecycle**
(`preload → create → update`). Every one of those tests currently calls a pure
function or a stepped sim frame; after a migration most of them would need a live
`Game` per test file, and timing-sensitive assertions would move from *deterministic
step* to *frame callback*. That is not a refactor, it is losing the ability to test
the game.

---

## 3 · The bundle math

Measured, not estimated:

| | Raw | Gzip |
|---|---:|---:|
| Current production client JS (13 chunks, `npm run build:iso`) | **1.42 MB** | **433 KB** |
| `phaser@4.2.1` `dist/phaser.min.js` | **1.38 MB** | **355 KB** |

Adding Phaser ≈ **+82 %** compressed client JS **before** one line of game code is
re-implemented — and the re-implementation adds more on top (our engine's own code
is the 1.42 MB we already ship). This project's standing brief is mobile-first with
an explicit "never promise 120 fps on mobile" honesty rule; nearly doubling the
download to arrive at a *worse-tested* game is not a trade, it is a regression.

---

## 4 · What Phaser would genuinely give us

Said plainly, because a decision doc that only argues one side is marketing:

- **WebGL batching by default.** Our renderer is Canvas2D with additive passes; on
  a big ULTRA frame the fill budget is the ceiling (see `23-LIGHT-AND-SHADOW.md`,
  10 fills per fighter + 2 blits per prop). Phaser would move that to GPU quads.
- **A maintained input/scale/sound layer** instead of ours.
- **A shader pipeline** — the honest route to real bloom, and the one thing our
  Canvas2D lighting cannot do (documented as open item 23-A).
- **Fewer bespoke subsystems to keep alive.**

Those are real. They are also **all achievable without a rewrite** at the points
where they actually matter: the lighting is the only system that wants shaders, and
it is 2,062 LOC of `render/` behind a clean interface — a WebGL *lighting layer*
could be added under `Renderer` without touching combat, anim, entities, or tests.
That is the migration-shaped work worth doing, if we do any.

---

## 5 · Revisit triggers (numbers, not vibes)

Migrate — or extract the renderer to WebGL — only when **one** of these is measured
on the target hardware class:

1. `render` time > 45 % of a 16.7 ms frame on ULTRA at 1.9 MP+ **after** the fill
   budget in `23 · §5` is spent. (Today: `jsMs` is reported live in the debug HUD.)
2. Sustained p95 frame gap > 22 ms on a mid-range Android at `medium`.
3. A visual requirement that needs real shaders (bloom, refraction, SDF fog) and is
   worth ≥ 350 KB gzip to the brief.
4. The engine's own code passing ~50k LOC with no owner-level understanding of the
   render path — i.e. maintainability, not performance.

Until one fires, the answer to "is it worth changing the engine?" is **no**, and the
work that is worth doing is the work already in flight: kill the lifetime bugs at
the root (O-13), keep the tier ladder honest (`render/graphics.ts`), and keep the
gate meaningful.

---

## 6 · What was shipped instead of a migration

- O-13 fix: pinned plates, `hasPixels()` on every cached-plate blit, the
  `ledger-unpinned` boundary rule, a loop that survives a throwing frame and owns
  exactly one pending rAF.
- Repro tests: the eviction is reproduced and the pinned plate is proven to survive
  it (`tests/ledger-gen.test.ts`, 9 assertions).
- Crash nets: `app/error.tsx` (segment) and `app/global-error.tsx` (root/hydration).

**Net position:** the reported failure cannot recur, the class it belonged to is
gated, and no part of the game was rewritten to get there.
