/** F15 — DamageSurface unique-union + horizontal run merging. Old code
 *  summed prev.length + cur.length (double-counting cells touched in both
 *  frames): identical 32% coverage summed to 64% > 58% and falsely chose a
 *  full clear (the duplicate-area probe witness). It also issued one
 *  clearRect PER CELL even when cells were adjacent. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DamageSurface } from '../src/game/render/bhst'

type Rect = [number, number, number, number]
function stubCtx(w: number, h: number) {
  const clears: Rect[] = []
  const ctx = {
    canvas: { width: w, height: h },
    save() {},
    restore() {},
    setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) {},
    clearRect(x: number, y: number, w2: number, h2: number) { clears.push([x, y, w2, h2]) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, clears }
}

function isFullClear(clears: Rect[], w: number, h: number): boolean {
  return clears.length === 1 && clears[0][0] === 0 && clears[0][1] === 0
    && clears[0][2] >= w && clears[0][3] >= h
}

test('repeated identical coverage does NOT trigger a false full clear (F15)', () => {
  const W = 256, H = 256
  const d = new DamageSurface()
  d.resize(W, H)
  const { ctx, clears } = stubCtx(W, H)

  // frame 0: initial full clear (generation start)
  d.begin(ctx, W, H, 1)
  clears.length = 0

  // 20 of 64 cells = 31.25% coverage (the probe's ~32%)
  const mark20 = () => {
    for (let i = 0; i < 20; i++) {
      const c = i % 8
      const r = (i / 8) | 0
      d.markRect(c * 32, r * 32, 32, 32, 0)
    }
  }
  mark20()
  // frame 1: union(prev=0, cur=20) = 20 ≤ 58% → partial
  d.begin(ctx, W, H, 1)
  assert.ok(!isFullClear(clears, W, H), 'first partial frame stays partial')
  clears.length = 0

  mark20()
  // frame 2: OLD code counted 20+20=40 > 37.1 → FULL CLEAR (bug).
  // NEW: unique union is 20 → partial.
  d.begin(ctx, W, H, 1)
  assert.ok(!isFullClear(clears, W, H),
    'identical 31% coverage across two frames must not sum to a full clear')
  assert.ok(clears.length > 0, 'the dirty cells are still cleared')
  clears.length = 0

  mark20()
  d.begin(ctx, W, H, 1)
  assert.ok(!isFullClear(clears, W, H), 'third begin also stays partial')
})

test('each unique cell is cleared exactly once, merged into horizontal runs', () => {
  const W = 256, H = 256
  const d = new DamageSurface()
  d.resize(W, H)
  const { ctx, clears } = stubCtx(W, H)
  d.begin(ctx, W, H, 1) // generation full clear
  clears.length = 0

  // mark rows 0..2 partially: cells 0..19 (row0: 0-7, row1: 0-7, row2: 0-3).
  // Interior coordinates: markRect treats the upper edge cell as touched
  // (conservative floor((x+w+pad)/s)), so +1/−1 pins each mark to ONE cell.
  for (let i = 0; i < 20; i++) d.markRect((i % 8) * 32 + 1, ((i / 8) | 0) * 32 + 1, 30, 30, 0)
  d.begin(ctx, W, H, 1)
  // run-merged: three contiguous runs → three clearRects (not twenty)
  assert.equal(clears.length, 3, `adjacent cells merge into runs (got ${clears.length}: ${JSON.stringify(clears)})`)
  // row 0 run covers columns 0..7 → x 0..256 at y 0..32
  assert.deepEqual(clears[0], [0, 0, 256, 32])
  // row 1 run
  assert.deepEqual(clears[1], [0, 32, 256, 32])
  // row 2 run covers columns 0..3 → x 0..128 at y 64..96
  assert.deepEqual(clears[2], [0, 64, 128, 32])
})

test('fractional DPR coverage keeps floor/ceil cell bounds', () => {
  const W = 200, H = 200
  const d = new DamageSurface()
  d.resize(W, H)
  const { ctx, clears } = stubCtx(Math.round(W * 1.5), Math.round(H * 1.5))
  d.begin(ctx, W, H, 1.5)
  clears.length = 0
  // interior coords → exactly cell (0,0) (see run-merge test note)
  d.markRect(1, 1, 30, 30, 0)
  d.begin(ctx, W, H, 1.5)
  assert.equal(clears.length, 1)
  const [x, y, w, h] = clears[0]
  assert.equal(x, Math.floor(0 * 1.5))
  assert.equal(y, Math.floor(0 * 1.5))
  assert.equal(w, Math.ceil(32 * 1.5) - Math.floor(0 * 1.5))
  assert.equal(h, Math.ceil(32 * 1.5) - Math.floor(0 * 1.5))
})

test('a genuinely dense frame (union > 58%) still takes the full-clear path', () => {
  const W = 256, H = 256
  const d = new DamageSurface()
  d.resize(W, H)
  const { ctx, clears } = stubCtx(W, H)
  d.begin(ctx, W, H, 1)
  clears.length = 0
  // 40 unique cells = 62.5% > 58%
  for (let i = 0; i < 40; i++) d.markRect((i % 8) * 32, ((i / 8) | 0) * 32, 32, 32, 0)
  d.begin(ctx, W, H, 1)
  assert.ok(isFullClear(clears, W, H), 'dense coverage legitimately full-clears')
})
