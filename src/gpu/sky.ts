/** STICKMAN RISING — src/gpu/sky.ts
 * THE TWO BAKED PLATES: a stylized moon and a star field, generated on the GPU
 * once per run, with a Canvas2D fallback that is always available.
 * ----------------------------------------------------------------------------
 * Why the moon and stars, and not the whole sky: they are the two surfaces where
 * a shader is *better at the same cost* than Canvas2D. A moon is a sphere with a
 * terminator, limb darkening, craters and maria; drawn with canvas gradients it
 * is ~140 lines and about 40 fill operations, and the craters are stamped in a
 * fixed pattern. In a shader the same moon is 60 lines, costs 2 ms, and every
 * crater is procedural — so the profile's phase/tilt/tint are *physically*
 * consistent instead of three independent overdraws. The star field is one hash
 * grid: density per profile axis, brightness distribution by power law (real
 * skies have few bright stars and many faint ones), warm/cool split.
 *
 * Everything is one-shot. `bakeMoonPlate` returns a canvas; the caller blits it.
 * There is no GL state between bakes, no per-frame work, and the fallback path
 * produces the same *composition* (crescent, tilt, craters, halo) so the game
 * never looks broken on a device without WebGL2 — only less fine.
 *
 * Uniform contract: every uniform is a float except `uRes` (vec2), because the
 * bake helper only knows how to set floats and a 2-vector. Keeps the plumbing
 * honest and tiny.
 * ==========================================================================*/

import { bakeOnce, bakeOnceDeferred, makeBakeTarget, type BakeTarget } from './context'
import type { EnvironmentProfile } from '../game/world/profile'
import type { MoodPalette } from '../game/world/mood'

export interface Plate {
  canvas: HTMLCanvasElement
  ms: number
  source: 'gpu' | 'cpu'
  /** Populated when the GPU path was attempted and declined. */
  note?: string
}

const TAU = Math.PI * 2

/* ------------------------------- shaders ------------------------------- */

/** Horizontal-only shared helpers: hash, value noise, fbm. */
const NOISE = `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`

