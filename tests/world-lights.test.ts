/** tests/world-lights.test.ts — the light field, the city's pulse, the roof.
 *
 *  Three systems shipped together because they only work together: a light
 *  field nobody samples is a table, an animated city with no life in the
 *  foreground is a screen saver, and rooftop props that light nothing are
 *  furniture. These tests pin the contracts that make the combination real:
 *
 *    · the fall-off is smooth, monotone and hits zero exactly at the radius;
 *    · a sample names the strongest source and the direction it throws shadow;
 *    · the city's records are DETERMINISTIC per seed and respect the budget;
 *    · the roof never places a prop on a practical and never blocks a fight;
 *    · the tier table is monotone, and every pass is wired, not just written.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  PRACTICAL_SIGN_X, PRACTICAL_LAMP_X, LIGHT_HEX, LIGHT_INK, falloff, liveGain,
  makeStageLights, type PointLight,
} from '../src/game/world/lightfield'
import { RibbonField, newProbe } from '../src/game/lighting/ribbons'
import { FX } from '../src/game/fx/fx'
import { animsForBuilding, drawBuildingAnims, h01, type BuildingAnim } from '../src/game/world/buildings'
import { drawRoofProps, makeRoofProps } from '../src/game/world/roofprops'
import { featuresFor, type Tier } from '../src/game/render/graphics'

function sampleLight(lights: PointLight[], x:number, y:number, t:number) {
  const field = new RibbonField(lights, [])
  field.tick(t)
  return field.sample(x,y,newProbe())
}

/* ------------------------------------------------------------------ stubs -- */

/** A 2-D context that records nothing and throws never. Enough for the draw
 *  passes under test, which are pure functions of their arguments. */
function stubCtx(): { ctx: CanvasRenderingContext2D; ops: number } {
  const state = { ops: 0 }
  const noop = (): void => { state.ops++ }
  const ctx = {
    save: noop, restore: noop, beginPath: noop, closePath: noop, fill: noop,
    stroke: noop, fillRect: noop, moveTo: noop, lineTo: noop, arc: noop,
    ellipse: noop, quadraticCurveTo: noop, translate: noop, scale: noop,
    clearRect: noop, drawImage: noop, createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '', strokeStyle: '', lineWidth: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops: 0, get opsCount() { return state.ops } } as never
}

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

/* ------------------------------------------------------------- fall-off -- */

test('light field: the fall-off is 1 at the source and 0 at the radius', () => {
  assert.equal(falloff(0, 300), 1)
  assert.equal(falloff(300, 300), 0)
  assert.equal(falloff(301, 300), 0)
  assert.equal(falloff(-150, 300), falloff(150, 300), 'the field is symmetric in x')
})

test('light field: the fall-off never increases with distance (no ring, no ring-inverse)', () => {
  let prev = 1
  for (let d = 0; d <= 300; d += 3) {
    const f = falloff(d, 300)
    assert.ok(f <= prev + 1e-12, `fall-off rose at d=${d}: ${f} > ${prev}`)
    assert.ok(f >= 0 && f <= 1, `fall-off left [0,1] at d=${d}`)
    prev = f
  }
})

test('light field: smoothstep removes the corner the old linear ramp had', () => {
  // A linear ramp's slope is 1/300 everywhere; the corner is at the cut-off.
  // The smoothstep-squared curve must be flat at BOTH ends, which is what stops
  // the visible ring: compare the first and last 3 px of slope to the middle.
  const near = falloff(0, 300) - falloff(3, 300)
  const mid = falloff(148.5, 300) - falloff(151.5, 300)
  const edge = falloff(297, 300) - falloff(300, 300)
  assert.ok(near < mid * 0.25, `slope at the source is not flat (${near} vs ${mid})`)
  assert.ok(edge < mid * 0.25, `slope at the cut-off is not flat (${edge} vs ${mid})`)
})

