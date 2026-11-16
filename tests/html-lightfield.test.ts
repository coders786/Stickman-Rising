import test from 'node:test';
import assert from 'node:assert/strict';
import { parser } from '@shaderfrog/glsl-parser';
import {
  VERT,
  HEAD,
  NOISE_GLSL,
  FINAL_COMMON,
  WET_GLSL,
  SHADOW_BASE_FS,
  SHADOW_REDUCE_FS,
  SHADOW_GUARD_FS,
  SHADOW_GLSL,
  DIRECT_SHADOW_GLSL,
  DECK_FS,
  DECK_DIRECT_FS,
  buildNoise,
} from '../src/game/render/mountain-gl/html-gl';

/**
 * mountain.html's own function set, copied wholesale into the game. The
 * shaders are exact lifts of the reference's — this test parses every one of
 * them, so a transcription slip fails the gate instead of the user's GPU.
 */
test('html lightfield shaders parse', () => {
  // Full programs carry the version header; the fragments compose with HEAD.
  const programs: [string, string][] = [
    ['VERT', VERT],
    ['HEAD', HEAD],
    ['FINAL_COMMON', FINAL_COMMON],
    ['SHADOW_BASE_FS', SHADOW_BASE_FS],
    ['SHADOW_REDUCE_FS', SHADOW_REDUCE_FS],
    ['SHADOW_GUARD_FS', SHADOW_GUARD_FS],
    ['DECK_FS', DECK_FS],
    ['DECK_DIRECT_FS', DECK_DIRECT_FS],
  ];
  for (const [name, src] of programs) {
    assert.ok(src.includes('#version 300 es'), `${name} carries the GLSL version header`);
    assert.doesNotThrow(() => parser.parse(src), `${name} parses`);
  }
  const fragments: [string, string][] = [
    ['NOISE_GLSL', NOISE_GLSL],
    ['WET_GLSL', WET_GLSL],
    ['SHADOW_GLSL', SHADOW_GLSL],
    ['DIRECT_SHADOW_GLSL', DIRECT_SHADOW_GLSL],
  ];
  for (const [name, src] of fragments) {
    assert.doesNotThrow(() => parser.parse(HEAD + src), `${name} parses against HEAD`);
  }
});

test('mode-0 derivation: the certificate branch compiles away', () => {
  assert.ok(!DIRECT_SHADOW_GLSL.includes('u_shadowMode'), 'the direct variant has no mode branch');
  assert.ok(DIRECT_SHADOW_GLSL.includes('SHADOW_DISK[12]'), 'the twelve-ray disk survives');
  assert.equal(
    DECK_DIRECT_FS.includes(SHADOW_GLSL),
    false,
    'the deck variant swaps in the direct transport',
  );
  assert.ok(DECK_DIRECT_FS.includes(DIRECT_SHADOW_GLSL), 'the deck reads the direct transport');
});

test('the noise field: the reference\'s three-grid layout', () => {
  const bytes = buildNoise(64);
  assert.equal(bytes.length, 64 * 64 * 4, 'one RGBA byte per texel');
  assert.equal(bytes[3], 255, 'opaque');
  // Statistically uniform: not a constant field.
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum += bytes[i];
  const mean = sum / (64 * 64);
  assert.ok(mean > 100 && mean < 155, `the red grid centers near mid-gray (got ${mean.toFixed(1)})`);
});
