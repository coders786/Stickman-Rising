# 15 — MODULE CONTRACTS (the interfaces M1/M2 implement)
**Serves:** `05` §4 (boundaries) · REQ-801…806 · `08` M1/M2.

Planning stops being useful the moment an implementer has to invent an interface,
because invented interfaces produce rewritten interfaces. These are the contracts.
They are deliberately small, allocation-free, and boring.

Conventions: no `any`; all hot-path structs are backed by one `ArrayBuffer`;
nothing returns an object literal in a frame; every module owns its resources and
exposes exactly one `dispose()`; every factory is pure w.r.t. the seed.

---

## 1. Types (shared, one file: `src/game/world/profile.ts`)

```ts
export type ArchetypeId = 'noir' | 'acid' | 'ember' | 'violet' | 'signal' | 'ash'
export type TimeOfDay   = 'dusk' | 'night' | 'predawn'
export type Weather     = 'clear' | 'partly' | 'overcast' | 'rain' | 'storm' | 'fog'
export type Tier        = 'low' | 'medium' | 'high' | 'ultra'
export type DeviceClass = 'C0' | 'C1' | 'C2' | 'C3' | 'Cx'

/** All colour fields are [r,g,b] 0..255 — same convention as mood.ts. */
export type RGB = readonly [number, number, number]

export interface CloudChannel {
  readonly coverage: number   // 0..1  alpha mass target (FID-11/12/13 bands)
  readonly density: number    // 0..1  shaping threshold width
  readonly softness: number   // 0..1  silhouette gradient (edge softness)
  readonly windPx: number     // px/s at 1080p reference; integer-offset blits
  readonly opacity: number    // 0..1  globalAlpha when blitted
  readonly plane: number      // parallax plane index 0..4 (0 = farthest)
}

export interface EnvironmentProfile {
  readonly id: ArchetypeId
  readonly seed: number
  readonly paletteId: number             // index into MOOD_PALETTES
  readonly tod: TimeOfDay
  readonly weather: Weather
  readonly weatherWeights: Readonly<Record<Weather, number>> // sums to 1
  readonly sky: { zenith: RGB; mid: RGB; horizon: RGB; haze: RGB; stars: number }
  readonly clouds: { cumulus: CloudChannel; stratus: CloudChannel; cirrus: CloudChannel }
  readonly light: {
    azimuthDeg: number      // 0..360, 0 = +x screen-right
    elevationDeg: number    // 0..90
    key: RGB; fill: RGB
    shadowStrength: number  // 0..1
    shadowTint: RGB         // never #000 (REQ-404)
  }
  readonly moon: {
    phase: 'crescent' | 'gibbous' | 'full'
    sizePx: number      // at 1080p reference; 210..260
    rings: number       // 2..4
    coverBase: number   // 0..1 weather-driven occlusion at run start
    tint: RGB
  }
  readonly grade: {
    exposure: number      // -1..1
    contrast: number      //  0.5..1.5
    saturation: number    //  0.5..1.5
    temperature: number   // -10..10 (cool..warm)
    shadowHueDeg: number  // split-tone, ≥+12° toward cyan (FID-18)
    highlightHueDeg: number
    lutId: number         // index into the baked LUT set
  }
  readonly fog: { density: number; heightPx: number; color: RGB }
  readonly parallax: readonly [number, number, number, number, number] // speeds
  readonly reflection: { strength: number; ripple: number }
  readonly hero: 'cumulus-bank' | 'moon-in-stratus' | 'cirrus-fan' | 'stratus-shelf' | 'anvil' | 'haze-disc'
}
```

```ts
/** Pure. Same seed ⇒ same profile. Never Math.random(). */
export function pickProfile(seed: number, prev: readonly ArchetypeId[]): EnvironmentProfile
export function profileAxisDiff(a: EnvironmentProfile, b: EnvironmentProfile): number // 0..5
```

---

## 2. Canvas ledger (`src/game/render/canvasLedger.ts`)

```ts
export type LedgerSlot = 'game' | 'sky' | 'plate' | 'cloud' | 'gl' | 'scratch'

export interface LedgerCaps {
  maxCanvases: number   // 48 mobile / 64 desktop
  maxBytes: number      // 56 MB mobile / 96 MB desktop
  maxArea: number       // 8.4 M px per canvas
}

export interface LedgerStats { count: number; bytes: number; peakBytes: number; bySlot: Record<LedgerSlot, number> }

export class LedgerOverflowError extends Error { readonly slot: LedgerSlot; readonly requested: number }

export interface CanvasLedger {
  readonly caps: LedgerCaps
  acquire(slot: LedgerSlot, w: number, h: number): HTMLCanvasElement  // throws LedgerOverflowError
  release(c: HTMLCanvasElement): void        // shrinks to 0×0 (§12.4)
  evictToFit(slot: LedgerSlot, w: number, h: number): number  // LRU; returns evicted count
  stats(): LedgerStats                       // allocates — call only at run start / bench
  probe(): boolean                           // 1×1 draw+read; false ⇒ canvas budget truncated
  setCaps(caps: LedgerCaps): void
  dispose(): void
}
```

