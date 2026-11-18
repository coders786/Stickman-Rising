/** STICKMAN RISING — tests/profile-consumption.test.ts
 * THE NO-DEAD-KNOBS GATE (bounty O-08).
 * ----------------------------------------------------------------------------
 * A profile axis that nothing draws is a lie in a design document. This gate
 * makes that class of lie fail CI instead of shipping:
 *
 *  1. every axis the EnvironmentProfile actually HAS is claimed by a row in
 *     PROFILE_CONSUMERS (world/consumers.ts);
 *  2. every claimed file exists and mentions the field, so deleting the read
 *     while leaving the comment behind fails;
 *  3. the O-08 sweep's call sites are really wired — the builders that gained a
 *     profile argument are not still being called without one.
 *
 * Check 2 is a grep. It proves a reference exists, not that it is correct; the
 * tests that prove correctness are the per-consumer tests (night-plates,
 * profile, storm, props) and the player's eye.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { makeProfile } from '../src/game/world/profile'
import { PROFILE_CONSUMERS, allAxisPaths, unclaimedAxes } from '../src/game/world/consumers'
import { labelFor } from '../src/game/world/profile'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f: string): string => readFileSync(ROOT + f, 'utf8')

/** Several seeds, because `makeProfile` shapes a few axes against each other
 *  (star density vs cloud coverage): one seed can hide an axis. */
const SEEDS = [1, 0x5eed, 0xabcdef, 0xffffffff, 987654321, 12345678]

test('every profile axis has a consumer', () => {
  for (const seed of SEEDS) {
    const p = makeProfile(seed)
    const dead = unclaimedAxes(p)
    assert.deepEqual(dead, [], `seed ${seed}: axes nothing reads: ${dead.join(', ')}`)
  }
})

test('the axis list itself is not empty and is stable across seeds', () => {
  const a = allAxisPaths(makeProfile(5))
  const b = allAxisPaths(makeProfile(9))
  assert.ok(a.length >= 30, `only ${a.length} axes found — did the profile schema change?`)
  assert.deepEqual(a, b, 'the schema must not depend on the seed')
  // Spot-check the groups, so a renamed group cannot quietly drop out.
  for (const g of ['moon.', 'stars.', 'clouds.', 'aurora.', 'atmosphere.', 'weather.', 'grade.', 'light.', 'props.']) {
    assert.ok(a.some((x) => x.startsWith(g)), `group ${g} missing from the axis list`)
  }
})

test('every consumer row names a real file that mentions the field', () => {
  const failures: string[] = []
  for (const row of PROFILE_CONSUMERS) {
    let src: string
    try {
      src = read(row.file)
    } catch {
      failures.push(`${row.axis}: ${row.file} does not exist`)
      continue
    }
    const field = row.axis.split('.').pop() as string
    const re = new RegExp(`\\b${field}\\b`)
    if (!re.test(src)) failures.push(`${row.axis}: ${row.file} never mentions "${field}"`)
    if (row.how.trim().length < 12) failures.push(`${row.axis}: the "how" clause is not a sentence`)
  }
  assert.deepEqual(failures, [])
})

test('no axis is claimed twice with contradictory consumers', () => {
  const seen = new Map<string, string>()
  for (const row of PROFILE_CONSUMERS) {
    const prev = seen.get(row.axis)
    assert.equal(prev, undefined, `${row.axis} is claimed twice (${prev} and ${row.file})`)
    seen.set(row.axis, row.file)
  }
})