test('light field: a degenerate radius is off, not infinite', () => {
  assert.equal(falloff(0, 0), 0)
  assert.equal(falloff(0, -5), 0)
  assert.equal(falloff(NaN, 300), 0)
})

/* --------------------------------------------------------------- flicker -- */

const steady: PointLight = { id: 't', x: 0, y: 0, kind: 'cool', radius: 200, gain: 0.9, flicker: 0, flickerHz: 3, phase: 0 }
const failing: PointLight = { ...steady, id: 'f', flicker: 0.8 }

test('light field: a steady source never changes with the clock', () => {
  for (const t of [0, 0.31, 5.5, 900]) assert.equal(liveGain(steady, t), 0.9)
})

test('light field: a failing source is a pure function of time and only ever DIMS', () => {
  for (let t = 0; t < 12; t += 0.07) {
    const g = liveGain(failing, t)
    assert.ok(g >= 0 && g <= failing.gain + 1e-12, `gain ${g} escaped [0, ${failing.gain}]`)
    assert.equal(g, liveGain(failing, t), 'the same clock read twice disagreed')
  }
})

/* ---------------------------------------------------------------- sample -- */

test('light field: the stage has a point, a spot and a rectangular practical', () => {
  const lights = makeStageLights({ light: { warm: 1, cool: 1, flicker: 0.4 } }, 1234)
  // two authored practicals + the city bounce (which is not a practical)
  assert.deepEqual(lights.filter(l=>l.kind!=='city').map(l=>l.shape?.type).sort(), ['point','rect','spot'])
  const warm = lights.find((l) => l.kind === 'warm')
  const cool = lights.find((l) => l.kind === 'cool')
  assert.ok(warm && cool, 'the field lost a practical')
  assert.equal(warm.x, PRACTICAL_SIGN_X)
  assert.equal(cool.x, PRACTICAL_LAMP_X)
  // A failing streetlight must actually fail more than a doorway does: the
  // doorway is a lit room behind a door, the tube is a tube.
  assert.ok(cool.flicker > warm.flicker, 'the doorway fails like a bad tube')
})

test('light field: the same seed gives the same night, a new seed a new phase', () => {
  const a = makeStageLights(null, 777)
  const b = makeStageLights(null, 777)
  const c = makeStageLights(null, 778)
  assert.deepEqual(a.map((l) => l.phase), b.map((l) => l.phase))
  assert.notDeepEqual(a.map((l) => l.phase), c.map((l) => l.phase), 'the run seed does not reach the tube')
})

test('light field: a sample stands in the warm spill at the door and the cool one at the lamp', () => {
  const lights = makeStageLights(null, 42)
  const atDoor = sampleLight(lights, PRACTICAL_SIGN_X, 0, 0.4)
  const atLamp = sampleLight(lights, PRACTICAL_LAMP_X, 0, 0.4)
  assert.ok(atDoor.warm > 0.5, `the door does not light its own doorway (${atDoor.warm})`)
  assert.ok(atDoor.warm > atDoor.cool * 4, 'the warm and cool families are confused at the door')
  assert.ok(atLamp.cool > 0.2, 'the streetlight does not light under itself')
  assert.ok(atLamp.cool > atLamp.warm, 'the lamp is warmer than the door')
})

test('light field: the strongest source names the shadow direction, away from itself', () => {
  const lights = makeStageLights(null, 42)
  const right = sampleLight(lights, PRACTICAL_SIGN_X + 60, 0, 0)
  const left = sampleLight(lights, PRACTICAL_SIGN_X - 60, 0, 0)
  assert.equal(right.best?.kind, 'warm')
  assert.equal(right.dir, 1, 'standing right of the door, the shadow falls further right')
  assert.equal(left.dir, -1, 'standing left of the door, the shadow falls further left')
})

test('light field: outside every radius the sample is empty and honest about it', () => {
  const lights = makeStageLights(null, 42)
  const far = sampleLight(lights, PRACTICAL_SIGN_X + 5000, 0, 0)
  assert.equal(far.best, null)
  assert.equal(far.warm, 0)
  assert.equal(far.cool, 0)
  assert.equal(far.bestW, 0)
})

