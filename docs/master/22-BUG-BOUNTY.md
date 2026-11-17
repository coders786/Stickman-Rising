# 22 — UX BUG BOUNTY (run 1)
**Serves:** the mandate's last phase (validate) · Rule 10 · D13 · D14.
**Method:** automated where it can be, inspect-and-prove where it cannot.

A bug bounty is only a bounty if it pays in *reproductions*. Every entry below
carries: how it was found, what the player actually experiences, the evidence,
and whether this run fixed it. Nothing here is "looks better now".

**No screenshots, no Playwright.** The verification stack is: `tsc`, 313 tests,
a production build (`npm run build:iso` while the preview server is up — see the
note on `distDir` in `next.config.ts`), `scripts/lint-boundaries.mjs`,
`scripts/bench-render.mjs`, and code inspection. The user's eye remains the final gate on anything visual —
which is why every claim below is stated as a mechanism you can check, not as a
picture you must trust.

---

## 0 · The program

| Class | How it was hunted | Automated? |
|---|---|---|
| U (usability / flow) | every state transition in `app/page.tsx` read against its exit conditions | no — by hand, exhaustively |
| A (accessibility) | keyboard-only walk of all 8 screens; focus after each transition; screen-reader text audit | partly (`autoFocus`, `aria-live` asserts are structural) |
| C (continuity) | "does anything the player learned in frame N still hold in N+1?" | no |
| P (perf-as-UX) | allocation rate in the draw path, bake timing, frame-time distribution | yes (`bench-render`, `frameLog`, tests) |
| H (honesty) | every profile axis traced to the code that consumes it | yes (`profile`↔`sky` uniform cross-check test) |

Severity: **P1** = the game cannot be played / a run is lost. **P2** = the
player is confused or blocked for seconds. **P3** = a polish defect a player
would describe as "a bit off" without being able to name it.

---

## 1 · FIXED in this run

### U-01 · **P1** — On a LAN address, the PLAY button did nothing
`startGame` called `crypto.randomUUID()`. That function exists only in a secure
context (https / localhost). The app is routinely opened from a phone at
`http://192.168.x.x:3000`, where the call throws inside the click handler — so
ENGAGE silently failed with a console error nobody was reading.
**Fix:** `submissionId()` in `app/page.tsx` — `randomUUID` when available,
`getRandomValues` with a correct v4 nibble layout otherwise. The idempotency key
is still strong on every origin that can run the game at all.

### U-02 · **P1** — Escape did nothing on four of eight screens; Settings was a keyboard trap
The hotkey effect only handled `paused`. On Settings the only exit was the BACK
button, and BACK had `e.currentTarget.blur()` on it, so a keyboard user landed on
`<body>` with the overlay still up.
**Fix:** Escape is now the universal back (settings → its caller, arsenal/howto/
scores → title, gameover → title), and P still toggles pause. `pause()`/`resume()`
are already idempotent (`game.ts:636`), so double-handling the key cannot
toggle twice.

### A-01 · **P2** — Focus vanished after every menu transition
Every handler blurs its own button (correct: it stops Space re-firing the last
action). Nothing then took focus, so Tab restarted at the top of the document.
**Fix:** the primary action of each screen carries `autoFocus` (ENGAGE, RESUME,
RETRY). One attribute per screen, no focus-trap library, and it survives the
overlays being separate subtrees.

### A-02 · **P2** — Screen changes were invisible to assistive technology
**Fix:** a `role="status" aria-live="polite"` node announces the active screen
(`SCREEN_LABEL`), and the canvas now has `aria-describedby` pointing at a hidden
control legend. A canvas app with an `aria-label` and nothing else is a black box
to a screen reader.

### U-03 · **P3** — Thumb buttons could not go away
`touchMode` was sampled once at mount. A tablet that gains a mouse (or a phone
with a keyboard case) kept drawing thumb controls over the play area.
**Fix:** one `matchMedia('(pointer: coarse)').change` listener, removed on unmount.