test('the O-08 sweep is wired into the draw path, not just written', () => {
  const bg = read('src/game/world/background.ts')
  // The four builders that gained a profile argument are called WITH it.
  assert.match(bg, /buildCloudTile\(false,\s*profForBake\.clouds\.texture\)/, 'clouds.texture is not passed to the cloud tile')
  assert.match(bg, /buildAuroraTile\(this\.mood,\s*profForBake\.aurora\.hue\)/, 'aurora.hue is not passed to the aurora tile')
  assert.match(bg, /buildVignettePlate\(this\.vw,\s*this\.vh,\s*this\.profile \? this\.profile\.grade\.vignette : 1\)/, 'grade.vignette is not passed to the vignette plate')
  assert.match(bg, /bakeFilmGrade\(g,\s*TILE,\s*NEAR_H,\s*this\.mood,\s*0\.85,\s*rng,\s*this\.profile\?\.grade\)/, 'grade is not passed to the film plate')
  // The bank and the rigging are constructed and drawn.
  assert.match(bg, /buildCloudBank\(profForBake, TILE, 210, bankSurface\)/, 'the cloud bank is never built')
  assert.match(bg, /gameLedger\.acquire\(bankKey, TILE, 210, 'sky', true\)/, 'the bank canvas is not acquired PINNED from the ledger')
  // The blit is guarded: a released surface is a 0×0 canvas and drawImage throws.
  assert.match(bg, /if \(hasPixels\(bank\)\)/, 'the bank blit is not guarded by hasPixels')
  assert.match(bg, /const bank = this\.bank;/, 'the cloud bank is never read for drawing')
  assert.match(bg, /if \(hasPixels\(bank\)\)/, 'the cloud bank blit is not guarded')
  assert.match(bg, /this\.rig = new Rigging\(this\.profile, this\.q\)/, 'the rigging is never constructed')
  assert.match(bg, /this\.rig\?\.draw\(ctx\)/, 'the rigging is never drawn')
  assert.match(bg, /this\.rig\?\.update\(d\)/, 'the rigging is never simulated')
  // Weather reaches the storm engine.
  assert.match(bg, /this\.storm\.applyProfile\?\.\(this\.profile\.weather\)/, 'weather.* is not applied to the storm engine')
  // The weather front is owned and driven (T5.1), not merely imported.
  assert.match(bg, /this\.wx = new WeatherFront\(this\.profile\.seed/, 'the weather front is never constructed')
  assert.match(bg, /this\.wx\?\.update\(d, this\.storm\.intensity\)/, 'the weather front is never advanced')
  assert.match(bg, /this\.storm\.setRainScale\(this\.wxRainBase \* s\.rain\)/, 'the front does not reach the rain')
  assert.match(bg, /this\.rig\?\.windState\.setGust\(s\.gust\)/, 'the front does not reach the wind')
  assert.match(bg, /if \(!this\.art\.clean && this\.wxTint && this\.q !== 'low'\)/, 'the weather tint is not drawn (or is not tier-gated)')
  // ONE KEY LIGHT: the model is built, and every lit consumer reads it.
  assert.match(bg, /this\.light = keyLightFor\(this\.profile\)/, 'the key light model is never built')
  assert.match(bg, /this\.moonX = moonCentreX\(this\.light/, 'the moon is not placed by the key light')
  assert.match(bg, /this\.rig\?\.setRimSide\(rimDirection\(this\.moonX, this\.vw\)\)/, 'the cable rim does not follow the key')
  assert.match(bg, /reflectionGain\(this\.light\)/, 'the reflection does not answer the key')
  const renderer = read('src/game/render/renderer.ts')
  assert.match(renderer, /directionalProjection\(key/, 'the moon must supply a camera-independent projection')
  // The moon's screen x is exposed for the contact shadows.
  assert.match(bg, /moonScreenX\(\): number/, 'the moon position is not exposed to the renderer')
})

test('the graphics levels are wired, not just tabulated', () => {
  const renderer = read('src/game/render/renderer.ts')
  assert.match(renderer, /featuresFor\(q as Tier\)/, 'the renderer does not read the tier table')
  assert.match(renderer, /drawCastShadow\(ctx, actor, path/, 'the projected body shadow is never drawn')
  assert.match(renderer, /drawContactAO\(ctx, x, y,/, 'the contact shadow is never drawn')
  assert.match(renderer, /props\.drawShadows\(ctx, moon\.dir, moon\.reach/, 'prop silhouette shadows are never drawn')
  assert.match(renderer, /bg\.drawMotes\?\.\(ctx, time\)/, 'the dust pass is never called')
  const bg = read('src/game/world/background.ts')
  assert.match(bg, /this\.shaftWarm = buildShaft/, 'the volumetric shafts are never baked')
  assert.match(bg, /if \(F\.shafts\)/, 'the shafts are never drawn')
  assert.match(renderer, /F\.practicalShadow && probe\?\.caster/, 'the second light cannot cast a shadow')
  const props = read('src/game/world/props.ts')
  assert.match(props, /silhouetteOf\(spr\)/, 'prop silhouettes are never baked')
  assert.match(props, /ctx\.transform\(m\.a, m\.b, m\.c, m\.d, 0, 0\)/, 'prop shadows are never projected')
  const game = read('src/game/game.ts')
  assert.match(game, /featuresFor\(this\.settings\.quality as Tier\)\.dprCap/, 'the DPR cap does not come from the table')
  const page = read('src/app/page.tsx')
  assert.match(page, /classifyDevice\(/, 'the client never classifies its own device')
})

test('the labels are human and distinct enough to read', () => {
  const labels = new Set<string>()
  for (const seed of SEEDS) labels.add(labelFor(makeProfile(seed)))
  assert.ok(labels.size >= 4, `only ${labels.size} distinct labels across ${SEEDS.length} seeds`)
  for (const l of labels) {
    assert.ok(l.length >= 6 && l.length <= 40, `label "${l}" is not a readable phrase`)
    assert.ok(l === l.toUpperCase(), `label "${l}" is not in the HUD's register`)
  }
})