test('light field: two lights sum, and the sum can exceed either alone', () => {
  const pair: PointLight[] = [
    { ...steady, id: 'a', x: 0, kind: 'warm' },
    { ...steady, id: 'b', x: 40, kind: 'warm' },
  ]
  const one = sampleLight([pair[0]], 20, 0, 0)
  const two = sampleLight(pair, 20, 0, 0)
  assert.ok(two.warm > one.warm, 'the second light added nothing')
  assert.ok(two.warm > 0.9, `the overlap is too weak to read as two lights (${two.warm})`)
})

test('light field: every kind has an ink, and no two families share one', () => {
  const inks = Object.values(LIGHT_INK)
  assert.equal(new Set(inks).size, inks.length, 'two light families cast the same shadow colour')
  assert.ok(inks.every((v) => v.split(',').length === 3))
})

/* ------------------------------------------------------------- the city -- */

test('the hash is pure, bounded and not constant', () => {
  const seen = new Set<number>()
  for (let i = 0; i < 400; i++) {
    const v = h01(i, 3, 991)
    assert.ok(v >= 0 && v < 1, `h01 left [0,1): ${v}`)
    assert.equal(v, h01(i, 3, 991))
    seen.add(v)
  }
  assert.ok(seen.size > 390, 'the hash is collapsing')
})

test('buildings: the same building always grows the same inhabitants', () => {
  const rect = { tx: 420, ty: 120, w: 160, h: 300 }
  const a: BuildingAnim[] = []
  const b: BuildingAnim[] = []
  animsForBuilding('mid', 555, rect, a)
  animsForBuilding('mid', 555, rect, b)
  assert.deepEqual(a, b)
  // A different run seed must change at least some of them across a band.
  let differs = 0
  for (let i = 0; i < 40; i++) {
    const x: BuildingAnim[] = []
    const y: BuildingAnim[] = []
    animsForBuilding('mid', 1, { ...rect, tx: 200 + i * 50 }, x)
    animsForBuilding('mid', 2, { ...rect, tx: 200 + i * 50 }, y)
    if (JSON.stringify(x) !== JSON.stringify(y)) differs++
  }
  assert.ok(differs > 8, `the run seed barely reaches the city (${differs}/40 buildings differ)`)
})

test('buildings: records stay on their building and never below its roofline', () => {
  for (let i = 0; i < 60; i++) {
    const tx = 100 + i * 33
    const ty = 200
    const w = 120
    const h = 260
    const out: BuildingAnim[] = []
    animsForBuilding('near', 9, { tx, ty, w, h }, out)
    for (const a of out) {
      assert.ok(a.tx >= tx - 4 && a.tx <= tx + w + 4, `${a.kind} drifted off its building`)
      assert.ok(a.ty <= ty + h, `${a.kind} was placed below the roof line`)
      assert.ok(a.rate > 0 && a.phase >= 0 && a.phase <= 1)
    }
  }
})

test('buildings: a 6 px sliver of skyline gets no inhabitants', () => {
  const out: BuildingAnim[] = []
  animsForBuilding('far', 3, { tx: 10, ty: 10, w: 6, h: 6 }, out)
  assert.equal(out.length, 0)
})

test('buildings: the draw honours the tier budget exactly', () => {
  const anims: BuildingAnim[] = []
  for (let i = 0; i < 30; i++) {
    anims.push({ kind: 'flicker', band: 'mid', tx: 40 + i * 60, ty: 100, w: 2, h: 3, phase: 0.5, rate: 0.4 })
  }
  const stub = stubCtx()
  const drawn = drawBuildingAnims(stub.ctx, anims, 12.5, 0, 0, 2048, 0, 2048, 6)
  assert.equal(drawn, 6, 'the band drew more records than the tier pays for')
  const none = drawBuildingAnims(stub.ctx, anims, 12.5, 0, 0, 2048, 0, 2048, 0)
  assert.equal(none, 0, 'budget 0 still drew something')
})

