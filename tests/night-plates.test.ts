/** THE BAKED-PLATE CONTRACT (docs/master/13, 21 §11).
 *
 * A shader cannot be unit-tested for beauty, but almost every way a shader
 * fails in production is mechanical, and all of those are testable without a
 * GPU:
 *  · it does not compile (GLSL ES 3.00 syntax left over from 1.00);
 *  · a uniform is declared and never provided (the silent-black-screen bug);
 *  · a uniform is provided and never declared (typo'd name = no effect);
 *  · a uniform carries NaN, which the driver turns into a black plate.
 *
 * The uniform cross-check is the highest-value test in this file: it is exactly
 * the bug that shipped in the first draft of gpu/sky.ts (three vec3 uniforms
 * that the float-only bake helper could never have set).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOON_FRAG, STARS_FRAG, moonUniforms, starUniforms, parseRGB } from '../src/gpu/sky'
import { glitterGain as _g, rimGain } from '../src/game/world/night'
import { makeProfile } from '../src/game/world/profile'

const glitterGain = _g
const PROFILES = [0, 1, 12345, 999999, 0xdeadbeef].map((s) => makeProfile(s >>> 0))

function declaredUniforms(src: string): string[] {
  const out: string[] = []
  const re = /uniform\s+(float|vec2|vec3|vec4|int|mat3|mat4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.push(m[2])
  return out
}

test('both shaders are GLSL ES 3.00 and use out parameters', t => {
  for (const [name, src] of [['MOON_FRAG', MOON_FRAG], ['STARS_FRAG', STARS_FRAG]] as const) {
    assert.ok(src.startsWith('#version 300 es'), `${name} must start with the version directive`)
    assert.match(src, /out\s+vec4\s+fragColor\s*;/)
    assert.ok(!/\bvarying\b/.test(src), `${name} uses a GLSL 1.00 varying`)
    assert.ok(!/\battribute\b/.test(src), `${name} uses a GLSL 1.00 attribute`)
    assert.ok(!/texture2D\s*\(/.test(src), `${name} uses texture2D (1.00)`)
    const open = (src.match(/\{/g) ?? []).length
    const close = (src.match(/\}/g) ?? []).length
    assert.equal(open, close, `${name} has unbalanced braces`)
    assert.match(src, /precision\s+highp\s+float\s*;/, `${name} must pin float precision`)
    void t
  }
})

test('every declared uniform is provided, and nothing extra is provided', () => {
  for (const frag of [MOON_FRAG, STARS_FRAG]) {
    const declared = new Set(declaredUniforms(frag))
    declared.add('uRes') // set by the bake helper as a vec2
    for (const p of PROFILES) {
      const provided = new Set((frag === MOON_FRAG ? moonUniforms(p, p.mood) : starUniforms(p)).map(([n]) => n))
      for (const name of declared) {
        // uRes is set by the bake helper itself (uniform2f), never by the
        // caller — a shader that needs resolution should not have to ask.
        if (name === 'uRes') continue
        assert.ok(provided.has(name), `${name} is declared but never provided (seed ${p.id})`)
      }
      for (const name of provided) {
        assert.ok(declared.has(name), `${name} is provided but not declared (seed ${p.id})`)
      }
    }
  }
})

test('no uniform is NaN, Infinity, or out of a sane band', () => {
  for (const p of PROFILES) {
    const all = [...moonUniforms(p, p.mood), ...starUniforms(p)]
    for (const [name, v] of all) {
      assert.ok(Number.isFinite(v), `${name} = ${v} for seed ${p.id}`)
      assert.ok(Math.abs(v) < 1e4, `${name} = ${v} is out of any sane band`)
    }
  }
})

test('uniform names are unique within each set (a duplicate silently wins)', () => {
  for (const p of PROFILES) {
    for (const set of [moonUniforms(p, p.mood), starUniforms(p)]) {
      const names = set.map(([n]) => n)
      assert.equal(new Set(names).size, names.length, `duplicate uniform in ${names.join(',')}`)
    }
  }
})

test('the bake is a pure function of the profile (same seed, same uniforms)', () => {
  const a = makeProfile(4242)
  const b = makeProfile(4242)
  assert.deepEqual(moonUniforms(a, a.mood), moonUniforms(b, b.mood))
  assert.deepEqual(starUniforms(a), starUniforms(b))
})

test('profile axes actually reach the shader', () => {
  // A uniform that is always the same constant means the axis is decorative.
  const phases = PROFILES.map((p) => moonUniforms(p, p.mood).find(([n]) => n === 'uPhase')![1])
  assert.ok(new Set(phases.map((v) => v.toFixed(4))).size > 1, 'uPhase never varies')
  const dens = PROFILES.map((p) => starUniforms(p).find(([n]) => n === 'uDensity')![1])
  assert.ok(new Set(dens.map((v) => v.toFixed(4))).size > 1, 'uDensity never varies')
  const tints = PROFILES.map((p) => moonUniforms(p, p.mood).find(([n]) => n === 'uTint')![1])
  assert.ok(new Set(tints.map((v) => v.toFixed(4))).size > 1, 'uTint never varies')
})

test('parseRGB survives junk without producing NaN', () => {
  assert.deepEqual(parseRGB('255,128,0'), [1, 128 / 255, 0])
  for (const junk of ['', 'x', '1', '1,2', 'a,b,c', '300,-4,12.5']) {
    const [r, g, b] = parseRGB(junk)
    assert.ok(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b), `junk ${junk} produced ${r},${g},${b}`)
  }
})

test('glitter gain rises with phase and wetness, and stays in [0,1]', () => {
  assert.ok(glitterGain(1, 1) > glitterGain(0.6, 1), 'a fuller moon glitters more')
  assert.ok(glitterGain(0.8, 1) > glitterGain(0.8, 0), 'a wetter deck glitters more')
  for (const ph of [0, 0.5, 1]) for (const wet of [0, 0.5, 1]) {
    const v = glitterGain(ph, wet)
    assert.ok(v >= 0 && v <= 1, `gain ${v} out of range`)
  }
})

test('rim gain is clamped: visible on a dark deck, never blown out', () => {
  let lo = Infinity, hi = 0
  for (let k = 0.2; k <= 2; k += 0.05) for (let n = 0; n <= 1; n += 0.1) {
    const v = rimGain(k, n)
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  assert.ok(lo >= 0.08, `floor ${lo}`)
  assert.ok(hi <= 0.5, `ceiling ${hi}`)
  assert.ok(rimGain(1.2, 1) > rimGain(0.8, 0), 'a stronger key with the player in a light is brighter')
})