export const MOON_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uPhase;    // 0 crescent .. 1 full
uniform float uTilt;     // radians, rotates the terminator
uniform float uTint;     // 0 bone .. 1 palette-dyed
uniform float uCorona;   // scattering strength
uniform float uSeed;
// Palette colours arrive as nine floats and are assembled here: the bake helper
// only sets scalars, which keeps the uniform plumbing to one code path.
uniform float uWarmX; uniform float uWarmY; uniform float uWarmZ;
uniform float uCoolX; uniform float uCoolY; uniform float uCoolZ;
uniform float uPopX;  uniform float uPopY;  uniform float uPopZ;
${NOISE}
void main(){
  vec3 uWarm = vec3(uWarmX, uWarmY, uWarmZ);
  vec3 uCool = vec3(uCoolX, uCoolY, uCoolZ);
  vec3 uPop  = vec3(uPopX,  uPopY,  uPopZ);
  // Height-normalised coordinates, so the disc is round at any aspect.
  vec2 c = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float R = 0.285;
  float d = length(c);
  float disc = 1.0 - smoothstep(R - 0.004, R + 0.004, d);

  // ---- sphere normal + key light -------------------------------------
  float z = sqrt(max(0.0, 1.0 - min(1.0, d / R) * min(1.0, d / R)));
  vec3 n = vec3(c / R, z);
  // Light direction: the tilt rotates it in screen space, the phase pushes it
  // toward the viewer. phase 0.12 = a crescent whose limb still has earthshine.
  float lz = mix(0.10, 1.0, clamp(uPhase, 0.0, 1.0));
  vec3 L = normalize(vec3(cos(uTilt), sin(uTilt), lz));
  float lambert = dot(n, L);
  float lit = smoothstep(-0.08, 0.30, lambert);

  // ---- surface: maria + crater field, both procedural ------------------
  vec2 sp = c / R * 2.2 + uSeed * 0.37;
  float maria = smoothstep(0.42, 0.62, fbm(sp * 1.7));
  float grain = fbm(sp * 9.0);
  float craters = 0.0;
  for (int i = 0; i < 2; i++) {
    float scale = i == 0 ? 7.0 : 17.0;
    vec2 gp = c / R * scale;
    vec2 cell = floor(gp);
    vec2 f = fract(gp) - 0.5;
    float h = hash21(cell + uSeed * 13.7);
    vec2 off = (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.4;
    float r = 0.10 + 0.22 * h;
    float dd = length(f - off);
    float bowl = smoothstep(r, r * 0.55, dd);
    float rim = smoothstep(r * 1.25, r * 0.95, dd) - smoothstep(r * 0.95, r * 0.8, dd);
    craters += (bowl * 0.16 - rim * 0.10) * step(0.55, h);
  }

  vec3 bone = vec3(0.953, 0.972, 0.965);
  vec3 sea  = vec3(0.345, 0.404, 0.443);
  vec3 surf = mix(bone, sea, maria * 0.55);
  surf *= 1.0 - 0.055 * grain;
  surf += craters * vec3(0.9, 0.94, 0.96);
  // palette bounce: the lit face picks up the mood's warm, the shadow the cool
  surf = mix(surf, surf * uWarm * 1.15, uTint * 0.35);
  surf = mix(surf, surf * uPop, uTint * 0.10);

  // ---- limb darkening -------------------------------------------------
  float limb = smoothstep(1.0, 0.78, d / R);
  surf *= mix(0.55, 1.0, limb);

  // ---- unlit side: earthshine, not black ------------------------------
  vec3 earth = surf * uCool * 0.20 + uPop * 0.012;
  vec3 body = mix(earth, surf, lit);

  // ---- atmosphere: a warm inner corona + a cool outer scatter ---------
  float inner = exp(-max(0.0, d - R) * 26.0);
  float outer = exp(-max(0.0, d - R) * 7.0);
  vec3 gcol = mix(uCool, uWarm, clamp(dot(normalize(vec3(c, 0.001)) , L) , 0.0, 1.0));
  vec3 corona = (gcol * inner * 0.55 + uCool * outer * 0.16) * uCorona;

  // ---- rim light + a hint of chromatic fringe -------------------------
  float rimA = smoothstep(R, R - 0.012, d) - smoothstep(R - 0.012, R - 0.03, d);
  vec3 rim = mix(uCool, uWarm, 0.5) * rimA * 0.55 * (0.4 + 0.6 * lit);

  float a = max(disc, max(inner * 0.30 * uCorona, outer * 0.10 * uCorona));
  vec3 col = body * disc + corona + rim;
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}`

export const STARS_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uDensity;   // 0..1
uniform float uWarmth;    // 0..1 fraction of warm stars
uniform float uSeed;
uniform float uFade;      // vertical fade toward the horizon
uniform float uTwinkle;   // 0..1: how much the bright stars bloom
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  // Two grids: a dense faint layer and a sparse bright layer. Real skies are
  // power-law distributed — many dim, few bright — and a single uniform grid
  // reads as noise, not as a sky.
  for (int layer = 0; layer < 2; layer++) {
    float cells = layer == 0 ? 190.0 : 52.0;
    vec2 gp = uv * vec2(cells * uRes.x / uRes.y, cells);
    vec2 id = floor(gp);
    vec2 f = fract(gp);
    float h = hash21(id + uSeed * 91.7 + float(layer) * 37.1);
    float h2 = hash21(id * 1.7 + uSeed * 13.3);
    if (h > (layer == 0 ? 0.995 - 0.09 * uDensity : 0.9965 - 0.03 * uDensity)) {
      vec2 pos = vec2(h2, hash21(id + 5.5));
      float dist = length((f - pos) * (layer == 0 ? 1.0 : 0.8));
      float mag = layer == 0 ? mix(0.12, 0.45, h2) : mix(0.55, 1.0, h2);
      float core = exp(-dist * dist * (layer == 0 ? 260.0 : 120.0));
      // Twinkle is baked, not animated: the plate is drawn once per run, so the
      // honest encoding of "a scintillating sky" is a wider, softer bloom on the
      // bright stars (a still photograph of a twinkling night looks like this).
      float glow = exp(-dist * (layer == 0 ? 26.0 : 12.0)) * (0.12 + 0.34 * uTwinkle);
      vec3 tint = mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.90, 0.76), step(1.0 - uWarmth, h2));
      col += tint * (core * mag + glow * mag * 0.5);
      alpha = max(alpha, core * mag);
    }
  }
  // horizon extinction: stars drown in the light dome near the skyline
  float vf = smoothstep(0.0, 0.55 * uFade, uv.y) * (1.0 - smoothstep(0.82 * uFade, 1.0, uv.y) * 0.55);
  fragColor = vec4(col * vf, clamp(alpha * vf, 0.0, 1.0));
}`

/* ----------------------------- uniforms ----------------------------- */

export function parseRGB(s: string): [number, number, number] {
  const parts = s.split(',').map((v) => Number(v.trim()))
  const r = Number.isFinite(parts[0]) ? parts[0] : 128
  const g = Number.isFinite(parts[1]) ? parts[1] : 128
  const b = Number.isFinite(parts[2]) ? parts[2] : 128
  return [r / 255, g / 255, b / 255]
}

export function moonUniforms(p: EnvironmentProfile, mood: MoodPalette): Array<[string, number]> {
  const warm = parseRGB(mood.highlight)
  const cool = parseRGB(mood.pop2)
  const pop = parseRGB(mood.pop)
  return [
    ['uPhase', p.moon.phase],
    ['uTilt', (p.moon.tilt * Math.PI) / 180],
    ['uTint', p.moon.tint],
    ['uCorona', p.moon.corona],
    ['uSeed', (p.seed % 1000) / 137],
    ['uWarmX', warm[0]], ['uWarmY', warm[1]], ['uWarmZ', warm[2]],
    ['uCoolX', cool[0]], ['uCoolY', cool[1]], ['uCoolZ', cool[2]],
    ['uPopX', pop[0]], ['uPopY', pop[1]], ['uPopZ', pop[2]],
  ]
}

export function starUniforms(p: EnvironmentProfile): Array<[string, number]> {
  return [
    ['uDensity', p.stars.density],
    ['uWarmth', p.stars.warmth],
    ['uSeed', (p.seed % 997) / 211],
    ['uFade', 0.85],
    ['uTwinkle', p.stars.twinkle],
  ]
}

/* ------------------------------ baking ------------------------------ */

/** Bake the stylized moon at `size` px square. The title uses Canvas 2D
 * directly; tools can still request synchronous shader output. */
export function bakeMoonPlate(p: EnvironmentProfile, mood: MoodPalette, size = 512, target?: BakeTarget, canvasOnly = false): Plate {
  const t0 = now()
  const out: { error?: string } = {}
  const r = canvasOnly ? null : bakeOnce(size, size, MOON_FRAG, moonUniforms(p, mood), out, target)
  if (r) return r
  const canvas = cpuMoon(p, mood, size, target)
  return { canvas, ms: now() - t0, source: 'cpu', note: canvasOnly ? 'Canvas 2D title' : out.error ?? 'gpu unavailable' }
}

export function bakeStarPlate(p: EnvironmentProfile, w: number, h: number, target?: BakeTarget, canvasOnly = false): Plate {
  const t0 = now()
  const out: { error?: string } = {}
  const r = canvasOnly ? null : bakeOnce(w, h, STARS_FRAG, starUniforms(p), out, target)
  if (r) return r
  const canvas = cpuStars(p, w, h, target)
  return { canvas, ms: now() - t0, source: 'cpu', note: canvasOnly ? 'Canvas 2D title' : out.error ?? 'gpu unavailable' }
}

/** Engage/Retry use the original art recipes, with one deadline for both
 * plates. If the moon couldn't use GL, don't try another context for stars. */
export async function bakeSkyPlateDeferred(kind: 'moon' | 'stars', p: EnvironmentProfile, signal: AbortSignal, target: BakeTarget, deadline: number, tryGpu = true): Promise<Plate | null> {
  if (signal.aborted) return null
  const t0 = now(), moon = kind === 'moon'
  const out: { error?: string } = {}
  const r = !tryGpu ? null : moon
    ? await bakeOnceDeferred(512, 512, MOON_FRAG, moonUniforms(p, p.mood), signal, out, target, deadline)
    : await bakeOnceDeferred(1024, 320, STARS_FRAG, starUniforms(p), signal, out, target, deadline)
  if (signal.aborted) return null
  if (r) return r
  const canvas = moon ? cpuMoon(p, p.mood, 512, target) : cpuStars(p, 1024, 320, target)
  return { canvas, ms: now() - t0, source: 'cpu', note: out.error ?? 'Canvas 2D sky' }
}

/* --------------------------- CPU fallbacks --------------------------- */

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Canvas2D moon with the same *composition* as the shader: disc, lit limb,
 *  terminator, craters, limb darkening, two-layer halo. Slower and less fine,
 *  but never absent. */
export function cpuMoon(p: EnvironmentProfile, mood: MoodPalette, S = 512, target: BakeTarget = makeBakeTarget): HTMLCanvasElement {
  const c = target(S, S)
  const g = c.getContext('2d')
  if (!g) return c
  const C = S / 2
  const R = S * 0.285
  const rng = mulberry(p.seed ^ 0x4d00d1)

  // halo
  g.globalCompositeOperation = 'lighter'
  const halo = g.createRadialGradient(C, C, R * 0.95, C, C, R * 1.9)
  halo.addColorStop(0, `rgba(${mood.pop2},${(0.16 * p.moon.corona).toFixed(3)})`)
  halo.addColorStop(0.5, `rgba(${mood.pop2},${(0.05 * p.moon.corona).toFixed(3)})`)
  halo.addColorStop(1, `rgba(${mood.pop2},0)`)
  g.fillStyle = halo
  g.fillRect(0, 0, S, S)
  g.globalCompositeOperation = 'source-over'

  // body, keyed from the tilted light side
  const la = (p.moon.tilt * Math.PI) / 180
  const kx = C + Math.cos(la) * R * 0.34
  const ky = C + Math.sin(la) * R * 0.34
  const body = g.createRadialGradient(kx, ky, R * 0.05, C, C, R)
  body.addColorStop(0, '#f4f8f6')
  body.addColorStop(0.45, '#dde7e5')
  body.addColorStop(0.8, '#a9b7bb')
  body.addColorStop(1, `rgba(${mood.shadow},0.95)`)
  g.fillStyle = body
  g.beginPath()
  g.arc(C, C, R, 0, TAU)
  g.fill()

  g.save()
  g.beginPath()
  g.arc(C, C, R, 0, TAU)
  g.clip()
  // maria
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU
    const rr = Math.sqrt(rng()) * R * 0.7
    const x = C + Math.cos(a) * rr
    const y = C + Math.sin(a) * rr
    const mr = R * (0.16 + rng() * 0.2)
    const m = g.createRadialGradient(x, y, mr * 0.2, x, y, mr)
    m.addColorStop(0, 'rgba(56,74,84,0.30)')
    m.addColorStop(1, 'rgba(60,80,90,0)')
    g.fillStyle = m
    g.beginPath()
    g.arc(x, y, mr, 0, TAU)
    g.fill()
  }
  // craters
  for (let i = 0; i < 18; i++) {
    const a = rng() * TAU
    const rr = Math.sqrt(rng()) * R * 0.86
    const x = C + Math.cos(a) * rr
    const y = C + Math.sin(a) * rr
    const rad = 2 + rng() * R * 0.1
    if (Math.hypot(x - C, y - C) + rad > R * 0.96) continue
    const bowl = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad)
    bowl.addColorStop(0, 'rgba(44,58,66,0.34)')
    bowl.addColorStop(1, 'rgba(40,54,62,0.05)')
    g.fillStyle = bowl
    g.beginPath()
    g.arc(x, y, rad, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(246,252,250,0.30)'
    g.lineWidth = Math.max(1, rad * 0.16)
    g.beginPath()
    g.arc(x, y, rad * 0.92, la - Math.PI * 0.6, la + Math.PI * 0.4)
    g.stroke()
  }
  // terminator: a shadow disc pushed toward the dark side by (1 - phase)
  const sh = (1 - p.moon.phase) * R * 1.9
  const dx = -Math.cos(la) * sh
  const dy = -Math.sin(la) * sh
  const term = g.createRadialGradient(C + dx, C + dy, R * 0.1, C + dx, C + dy, R * 1.5)
  term.addColorStop(0, 'rgba(8,14,24,0.80)')
  term.addColorStop(0.6, 'rgba(8,14,24,0.42)')
  term.addColorStop(1, 'rgba(8,14,24,0)')
  g.fillStyle = term
  g.fillRect(0, 0, S, S)
  g.restore()

  // limb darkening + palette rim
  const limb = g.createRadialGradient(C, C, R * 0.74, C, C, R)
  limb.addColorStop(0, 'rgba(0,0,0,0)')
  limb.addColorStop(1, 'rgba(6,12,20,0.44)')
  g.fillStyle = limb
  g.beginPath()
  g.arc(C, C, R, 0, TAU)
  g.fill()
  g.lineWidth = 2.2
  g.strokeStyle = `rgba(${mood.highlight},${(0.5 * Math.min(1, p.moon.corona)).toFixed(3)})`
  g.beginPath()
  g.arc(C, C, R * 0.985, la - Math.PI * 0.62, la + Math.PI * 0.42)
  g.stroke()
  return c
}