/* ------------------------------------------------------------- the roof -- */

test('roof: the prop set is deterministic and bounded by the requested count', () => {
  const a = makeRoofProps(4242, { count: 22, x0: -70, x1: 2670 })
  const b = makeRoofProps(4242, { count: 22, x0: -70, x1: 2670 })
  assert.deepEqual(a.props.map((p) => p.kind), b.props.map((p) => p.kind))
  assert.ok(a.props.length <= 22)
  assert.ok(a.props.length >= 12, `the roof lost its stuff (${a.props.length} props)`)
  assert.deepEqual(makeRoofProps(4242, { count: 0, x0: -70, x1: 2670 }).props, [])
})

test('roof: nothing is placed on top of a stage practical', () => {
  for (const seed of [1, 77, 999, 31337]) {
    const { props } = makeRoofProps(seed, { count: 22, x0: -70, x1: 2670 })
    for (const p of props) {
      assert.ok(Math.abs(p.x - PRACTICAL_LAMP_X) >= 100, `a ${p.kind} sits inside the streetlight (seed ${seed})`)
      assert.ok(Math.abs(p.x - PRACTICAL_SIGN_X) >= 100, `a ${p.kind} sits in the stairwell door (seed ${seed})`)
    }
  }
})

test('roof: props are spaced, and none blocks a fighter', () => {
  const { props } = makeRoofProps(8080, { count: 22, x0: -70, x1: 2670 })
  for (let i = 1; i < props.length; i++) {
    const gap = Math.abs(props[i].x - props[i - 1].x)
    assert.ok(gap >= 70 - 0.001, `props ${gap.toFixed(1)}px apart read as one lump`)
  }
  // A fighter is 118 px tall; the roof's furniture must stay well under that or
  // a swing disappears behind a water tank.
  for (const p of props) assert.ok(p.h <= 60, `a ${p.kind} is ${p.h}px tall`)
})

test('roof: at most one bulb, and the bulb is a real light in the field', () => {
  for (const seed of [5, 123, 4321]) {
    const { props, lights } = makeRoofProps(seed, { count: 22, x0: -70, x1: 2670 })
    const bulbs = props.filter((p) => p.kind === 'bulb')
    assert.ok(bulbs.length <= 1, 'two bulbs: the roof became a runway')
    assert.equal(lights.length, bulbs.length)
    for (const l of lights) {
      assert.equal(l.kind, 'bulb')
      assert.ok(l.radius >= 250 && l.radius <= 290)
      assert.ok(l.gain > 0)
      // The light hangs at the top of the stand, not at its base.
      assert.ok(l.y < 0)
    }
  }
})

test('roof: the draw culls to the view and reports what it drew', () => {
  const { props } = makeRoofProps(606, { count: 22, x0: -70, x1: 2670 })
  const stub = stubCtx()
  const all = drawRoofProps(stub.ctx, props, -1000, 4000, true, .7)
  assert.equal(all, props.length)
  const none = drawRoofProps(stub.ctx, props, 9000, 9500, true, .7)
  assert.equal(none, 0, 'props were drawn outside the frustum')
})

/* ------------------------------------------------------- tiers + wiring -- */

test('tiers: the new dials are monotone and low is genuinely bare', () => {
  const order: Tier[] = ['low', 'medium', 'high', 'ultra']
  const f = order.map((t) => featuresFor(t))
  assert.equal(f[0].roofProps, 0, 'low draws rooftop props it cannot afford')
  assert.equal(f[0].buildingAnims, 0, 'low animates the city')
  assert.equal(f[0].lightPools, 0, 'low draws deck pools')
  for (let i = 1; i < f.length; i++) {
    assert.ok(f[i].roofProps >= f[i - 1].roofProps)
    assert.ok(f[i].buildingAnims >= f[i - 1].buildingAnims)
    assert.ok(f[i].lightPools >= f[i - 1].lightPools)
  }
  assert.ok(f[3].roofProps > 0 && f[3].buildingAnims > 0 && f[3].lightPools > 0)
})