Contract: **`probe()` must be called at boot and after every profile change**
(REQ-712). `stats()` is the only allocating method. `release()` is idempotent.

---

## 3. Quality ladder (`src/game/render/quality.ts`)

```ts
export interface QualityState {
  tier: Tier
  tierCeiling: Tier
  atmoScale: 1.0 | 0.8 | 0.66 | 0.5
  ladderStep: 512 | 768 | 1024 | 1280
  dprCap: 1.5 | 2.0
  shedStep: number     // 0..6 — index in the shed ladder (§12.3)
  thermalSticky: boolean
}

export interface FrameSample { dtMs: number }   // one per frame, no allocation

export interface QualityGovernor {
  state(): Readonly<QualityState>
  sample(dt: number): void            // O(1), fixed-bucket histogram, no alloc
  govern(nowMs: number): boolean      // 4 Hz; true if state changed
  percentile(p: 50 | 95 | 99): number // from the histogram
  jankRatio(): number                 // frames > 1.5× target, 10 s window
  overrideCeiling(t: Tier): void      // user settings
  dispose(): void
}
```

Invariants (unit-tested in M1): one shed step per 4 s tick; no raise before 12 s
below 13 ms p95; never raise above `tierCeiling`; never change tier and
`atmoScale` in the same tick.

---

## 4. Environment controller (`src/game/world/env.ts`)

```ts
export interface EnvUniforms { readonly f32: Float32Array; readonly buf: ArrayBuffer } // 16 floats = 64 B

export interface EnvController {
  readonly profile: EnvironmentProfile
  /** Called once per run start. Schedules bakes; never bakes more than one plate. */
  beginRun(seed: number, prevArchetype: readonly ArchetypeId[]): void
  /** Per frame. Mutates uniforms in place. Returns true if a bake is pending. */
  update(dtMs: number): boolean
  /** Per frame, before the game draw. Blits sky + cloud planes only. */
  drawSky(ctx: CanvasRenderingContext2D, camX: number, camY: number): void
  /** Bake queue tick: bakes at most ONE plate, ≤6 ms (§13.7). */
  stepBake(): void
  /** Weather state machine tick; ≥8 s transitions (REQ-105). */
  stepWeather(dtMs: number): void
  uniforms(): EnvUniforms
  dispose(): void
}
```

Foreground contract: `drawSky` performs **only** `drawImage` calls with integer
offsets and `globalAlpha` sets — no path building, no gradients, no filters, no
allocation. Blit count is asserted by the harness.

---

## 5. GPU bake layer (`src/gpu/**` — bake-time only)

```ts
// src/gpu/context.ts
export interface GpuContext {
  readonly gl: WebGL2RenderingContext | null   // null ⇒ Canvas2D fallback (Cx)
  readonly caps: { maxTextureSize: number; mediumpBits: number; highpBits: number; timerQuery: boolean }
  compile(source: string, variants: readonly string[]): Map<string, WebGLProgram>
  onLost(cb: () => void): void
  onRestored(cb: () => void): void       // rebuild programs + atlas; ledger untouched
  loseForTest(): void                    // WEBGL_lose_context, dev only
  dispose(): void
}

// src/gpu/plate.ts
export interface PlateRequest {
  prog: 'sky' | 'moon' | 'cumulus' | 'stratus' | 'cirrus'
  w: number; h: number
  uniforms: EnvUniforms
  seed: number
}
export interface Plate { canvas: HTMLCanvasElement; bytes: number }

// Renders straight-alpha, Y-flipped, into an FBO, readPixels once (§13.1.3).
export function bakePlate(gpu: GpuContext, req: PlateRequest, ledger: CanvasLedger): Plate | null
```

`bakePlate` returns `null` on any failure (link error, lost context, FBO
incomplete) and the caller falls back to the Canvas2D plate. **It never throws
into the frame loop** (fail-closed, `05` §7).

---

## 6. Determinism & allocation contract (applies to all of the above)

| Rule | Enforcement |
|---|---|
| No `Math.random()` anywhere in `src/gpu`, `world/profile`, `world/clouds` | lint (existing rule style) |
| No object literals in per-frame methods | review + `M-ALLOC` harness (0 over 600 frames) |
| No `Array.prototype.map/filter/sort` in per-frame paths | review |
| No string concatenation in per-frame paths (shader recompile, keys) | review |
| Uniforms mutated in place in one 64-byte `ArrayBuffer` | `uniforms().buf` identity assert |
| All canvases through the ledger | lint: `createElement('canvas')` only in `canvasLedger.ts` |

## 7. Test list this document implies

```
tests/profile.pick.test.ts     determinism, M-AXES histogram, band validity, ΔE
tests/quality.governor.test.ts shed order, tick limits, raise guard, override
tests/canvas-ledger.test.ts    caps, zero-on-release, LRU order, overflow, probe
tests/env.controller.test.ts   uniform bytes stable, drawSky blit count, weather timing
tests/gpu.bake.fallback.test.ts  null-return paths (no GL, link fail, FBO fail) do not throw
tests/profile.data.test.ts     every ARCHETYPE satisfies 07 §9 invariants + FID bands
```

Six test files, all pure or stub-ctx: no browser required, which is why M1 can
close in a sandbox with no GPU.