### P-01 · **P1** — Pressing PLAY froze the game for the length of the bake
A reseed invalidates every city tile and both sky plates, and the bake ran inside
the first `drawSky` of the run. Measured cost of that bake: 120–400 ms depending
on device canvas speed. The player pressed PLAY and watched a still frame — the
classic "the game is broken" first impression.
**Fix:** `CyberBackground.warm()` bakes synchronously at the click
(`game.ts startRun`), so the cost lands while the menu is still on screen; the
duration is stored in `bakeMs` and printed in the frame readout
(`bake gpu/cpu 137ms`) so a slow device shows up in the log instead of in a
complaint.

### C-01 · **P2** — A quality-tier change silently re-rolled the world
`applySettings` rebuilt the `CyberBackground` on a level change and never
re-applied the run seed, so the skyline, moon and profile changed mid-session.
**Fix:** `lastRunSeed` is remembered and re-applied on every scene rebuild.

### P-02 · **P2** — The tier governor optimised the average frame time
`fpsAvg`-driven tier drops hide exactly the variance players feel (21 §14): a
smooth 55 fps and a 55 fps with 200 ms hitches look identical to an average.
**Fix:** `render/quality.ts` — a p95 over a 4 s window, one step per window, a
12 s dwell after any shed, a hard floor and a user-chosen ceiling. Nineteen unit
tests, including the oscillation case and the tab-restore spike.

### P-03 · **P2** — ~10⁴ short-lived strings per second in the draw path
`` `rgba(192,205,211,${a})` `` allocates a string every call; the smear rig called
it 11 times per frame, plus particles. That is the allocation rate that fills a
young generation every couple of seconds (21 §8).
**Fix:** `render/color.ts` — alpha quantised to 1/32 and cached per base colour.
Bounded at 33 strings per base, 0.019 µs/call, and a test asserts the cache
STOPS growing (500 000 calls, 33 strings).

---

## 2 · FILED, with repro

Rows marked ✅ were closed by the **O-sweep** (run 2) after this table was
written; the repro column is kept because a closed bug with a repro is a
regression test waiting to be written, and a closed bug without one is a rumour.