test('wiring: the field is sampled, not just tabulated', () => {
  const bg = readFileSync('src/game/world/background.ts', 'utf8')
  assert.match(bg, /this\.lighting\(\)\.sample\(/, 'background never samples the field')
  assert.match(bg, /makeStageLights\(/, 'the stage lights are not built from the profile')
  assert.match(bg, /makeStageLights\(this.profile, this.runSeed, this.art.amberSpecimen\).concat\(bulbs\)/, 'the roof bulb is not in the field')
  assert.match(bg, /drawLightPools\(ctx: CanvasRenderingContext2D,/, 'no deck pools')
  for (const band of ['deep', 'far', 'mid', 'near']) {
    assert.match(bg, new RegExp(`collectAnims\\('${band}'`), `the ${band} band emits no city life`)
    assert.match(bg, new RegExp(`drawBandAnims\\(ctx, '${band}'`), `the ${band} band never draws its city life`)
  }
  assert.match(bg, /drawRoofProps\(ctx, this\.roof\.props, viewL, viewR/, 'the roof props are never drawn')
  assert.match(bg, /this\.drawLightPools\(ctx, cam\)/, 'the pools are built but never called')

  const r = readFileSync('src/game/render/renderer.ts', 'utf8')
  assert.match(r, /e\.draw\(ctx, time, lighting\(e\), noirEnemies\)/, 'enemies stand in the light and stay unlit')
})


/* ---------------------------------------------- the city bounce (run 4b) -- */

test('city bounce: the roof is lit by the city even with no practicals in reach', () => {
  const lights = makeStageLights(null, 4242)
  const city = lights.filter((l) => l.kind === 'city')
  assert.equal(city.length, 3, 'the roof has no city light')
  const s = sampleLight(lights, 1276, 0, 0)
  assert.ok(s.city > 0.08, `the middle of the deck has no city light (${s.city.toFixed(3)})`)
  // ...and it can never out-shout a practical you are standing in.
  const atDoor = sampleLight(lights, PRACTICAL_SIGN_X, 0, 0)
  assert.ok(atDoor.warm > s.city * 3, 'the city bounce is competing with the stairwell')
})

test('city bounce: it is dim, wide and per-run', () => {
  const a = makeStageLights(null, 11).filter((l) => l.kind === 'city')
  const b = makeStageLights(null, 11).filter((l) => l.kind === 'city')
  const c = makeStageLights(null, 12).filter((l) => l.kind === 'city')
  for (const l of a) {
    assert.ok(l.gain < 0.3, `a city source is a lamp, not a bounce (gain ${l.gain})`)
    assert.ok(l.radius >= 420, `a city source is not wide enough to be ambient (${l.radius})`)
    // and it is BELOW the deck: light pollution comes up over the parapet
    assert.ok(l.y > 0, 'the city light is not coming from below the roof')
  }
  assert.deepEqual(a.map((l) => Math.round(l.x)), b.map((l) => Math.round(l.x)))
  assert.notDeepEqual(a.map((l) => Math.round(l.x)), c.map((l) => Math.round(l.x)), 'the run seed does not move the city light')
})

test('city bounce: it never casts a crisp second shadow', () => {
  const p=sampleLight([{...steady,kind:'city'}],0,0,0)
  assert.ok(p.city>0); assert.equal(p.caster,null)

})

/* --------------------------------------------- colour formats (the bug) -- */

test('colour: every light kind has a HEX tint, because rgba() parses hex', () => {
  // The first version of the hit light passed "255,168,92" to `rgba()` (which
  // takes '#rrggbb'), silently producing rgb(37,81,146) — a BLUE bloom in a warm
  // doorway. This test is the guard against that class of bug.
  for (const [kind, hex] of Object.entries(LIGHT_HEX)) {
    assert.match(hex, /^#[0-9a-f]{6}$/, `${kind} is not a hex colour: ${hex}`)
  }
  assert.equal(new Set(Object.values(LIGHT_HEX)).size, Object.keys(LIGHT_HEX).length)
})

/* ---------------------------------------------------- the hit light (FX) -- */

test('hit light: a strike inside a practical blooms that light, one outside keeps the blade', () => {
  const fx = new FX()
  fx.setLightSampler((x) => (x > 1400 ? { color: '#ffa85c', k: 0.9 } : { color: '#ffba78', k: 0.2 }))
  fx.impact(1500, -60, 0, true, '#eafcff', '#9fe8ff')
  fx.impact(1200, -60, 0, true, '#eafcff', '#9fe8ff')
  const flashes = (fx as unknown as { flashes: { lit: number; litColor: string }[] }).flashes
  assert.equal(flashes.length, 2)
  assert.ok(flashes[0].lit > 0.5, 'a hit in the door is not lit by the door')
  assert.equal(flashes[0].litColor, '#ffa85c')
  // The city bounce alone (k ≈ 0.2) must NOT recolour the hit, or every strike
  // on the roof would come out the same amber.
  assert.ok(flashes[1].lit <= 0.35)
  assert.equal(flashes[1].litColor, '')
})

test('hit light: the wave is an ellipse along the swing, never a circle', () => {
  const fx = new FX()
  fx.impact(500, -60, 0.8, true, '#eafcff', '#9fe8ff')
  const rings = (fx as unknown as { rings: { squash: number; axis: number }[] }).rings
  assert.equal(rings.length, 1)
  assert.ok(rings[0].squash < 0.8 && rings[0].squash > 0, `the shockwave is a circle (squash ${rings[0].squash})`)
  assert.equal(rings[0].axis, 0.8, 'the shockwave ignores the strike direction')
})

test('hit light: the game wires the field into FX, once per background', () => {
  const g = readFileSync('src/game/game.ts', 'utf8')
  assert.match(g, /fx\.setLightSampler\(this\.hitLight\)/, 'the hit light is never wired')
  assert.match(g, /this\.wireHitLight\(\)/, 'the wiring is never called')
  assert.match(g, /LIGHT_HEX\[s\.best\.kind\]/, 'the hit light is not taken from the field')
  const f = readFileSync('src/game/fx/fx.ts', 'utf8')
  assert.match(f, /private lightSampler/, 'FX has no sampler')
  assert.match(f, /ctx\.scale\(2\.15, 0\.5\)/, 'the bloom is not thrown along the strike')
  assert.match(f, /const expo = 1 - 0\.45 \* Math\.min\(1, f\.lit\)/, 'no local exposure: the bloom clips to white in a lit doorway')
})

/* ------------------------------------------- the inn + the roof (run 4b) -- */

test('the roadside advisory has a steady rectangular emitter and open space under the board', () => {
  const lamp=makeStageLights(null,1).find(l=>l.id==='stage:warning-sign')!
  assert.equal(lamp.shape?.type,'rect');assert.equal(liveGain(lamp,0),liveGain(lamp,10))
  const field=new RibbonField([lamp],[])
  assert.ok(field.sample(lamp.x,0,newProbe()).warm>.5)
})

test('the roof sits in the city glow, gated by the tier', () => {
  const bg = readFileSync('src/game/world/background.ts', 'utf8')
  assert.match(bg, /function buildCityGlow/, 'no city glow plate')
  assert.match(bg, /hasPixels\(this\.cityGlow\) && RF\.lightPools > 0/, 'the city glow is not tier-gated')
  assert.match(bg, /drawImage\(glow, gx, ROAD\.sidewalk - glow\.height \+ 28\)/, 'the glow is not anchored to the deck line')
  const rp = readFileSync('src/game/world/roofprops.ts', 'utf8')
  assert.match(rp, /const CITY_EDGE/, 'roof props are not lit from below by the city')
  assert.match(rp, /CITY_UNDER/, 'no city bounce around the prop bases')
})