/** Canvas2D star field: same two-layer power-law grid idea, drawn as arcs. */
export function cpuStars(p: EnvironmentProfile, w: number, h: number, target: BakeTarget = makeBakeTarget): HTMLCanvasElement {
  const c = target(w, h)
  const g = c.getContext('2d')
  if (!g) return c
  const rng = mulberry(p.seed ^ 0x5701a5)
  const faint = Math.floor(320 * p.stars.density)
  const bright = Math.floor(34 * p.stars.density)
  for (let i = 0; i < faint; i++) {
    const x = rng() * w
    const y = rng() * h * 0.85
    const a = 0.10 + rng() * 0.26
    const warm = rng() < p.stars.warmth
    g.fillStyle = warm ? `rgba(255,232,196,${a.toFixed(3)})` : `rgba(208,226,255,${a.toFixed(3)})`
    g.fillRect(x, y, 1, 1)
  }
  for (let i = 0; i < bright; i++) {
    const x = rng() * w
    const y = rng() * h * 0.8
    const r = 0.9 + rng() * 1.5
    const warm = rng() < p.stars.warmth
    const core = warm ? '255,236,204' : '214,230,255'
    const gl = g.createRadialGradient(x, y, 0, x, y, r * 3.2)
    gl.addColorStop(0, `rgba(${core},0.95)`)
    gl.addColorStop(0.25, `rgba(${core},0.34)`)
    gl.addColorStop(1, `rgba(${core},0)`)
    g.fillStyle = gl
    g.beginPath()
    g.arc(x, y, r * 3.2, 0, TAU)
    g.fill()
  }
  return c
}