| # | Sev | What | Repro | Status / why it was not fixed |
|---|---|---|---|---|
| O-01 | P2 | `sakugaHammer` cleaves 3/5 and misses bodies 1–2 (`0 0 36 36 36`) | `node --import tsx .qa/blade-cleave.ts sakugaHammer` | the move launches the player (`moveY −240`) over the near bodies; the fix is a move-design decision (reduce the launch or give the slam a ground-AoE pad), not a mechanical one |
| O-02 | P2 | `sakugaHammer`'s cut count changes with tick rate (60 Hz = 2 bodies, ≥90 Hz = 3) | `tests/blade-cleave.test.ts` case 4 | the sweep window is narrower than one 60 Hz tick at the extremes; widening it was already tried and made distant bodies credit late (worse) |
| O-03 | P3 | `dashSlash` (TACKLE) right elbow is welded across the whole clip | `tests/full-body.test.ts` case 6 | a single authored channel; a generic "unlock all frozen joints" pass was written and REVERTED because it broke `every sword attack intent has a bounded short-contact equivalent` (net −1) |
| O-04 | P3 | The sword-ritual clips no longer carry six extra authored keys | `tests/sword-ritual.test.ts` | authorship work on 12 clips; unrelated to this overhaul's surface |
| O-05 | P3 | One connecting unarmed strike credits a hit with more slack than its `pad` | `tests/unarmed-step.test.ts` | contact-volume tuning shared with O-01 |
| O-06 | P2 | 7 canvas creation sites outside the ledger (`background.ts` ×2, `hud.ts` ×2, `props.ts`, `night.ts`, `fx.ts`) | `npm run lint:bounds` | `night.ts` is new and will move onto the ledger with T1.6; the rest is the M1 migration, now frozen by a baseline so the count cannot grow |
| O-07 | P3 | 29 `Math.random()` sites in seeded modules (mostly `audio.ts` sound variation) | `npm run lint:bounds` | audio variation SHOULD be random; the rule needs a per-module exemption list rather than a global one |
| O-08 ✅ | **P2** | 8 profile axes were computed and **not consumed** by any renderer: `aurora.hue`, `clouds.texture`, `stars.twinkle`, `props.crateBias`, `weather.stormBias`, `weather.rain`, `weather.cadence`, `grade.*` | `tests/profile-consumption.test.ts` (now a gate) | **CLOSED.** All 34 axes have a named consumer in `world/consumers.ts`, and the gate fails if any axis loses one. New art landed with them: `world/clouds.ts` (conditional cumulus bank — clear nights have none), `world/rigging.ts` (cables + pennants on a shared `world/wind.ts`), film-grade/vignette/aurora-hue args on the bake, `StormEngine.applyProfile`, `uTwinkle`, `weightOf()`. The file-level grep check is a floor, not a proof — correctness lives in `tests/rigging|clouds|night-plates`. |
| O-09 ✅ | P3 | The run identity was only visible in the developer frame readout | play 18 s, then die | **CLOSED.** `TONIGHT · <label> · <id>` is drawn top-right for the first 18 s of every run (fading 14→18 s), and the results card carries `TONIGHT'S RIG` with the same label + seed via `Game.runIdentity()`, so the night can still be read when the run is over and "that one" can be re-rolled. |
| O-10 ✅ | P3 | `renderer.ground()` used a hard-coded lower-left contact shadow regardless of the moon's side | rotate the profile until the moon is on the left | **CLOSED.** `CyberBackground.moonScreenX()` is inverted into world space through the live camera and the shadow is projected *away* from the moon, stretched by distance from it (closer = shorter). Cost: one comparison and a multiply per figure. |

---

### O-11 · **P1** — "the server is corrupted": the preview died after every build
Two processes shared one output directory. `next dev` owns `.next/`, and the
`next build` used to verify the tree deletes its manifests; the dev server keeps
answering `200` from resident memory while every chunk under `/_next/static`
404s, so the game renders nothing and the page looks alive. Restarting the server
"fixed" it every time, which is why it looked like a corrupt server and not like
two writers.
**Fix:** `next.config.ts` takes `distDir` from `STICKMAN_DIST_DIR`, and
`npm run build:iso` builds into `.next-build`. Verified by building while the dev
server was up and then fetching three of the page's own chunk URLs — all `200`.

---

## 3 · What the bounty says about the plan

Three of the ten fixes (U-01, U-02, A-01) were **not** in any of the 21 design
documents. They are ordinary product defects that no amount of shader research
would surface, and they were each worth more to a first-time player than the GPU
baker. The plan's own risk register predicted this shape (R-26 "the untested
surface is the app shell, not the renderer") — the bounty is that prediction
being collected.

Two (P-01, P-02) were *caused* by the graphics work and caught by reading it
back. That is the argument for a validation phase that starts from the frame the
player actually sees, not from the feature list.

---

## 4 · Re-test protocol (run 2)

1. `npm run gate` → `tsc` clean, boundaries clean (0 new), **289/294** with the 5
   known fails listed in §2. Any *new* failure is a regression, not a discovery.
2. `npm run bench` → every row inside budget; `profile.novelty.min ≥ 0.11`.
3. Keyboard-only pass: Tab to ENGAGE → Escape out of every screen → verify focus
   lands on the primary action each time.
4. Insecure-origin pass: open the LAN URL on a phone, press ENGAGE (U-01).
5. Bake pass: press PLAY ten times; the frame readout must show `bake …ms` under
   400 ms and no frame of gameplay may be still.
6. Eye pass (user): does the moon read as *a different night* between two runs,
   and does the rooftop still read as one designed frame?
