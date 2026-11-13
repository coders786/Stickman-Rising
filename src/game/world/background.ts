import {StormEngine} from './storm'
import {FOG} from '../render/look'
import {clamp01} from '../core/utils'
/* ============================================================================
 * STICKMAN RISING — src/game/world/background.ts
 * Self-contained parallax cyberpunk-city backdrop (rooftop-at-night stage).
 * ----------------------------------------------------------------------------
 * Contract with the caller (everything in CSS pixels — the caller owns any
 * devicePixelRatio scaling of the context):
 *   drawSky(ctx, cam)      screen-space pass, full viewport, drawn first.
 *   drawArena(ctx)         world-space pass — caller ALREADY applied
 *                          translate(w/2,h/2) · scale(zoom) · translate(-cam).
 *   drawWeather(ctx, cam)  screen-space pass drawn after world entities.
 * World conventions: ground plane is y = 0 (entities live at y <= 0), the
 * arena floor spans world x in [-150, 2750], the facade fades to black by
 * y ≈ +260, the camera hovers around y = -170 with zoom 0.85..1.3.
 *
 * Engineering notes:
 *  · All layout comes from fixed-seed mulberry32 RNGs → identical art on
 *    every run and every resize.
 *  · Every heavy layer is pre-rendered once into an offscreen canvas whose
 *    content is horizontally periodic (period 2048 layer-px); per-frame cost
 *    is a handful of drawImage blits plus tiny animated overlays. Tiles live
 *    in a resolution-independent layer space, so resize() only records the
 *    new viewport size — a rebuild would only ever be needed at resize time
 *    and would be pixel-identical, so none is performed.
 *  · Zero heap allocations in update()/draw*(): particle state lives in
 *    preallocated typed arrays, style strings/gradients are precomputed and
 *    animated overlays only blit pre-rendered sprites.
 *  · update()/draw*() are safe before resize() (defaults 1280x720).
 * ==========================================================================*/

/* ============================== public API =============================== */

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface BgCam {
  /** camera center in world coordinates */
  x: number;
  y: number;
  zoom: number;
}

export interface BackgroundRenderer {
  readonly storm:StormEngine
  onThunder:(()=>void)|null
  /** moon state, updated by drawSky: disc center (screen space) + eclipse
   *  coverage 0..1 — how much cloud mass currently sits over the disc */
  moonX:number
  moonY:number
  moonCover:number
  resize(w:number,h:number):void
  update(dt:number):void
  lightningI():number
  lightningAz():number
  drawSky(ctx:CanvasRenderingContext2D,cam:BgCam):void
  drawArena(ctx:CanvasRenderingContext2D):void
  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void
  /** moon-shaft occlusion source for the renderer's god-ray pass */
  drawShaftMask(ctx:CanvasRenderingContext2D,cam:BgCam):void
  /** wet-deck roughness plate over the reflection band */
  drawWetMask(ctx:CanvasRenderingContext2D):void
  /** typed light rig on the deck: directional pool, moon glitter lane,
   *  spot pools, steam */
  drawLightRig(ctx:CanvasRenderingContext2D,moonWorldX:number,moonWorldY:number):void
}

/* ============================ seeded RNG ================================= */

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================ tiny helpers =============================== */

const TAU = Math.PI * 2;
const TILE = 2048;              // horizontal wrap period of every city layer
const NOMINAL_Y = -170;         // usual camera height
const ARENA_X0 = -150;          // arena floor spans world x -150 .. 2750
const ARENA_X1 = 2750;
const DOOR_X = 1755;             // warm stairwell practical, world x
const ARENA_W = ARENA_X1 - ARENA_X0;
const LIP_H = 14;               // lighter metal lip band, world y 0..14
const FACADE_H = 246;           // facade band, world y 14..260
const STAR_H = 640;
const FAR_H = 480;
const MID_H = 560;
const NEAR_H = 480;
const FOG_W = 1024;
const FOG_H = 200;
const BEAM_LEN = 640;

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  return { c, g };
}

/** Rounded-rect subpath (no dependency on ctx.roundRect). */
function rrPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w * 0.5, h * 0.5);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

/* ============================ layer tuning =============================== */

interface LayerDef { f: number; vf: number; lift: number; below: string }

/** far mega-city — parallax 0.05 */
const LAY_FAR: LayerDef = { f: 0.05, vf: 0.9675, lift: -10, below: '#0a1016' };
/** mid city with neon signs — parallax 0.14 */
const LAY_MID: LayerDef = { f: 0.14, vf: 0.901, lift: -26, below: '#070d12' };
/** near-mid foreground towers — parallax 0.30 */
const LAY_NEAR: LayerDef = { f: 0.3, vf: 0.805, lift: -46, below: '#04080c' };

/** drifting fog bands: parallax, y-offset from horizon, alpha, speed, phase */
const FOG_BANDS: ReadonlyArray<{ f: number; oy: number; a: number; sp: number; ph: number }> = [
  { f: 0.1, oy: -70, a: 0.05, sp: 7, ph: 0.0 },
  { f: 0.16, oy: -16, a: 0.068, sp: -5, ph: 2.1 },
  { f: 0.22, oy: 30, a: 0.085, sp: 9, ph: 4.4 },
];

/* ============================ fixed palettes ============================= */

const SKY_BELOW = '#070d12';
const TWINK_COL = '#cfe0e8';
const BEACON_CORE = '#ff5040';
const SIGN_PANEL = '#04070a';
const SIGN_INK: ReadonlyArray<string> = ['#ff2d95', '#29e6d2', '#ffb02e', '#8d5bff', '#3fa9ff'];
const SIGN_CORE: ReadonlyArray<string> = ['#ffd7ec', '#d9fff8', '#ffe9c6', '#e8dcff', '#dcefff'];
const SIGN_BORDER: ReadonlyArray<string> = [
  'rgba(255,45,149,0.55)', 'rgba(41,230,210,0.55)', 'rgba(255,176,46,0.55)',
  'rgba(141,91,255,0.55)', 'rgba(63,169,255,0.55)',
];
const LIFT_COL: ReadonlyArray<string> = ['#ffd9a0', '#9df0e2'];
const SPARK_COL: ReadonlyArray<string> = ['#bfe9ff', '#ffd9a0', '#ff9ed8']; // moon / sodium / neon glints
const SVC_COL = '#ffb02e';
const MIST_W = 3072;           // ground-mist tiling period in world px (fogSpr × 3)
const MIST_SP = 26;            // ground-mist scroll speed, world px/s

/* ======================== animated-record shapes ========================= */

interface TwinkRec {
  x: number; y: number; ph: number; sp: number
  /** magnitude 0..1 — bright stars breathe + flare, faint stars stay calm */
  mag: number
  /** spectral tint bucket: 0 amber · 1 neutral · 2 blue-white */
  spec: number
  /** flare rhythm (sparse scintillation spikes) */
  sp2: number; ph2: number
}
interface BeaconRec { x: number; yA: number; ph: number; sp: number }
interface SignRec { x: number; yA: number; w: number; h: number; ci: number; ph: number; state: number; timer: number; next: number }
interface LiftRec { x: number; yA0: number; yA1: number; sp: number; ph: number; ci: number }
interface BeamRec { x: number; yA: number; amp: number; sp: number; ph: number }
interface PuddleRec { x: number; rx: number; ry: number; ci: number; ph: number; sp: number }
interface SparkRec { x: number; y: number; ph: number; sp: number; ci: number }
interface SvcRec { x: number; y: number; ph: number; sp: number }
interface GlyphStroke { x0: number; y0: number; x1: number; y1: number; dot: boolean }

/* ======================= static sprite pre-renders ======================= */

/** vertical sky gradient strip (stretched to 0..horizon at draw time) */
function buildSkyStrip(): HTMLCanvasElement {
  const { c, g } = makeCanvas(8, 600);
  const gr = g.createLinearGradient(0, 0, 0, 600);
  gr.addColorStop(0, '#04060f');       // deep space navy
  gr.addColorStop(0.28, '#071022');    // upper atmosphere blue
  gr.addColorStop(0.5, '#0a1626');
  gr.addColorStop(0.66, '#0f1d31');    // city glow begins to climb
  gr.addColorStop(0.8, '#172741');     // horizon glow
  gr.addColorStop(0.885, '#223352');   // bright light-pollution band
  gr.addColorStop(0.93, '#2b2f3f');    // warm smog layer over the glow
  gr.addColorStop(0.965, '#1a2130');
  gr.addColorStop(1, '#101821');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 600);
  return c;
}

/** dim moon disc + inner corona (the wide halo lives in buildMoonHalo) */
function buildMoon(): HTMLCanvasElement {
  const { c, g } = makeCanvas(220, 220);
  // tight inner corona only — the big atmospheric rings are the additive
  // halo sprite (4-ring bake), so eclipse can dim disc + halo independently
  let gr = g.createRadialGradient(110, 110, 24, 110, 110, 62);
  gr.addColorStop(0, 'rgba(168,196,208,0.20)');
  gr.addColorStop(0.5, 'rgba(140,172,192,0.08)');
  gr.addColorStop(1, 'rgba(110,140,175,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 220, 220);
  // moon body with an off-center key so the limb reads as a sphere
  gr = g.createRadialGradient(100, 100, 8, 110, 110, 47);
  gr.addColorStop(0, '#e8eef0');
  gr.addColorStop(0.55, '#c2ced2');
  gr.addColorStop(0.85, '#93a4a9');
  gr.addColorStop(1, '#7c8d92');
  g.fillStyle = gr;
  g.beginPath(); g.arc(110, 110, 47, 0, TAU); g.fill();
  // maria + craters (soft, low-contrast)
  g.fillStyle = 'rgba(66,84,88,0.16)';
  g.beginPath(); g.arc(94, 96, 10, 0, TAU); g.fill();
  g.beginPath(); g.arc(122, 128, 7, 0, TAU); g.fill();
  g.beginPath(); g.arc(130, 92, 5, 0, TAU); g.fill();
  g.beginPath(); g.arc(103, 124, 4, 0, TAU); g.fill();
  g.fillStyle = 'rgba(232,242,245,0.28)';                    // crater rims
  g.beginPath(); g.arc(94, 94, 10, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  // bright limb — the thin lit edge that sells the sphere
  g.strokeStyle = 'rgba(226,240,244,0.5)';
  g.lineWidth = 1.4;
  g.beginPath(); g.arc(110, 110, 46.2, Math.PI * 0.62, Math.PI * 1.72); g.stroke();
  // EARTHSHINE — the "old moon in the new moon's arms": sunlight bounced
  // off Earth faintly lifts the dark limb. Cool, tiny, and real.
  g.save();
  g.beginPath(); g.arc(110, 110, 46.5, 0, TAU); g.clip();
  const es = g.createRadialGradient(132, 130, 8, 128, 128, 60);
  es.addColorStop(0, 'rgba(122,144,178,0.14)');
  es.addColorStop(1, 'rgba(122,144,178,0)');
  g.fillStyle = es; g.fillRect(60, 60, 110, 110);
  g.restore();
  return c;
}

/** 4-RING MOON HALO — pre-baked additive scattering sprite (research law:
 *  glow = additive gradient sprites, never per-frame gradients, never global
 *  bloom). Four concentric falloffs with distinct color temps — tight warm
 *  corona → wide cool atmosphere — composited 'lighter' inside the bake so
 *  the energy stacks like real scattering. One additive blit at runtime. */
function buildMoonHalo(): HTMLCanvasElement {
  const { c, g } = makeCanvas(512, 512);
  const C = 256;
  const rings: ReadonlyArray<[number, string, number, number]> = [
    // [radius, rgba color, peak alpha, inner stop]
    [78, '196,218,232', 0.34, 30],
    [168, '152,184,216', 0.135, 60],
    [262, '116,154,198', 0.055, 110],
    [392, '86,124,170', 0.026, 170],
  ];
  g.globalCompositeOperation = 'lighter';
  for (const [r, col, a, inner] of rings) {
    const gr = g.createRadialGradient(C, C, inner, C, C, r);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.55, `rgba(${col},${(a * 0.42).toFixed(4)})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 512);
  }
  return c;
}

/** 22° ICE-CRYSTAL HALO RING — real atmospheric optics: rays refracting
 *  through hexagonal ice pile up at the 60°-prism minimum deviation (~22°),
 *  so the halo has a BRIGHT INNER EDGE, a red inner rim, a darker interior
 *  and a gradual outer fade. The "how is this so real" detail. */
function buildMoonRing(): HTMLCanvasElement {
  const { c, g } = makeCanvas(440, 440);
  const C = 220;
  g.globalCompositeOperation = 'lighter';
  const inner = g.createRadialGradient(C, C, 60, C, C, 176);
  inner.addColorStop(0, 'rgba(150,180,215,0)');
  inner.addColorStop(0.88, 'rgba(150,180,215,0.022)');
  inner.addColorStop(1, 'rgba(150,180,215,0)');
  g.fillStyle = inner; g.fillRect(0, 0, 440, 440);
  const rim = g.createRadialGradient(C, C, 146, C, C, 176);
  rim.addColorStop(0, 'rgba(255,120,90,0)');
  rim.addColorStop(0.82, 'rgba(255,120,90,0.1)');
  rim.addColorStop(1, 'rgba(255,120,90,0)');
  g.fillStyle = rim; g.fillRect(0, 0, 440, 440);
  const edge = g.createRadialGradient(C, C, 158, C, C, 184);
  edge.addColorStop(0, 'rgba(226,238,252,0)');
  edge.addColorStop(0.55, 'rgba(226,238,252,0.3)');
  edge.addColorStop(1, 'rgba(216,232,250,0)');
  g.fillStyle = edge; g.fillRect(0, 0, 440, 440);
  const outer = g.createRadialGradient(C, C, 176, C, C, 232);
  outer.addColorStop(0, 'rgba(160,190,224,0.085)');
  outer.addColorStop(1, 'rgba(160,190,224,0)');
  g.fillStyle = outer; g.fillRect(0, 0, 440, 440);
  return c;
}

/** CREPUSCULAR WEDGE FAN — moonlight escaping through the cloud gaps and
 *  scattering off the rain (Mie). Rays visually converge at the source, so
 *  this is a radial fan from the moon's position; the LIVE cloud deck
 *  modulates its alpha, so shafts breathe and die as banks drift (the
 *  clouds are the occluder — physically honest, one blit at runtime). */
function buildShaftFan(): HTMLCanvasElement {
  const { c, g } = makeCanvas(1024, 1024);
  const C = 512;
  g.globalCompositeOperation = 'lighter';
  const R0 = 120, R1 = 505;
  // deterministic wedge layout: angle, half-width (rad), energy
  const wedges: Array<[number, number, number]> = [];
  let ang = -Math.PI * 0.5 - 1.15;           // fan biased downward from the moon
  let seed = 7.31;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 17; i++) {
    const hw = 0.022 + rand() * 0.052;
    const gap = 0.035 + rand() * 0.16;
    const energy = 0.35 + rand() * 0.65;
    wedges.push([ang + hw, hw, energy]);
    ang += hw * 2 + gap;
    if (ang > Math.PI * 0.5 + 1.25) break;
  }
  for (const [a, hw, e] of wedges) {
    const x0 = C + Math.cos(a) * R0, y0 = C + Math.sin(a) * R0;
    const x1 = C + Math.cos(a) * R1, y1 = C + Math.sin(a) * R1;
    const nx = -Math.sin(a), ny = Math.cos(a);
    const w0 = Math.tan(hw) * R0, w1 = Math.tan(hw) * R1;
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(184,207,232,${0.32 * e})`);
    gr.addColorStop(0.35, `rgba(172,198,228,${0.2 * e})`);
    gr.addColorStop(1, 'rgba(160,190,224,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x0 + nx * w0, y0 + ny * w0);
    g.lineTo(x1 + nx * w1, y1 + ny * w1);
    g.lineTo(x1 - nx * w1, y1 - ny * w1);
    g.lineTo(x0 - nx * w0, y0 - ny * w0);
    g.closePath();
    g.fill();
  }
  return c;
}

/** MOON LIGHT PILLAR — horizontal plate ice crystals stacking like mirrors
 *  throw a vertical beam through bright sources. Rare, thin-high-cloud only,
 *  ALWAYS subtle (hard alpha ceiling: the no-disco law). */
function buildMoonPillar(): HTMLCanvasElement {
  const { c, g } = makeCanvas(110, 660);
  const beam = g.createLinearGradient(0, 0, 0, 660);
  beam.addColorStop(0, 'rgba(216,232,250,0)');
  beam.addColorStop(0.42, 'rgba(216,232,250,0.5)');
  beam.addColorStop(0.58, 'rgba(222,236,250,0.5)');
  beam.addColorStop(1, 'rgba(216,232,250,0)');
  const width = g.createLinearGradient(0, 0, 110, 0);
  width.addColorStop(0, 'rgba(0,0,0,0)');
  width.addColorStop(0.5, 'rgba(0,0,0,1)');
  width.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = beam; g.fillRect(0, 0, 110, 660);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = width; g.fillRect(0, 0, 110, 660);
  return c;
}

/** ZODIACAL / AIRGLOW BAND — the faint warm-grey sky light that real night
 *  photos always carry near the moon (dust-scattered sunlight). One soft
 *  diagonal band, additive, barely there. */
function buildZodi(): HTMLCanvasElement {
  const { c, g } = makeCanvas(640, 300);
  g.translate(320, 150); g.rotate(-0.21); g.translate(-320, -150);
  const band = g.createLinearGradient(0, 150 - 90, 0, 150 + 90);
  band.addColorStop(0, 'rgba(212,196,178,0)');
  band.addColorStop(0.5, 'rgba(212,196,178,0.09)');
  band.addColorStop(1, 'rgba(212,196,178,0)');
  g.fillStyle = band; g.fillRect(-40, 60, 720, 180);
  const fade = g.createLinearGradient(0, 0, 640, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0.15)');
  fade.addColorStop(0.35, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade; g.fillRect(0, 0, 640, 300);
  return c;
}

/** drifting CLOUD-SHADOW plate for the wet deck — soft dark masses on
 *  transparent, pre-baked, scrolled in world space. The deck's own texture
 *  lives in the arena tile; this adds slow moving light variance. */
function buildCloudShadowTile(): HTMLCanvasElement {
  const { c, g } = makeCanvas(TILE, 140);
  const rng = mulberry32(0x7c10d5);
  for (let i = 0; i < 11; i++) {
    const cx = rng() * TILE;
    const cy = 12 + rng() * 116;
    const rx = 190 + rng() * 300;
    const ry = 30 + rng() * 62;
    const a = 0.32 + rng() * 0.3;
    for (let k = -1; k <= 1; k++) {
      const x = cx + k * TILE;
      const gr = g.createRadialGradient(x, cy, 0, x, cy, rx);
      gr.addColorStop(0, `rgba(2,5,11,${a.toFixed(3)})`);
      gr.addColorStop(0.6, `rgba(2,5,11,${(a * 0.5).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(2,5,11,0)');
      g.save();
      g.scale(1, ry / rx);
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, cy * rx / ry, rx, 0, TAU); g.fill();
      g.restore();
    }
  }
  return c;
}

/** cloud blob layout of the dark tile — drives the eclipse coverage math
 *  (how much cloud mass currently sits over the moon disc). Filled once at
 *  build; lookup is O(16)/frame. */
const CLOUD_BLOBS: { x: number; y: number; r: number }[] = [];

/* ======================== storm sprite pre-renders ======================= */

/** seamless drifting cloud bank — two flavours built from one layout:
 *  DARK (source-over, the night silhouette) and LIT (additive, re-blitted
 *  while lightning scatters through the deck). Horizontally periodic. */
function buildCloudTile(lit: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(TILE, 300);
  const rng = mulberry32(0x3c19d2);
  for (let i = 0; i < 16; i++) {
    const cx = rng() * TILE;
    const cy = 60 + rng() * 170;
    const rx = 130 + rng() * 220;
    const ry = 26 + rng() * 58;
    if (!lit) CLOUD_BLOBS.push({ x: cx, y: cy, r: rx });
    const a = lit ? 0.1 + rng() * 0.12 : 0.16 + rng() * 0.16;
    const col = lit ? '168,198,236' : '16,24,40';
    for (let k = -1; k <= 1; k++) {
      const x = cx + k * TILE;
      const gr = g.createRadialGradient(x, cy, 0, x, cy, rx);
      gr.addColorStop(0, `rgba(${col},${a.toFixed(3)})`);
      gr.addColorStop(0.55, `rgba(${col},${(a * 0.55).toFixed(3)})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.save();
      g.scale(1, ry / rx);
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, cy * rx / ry, rx, 0, TAU); g.fill();
      g.restore();
    }
  }
  return c;
}

/** cheap bokeh depth-of-field: downsample, then smooth-upsample back to the
 *  original tile size (one-time build, zero per-frame cost). */
function blurTile(src: HTMLCanvasElement, down: number): HTMLCanvasElement {
  const sw = Math.max(2, Math.round(src.width / down));
  const sh = Math.max(2, Math.round(src.height / down));
  const small = makeCanvas(sw, sh);
  small.g.drawImage(src, 0, 0, sw, sh);
  const { c, g } = makeCanvas(src.width, src.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small.c, 0, 0, src.width, src.height);
  return c;
}

/** humid horizon haze band (transparent → soft → transparent, vertical) */
function buildHazeStrip(): HTMLCanvasElement {
  const { c, g } = makeCanvas(8, 150);
  const gr = g.createLinearGradient(0, 0, 0, 150);
  gr.addColorStop(0, 'rgba(150,180,200,0)');
  gr.addColorStop(0.5, 'rgba(150,180,200,0.14)');
  gr.addColorStop(1, 'rgba(150,180,200,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 150);
  return c;
}

/** soft wispy fog band, horizontally seamless (blobs wrap around) */
function buildFogSprite(): HTMLCanvasElement {
  const { c, g } = makeCanvas(FOG_W, FOG_H);
  const rng = mulberry32(0xf06b17);
  for (let i = 0; i < 9; i++) {
    const cx = rng() * FOG_W;
    const cy = 100 + (rng() - 0.5) * 46;
    const r = 70 + rng() * 100;
    const a = 0.08 + rng() * 0.09;
    for (let k = -1; k <= 1; k++) {
      const x = cx + k * FOG_W;
      const gr = g.createRadialGradient(x, cy, 0, x, cy, r);
      gr.addColorStop(0, `rgba(128,158,168,${a.toFixed(3)})`);
      gr.addColorStop(1, 'rgba(128,158,168,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, cy, r, 0, TAU); g.fill();
    }
  }
  return c;
}

/** dense rain-spray mist band, horizontally seamless — deliberately bolder
 *  than fogSpr so it stays legible when squashed onto the arena lip. */
function buildMistSprite(): HTMLCanvasElement {
  const { c, g } = makeCanvas(FOG_W, 140);
  const rng = mulberry32(0x2f6a8c11);
  for (let i = 0; i < 14; i++) {
    const cx = rng() * FOG_W;
    const cy = 70 + (rng() - 0.5) * 56;
    const r = 90 + rng() * 130;
    const a = 0.32 + rng() * 0.2;
    for (let k = -1; k <= 1; k++) {
      const x = cx + k * FOG_W;
      const gr = g.createRadialGradient(x, cy, 0, x, cy, r);
      gr.addColorStop(0, `rgba(158,186,200,${a.toFixed(3)})`);
      gr.addColorStop(1, 'rgba(158,186,200,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, cy, r, 0, TAU); g.fill();
    }
  }
  return c;
}

/** long soft searchlight beam (apex at left-center, fading to the tip) */
function buildBeamSprite(): HTMLCanvasElement {
  const { c, g } = makeCanvas(BEAM_LEN, 160);
  const gr = g.createLinearGradient(0, 0, BEAM_LEN, 0);
  gr.addColorStop(0, 'rgba(185,225,235,0.09)');
  gr.addColorStop(0.55, 'rgba(185,225,235,0.05)');
  gr.addColorStop(1, 'rgba(185,225,235,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(5, 80);
  g.lineTo(BEAM_LEN - 2, 6);
  g.lineTo(BEAM_LEN - 2, 154);
  g.closePath();
  g.fill();
  const gr2 = g.createLinearGradient(0, 0, 90, 0);        // hot core near lamp
  gr2.addColorStop(0, 'rgba(220,245,250,0.2)');
  gr2.addColorStop(1, 'rgba(220,245,250,0)');
  g.fillStyle = gr2;
  g.beginPath();
  g.moveTo(5, 80);
  g.lineTo(90, 62);
  g.lineTo(90, 98);
  g.closePath();
  g.fill();
  return c;
}

/** tiny red glow for antenna beacons */
function buildBeaconSprite(): HTMLCanvasElement {
  const { c, g } = makeCanvas(16, 16);
  const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  gr.addColorStop(0, 'rgba(255,70,55,0.55)');
  gr.addColorStop(1, 'rgba(255,70,55,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 16);
  return c;
}

/** two puddle decals (magenta / cyan neon reflections), stretched per decal */
function buildPuddleSprites(): HTMLCanvasElement[] {
  const cols: ReadonlyArray<string> = ['255,45,149', '41,230,210'];
  const out: HTMLCanvasElement[] = [];
  for (let ci = 0; ci < 2; ci++) {
    const { c, g } = makeCanvas(96, 16);
    g.save();
    g.translate(48, 8);
    g.scale(1, 0.136);                                     // squash to ellipse
    let gr = g.createRadialGradient(0, 0, 0, 0, 0, 46);
    gr.addColorStop(0, `rgba(${cols[ci]},0.3)`);
    gr.addColorStop(0.55, `rgba(${cols[ci]},0.16)`);
    gr.addColorStop(1, `rgba(${cols[ci]},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fill();
    gr = g.createLinearGradient(-30, 0, 30, 0);            // bright streak
    gr.addColorStop(0, `rgba(${cols[ci]},0)`);
    gr.addColorStop(0.5, `rgba(${cols[ci]},0.55)`);
    gr.addColorStop(1, `rgba(${cols[ci]},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
    g.restore();
    out.push(c);
  }
  return out;
}

/** abstract sci-fi glyph panel for one neon sign (no real letters) */
function buildGlyph(ci: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 48);
  const rng = mulberry32(0x9a7c00 + ci * 7919);
  const ink = SIGN_INK[ci];
  const st: GlyphStroke[] = [];
  for (let cell = 0; cell < 5; cell++) {
    const bx = 8 + cell * 24;
    const n = 3 + ((rng() * 3) | 0);
    for (let s = 0; s < n; s++) {
      const t = rng();
      if (t < 0.34) {                                       // vertical bar
        const x = bx + 3 + rng() * 15, y = 10 + rng() * 8;
        st.push({ x0: x, y0: y, x1: x, y1: y + 8 + rng() * 18, dot: false });
      } else if (t < 0.58) {                                // horizontal bar
        const y = 10 + rng() * 24, x = bx + 2 + rng() * 7;
        st.push({ x0: x, y0: y, x1: x + 8 + rng() * 11, y1: y, dot: false });
      } else if (t < 0.82) {                                // diagonal slash
        const x = bx + 2 + rng() * 9, y = 10 + rng() * 18;
        const d = (rng() < 0.5 ? -1 : 1) * (5 + rng() * 9);
        st.push({ x0: x, y0: y, x1: x + d, y1: y + 6 + rng() * 11, dot: false });
      } else {                                              // dot
        st.push({ x0: bx + 4 + rng() * 15, y0: 11 + rng() * 24, x1: 0, y1: 0, dot: true });
      }
    }
  }
  st.push({ x0: 7, y0: 43, x1: 114, y1: 43, dot: false });  // underline rail
  st.push({ x0: 120, y0: 43, x1: 0, y1: 0, dot: true });    // end pip
  const pass = (lw: number, stroke: string, blur: number, r: number): void => {
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = stroke;
    g.fillStyle = stroke;
    g.shadowColor = ink;
    g.shadowBlur = blur;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (s.dot) { g.beginPath(); g.arc(s.x0, s.y0, r, 0, TAU); g.fill(); }
      else { g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1, s.y1); g.stroke(); }
    }
  };
  pass(3.4, ink, 7, 1.8);                                   // soft neon glow
  pass(1.3, SIGN_CORE[ci], 0, 1.1);                         // bright tube core
  g.shadowBlur = 0;
  return c;
}

/* ================================ class ================================== */

export class CyberBackground {
  /* viewport (CSS px) — safe defaults so draws work before resize() */
  private vw = 1280;
  private vh = 720;

  /* clock + ambient wind */
  private t = 0;
  private fogCount = 3;

  /* pre-rendered art (built once, resolution independent) */
  private built = false;
  private skyStrip!: HTMLCanvasElement;
  private starTile!: HTMLCanvasElement;
  private moonSpr!: HTMLCanvasElement;
  private moonHalo!: HTMLCanvasElement;   // 4-ring additive scattering bake
  private farTile!: HTMLCanvasElement;
  private midTile!: HTMLCanvasElement;
  private nearTile!: HTMLCanvasElement;
  private arenaTile!: HTMLCanvasElement;
  private cloudDark!: HTMLCanvasElement;   // drifting night cloud deck
  private cloudLit!: HTMLCanvasElement;    // same deck, lightning-lit flavour
  private cloudShadowSpr!: HTMLCanvasElement; // drifting deck-shadow plates
  private wetMask!: HTMLCanvasElement;    // static wet-deck roughness plate
  private doorSpr!: HTMLCanvasElement;    // stairwell head-house + warm door
  private doorPool!: HTMLCanvasElement;   // warm pool the door spills
  private moonGlitter!: HTMLCanvasElement; // specular lane of the moon key
  private moonRing!: HTMLCanvasElement;    // 22° ice-crystal halo ring
  private shaftFan!: HTMLCanvasElement;    // crepuscular wedge fan (gap rays)
  private moonPillar!: HTMLCanvasElement;  // plate-crystal light pillar
  private zodiSpr!: HTMLCanvasElement;     // zodiacal / airglow band
  /** live fresnel-lane glints that dance along the moon's specular lane */
  private glints: { x: number; y: number; w: number; ph: number; sp: number; c: number }[] = [];
  private deckPool!: HTMLCanvasElement;   // directional key's diffuse wash
  private spotPool!: HTMLCanvasElement;   // spot-cone cross section
  private steamSpr!: HTMLCanvasElement;   // vent steam wisps
  /** moon state for the render pass (updated by drawSky): screen-space disc
   *  center + eclipse coverage 0..1 (how much cloud mass sits over it) */
  moonX = 0;
  moonY = 0;
  moonCover = 0;
  private fogSpr!: HTMLCanvasElement;
  private mistSpr!: HTMLCanvasElement;    // denser ground mist (rain spray)
  private beamSpr!: HTMLCanvasElement;
  private beaconSpr!: HTMLCanvasElement;
  private puddleSpr: HTMLCanvasElement[] = [];
  private glyphSpr: HTMLCanvasElement[] = [];

  /* animated overlay records (filled during the one-time build) */
  private twinks: TwinkRec[] = [];
  private beacons: BeaconRec[] = [];
  private signs: SignRec[] = [];
  private lifts: LiftRec[] = [];
  private beams: BeamRec[] = [];
  private puddles: PuddleRec[] = [];
  private puddleA = new Float32Array(0);
  private sparks: SparkRec[] = [];   // wet-lip glints (city light caught in the rain film)
  private svcLights: SvcRec[] = [];

  /** City art consumes a persistent external weather service. */
  readonly storm:StormEngine;
  private get gust(){return this.storm.gust}
  private hazeSpr: HTMLCanvasElement | null = null;   // humid horizon haze strip

  /* depth-of-field variants of the city tiles (pre-blurred once) */
  private farTileBlur!: HTMLCanvasElement;
  private midTileBlur!: HTMLCanvasElement;

  private q: Quality;

  get onThunder(){return this.storm.onThunder}
  set onThunder(cb:(()=>void)|null){this.storm.onThunder=cb}
  constructor(quality:Quality,storm=new StormEngine(quality)){
    this.q=quality;this.storm=storm;this.fogCount=quality==='low'?2:3;
  }

  /** CSS-pixel size of the game canvas viewport. */
  resize(w: number, h: number): void {
    this.storm.resize(w,h);
    this.vw = w > 0 ? w : 1;
    this.vh = h > 0 ? h : 1;
    // All art is pre-rendered in a fixed layer space from a fixed seed, so a
    // resize only changes the viewport dims — the layout stays identical and
    // no tile ever needs re-rendering.
  }

  /** advance ambient animation; dt in seconds (clamped internally). */
  update(dt: number): void {
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.t += d;
    const t = this.t;
    /* neon-sign buzz / brown-out / re-ignite state machines */
    for (let i = 0; i < this.signs.length; i++) {
      const s = this.signs[i];
      if (s.state === 0) {
        s.next -= d;
        if (s.next <= 0) { s.state = 1; s.timer = 0.45 + Math.random() * 1.05; }
      } else if (s.state === 1) {
        s.timer -= d;
        if (s.timer <= 0) { s.state = 2; s.timer = 0.4; }
      } else {
        s.timer -= d;
        if (s.timer <= 0) { s.state = 0; s.next = 5 + Math.random() * 9; }
      }
    }

    /* puddle shimmer envelopes (consumed by drawArena) */
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i];
      this.puddleA[i] = 0.5 + 0.28 * Math.sin(t * p.sp + p.ph) + 0.1 * Math.sin(t * p.sp * 2.7 + p.ph * 2);
    }

  }

  lightningI():number{return this.storm.intensity}
  lightningAz():number{return this.storm.azimuthValue}

  /* ------------------------ screen-space sky pass ------------------------ */

  drawSky(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensureBuilt();
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y;
    const cz = Number.isFinite(cam.zoom) ? cam.zoom : 1;
    const w = this.vw, h = this.vh, t = this.t;

    ctx.save();

    /* 1 — sky gradient anchored to the world ground line */
    const hy = h * 0.5 + (0 - cy) * cz;                     // screen y of world y=0
    /* one fog band at a time — called BETWEEN the parallax planes so the
     * fog reads as a volume at each depth (aerial perspective), not as a
     * curtain in front of the whole skyline */
    const fogBand = (i: number) => {
      if (i >= this.fogCount) return;
      const F = FOG_BANDS[i];
      const fy = hy + F.oy - (cy - NOMINAL_Y) * 0.15 * cz;
      ctx.globalAlpha = F.a * (0.85 + 0.15 * Math.sin(t * 0.05 + F.ph)) * (1 + 1.2 * this.lightningI());
      const off = mod(t * F.sp - cx * F.f * cz, FOG_W);
      for (let x = off - FOG_W; x < w; x += FOG_W) {
        ctx.drawImage(this.fogSpr, x, fy - FOG_H * 0.5);
      }
      ctx.globalAlpha = 1;
    };
    const skyH = hy > 1 ? (hy < h ? hy : h) : 1;
    ctx.drawImage(this.skyStrip, 0, 0, 8, 600, 0, 0, w, skyH);
    ctx.fillStyle = SKY_BELOW;
    this.fillBelow(ctx, hy);

    /* 1.5 — CITY LIGHT-POLLUTION GLOW: the megapolis below breathes color
     * up into the cloud deck — cool electric blue at altitude, warm sodium
     * and magenta neon right at the skyline. Additive; towers occlude it. */
    {
      const I0 = this.lightningI();
      const pg = ctx.createLinearGradient(0, hy - 210, 0, hy + 6);
      pg.addColorStop(0, 'rgba(40,70,140,0)');
      pg.addColorStop(0.55, `rgba(46,78,152,${(0.075 + I0 * 0.06).toFixed(3)})`);
      pg.addColorStop(0.84, `rgba(122,64,150,${(0.1 + I0 * 0.05).toFixed(3)})`);
      pg.addColorStop(1, `rgba(255,116,84,${(0.115 + I0 * 0.05).toFixed(3)})`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pg;
      ctx.fillRect(0, hy - 210, w, 216);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 2 — stars + moon (celestial parallax) */
    const starBase = hy - 70 > h * 0.25 ? hy - 70 : h * 0.25;
    const ms = mod(cx * 0.02 * cz, TILE);
    this.blitRow(ctx, this.starTile, ms, starBase - STAR_H);
    // STAR SCINTILLATION (atmospheric turbulence): each star flickers on
    // its OWN persistent rhythm — bright stars breathe gently and rare
    // flare spikes fire (pow curve keeps simultaneous twinkles sparse),
    // faint stars stay calm; per-star spectral tint (amber → blue-white).
    const TWINK_TINTS = ['#ffd9b0', '#dfe7f2', '#cfe0ff'];
    let curSpec = -1;
    for (let i = 0; i < this.twinks.length; i++) {
      const tr = this.twinks[i];
      if (tr.spec !== curSpec) { curSpec = tr.spec; ctx.fillStyle = TWINK_TINTS[curSpec]; }
      const breathe = 0.86 + 0.14 * Math.sin(t * tr.sp + tr.ph);
      const flare = tr.mag > 0.55 ? 0.12 * Math.pow(Math.max(0, Math.sin(t * tr.sp2 + tr.ph2)), 6) * tr.mag : 0;
      ctx.globalAlpha = clamp01((0.22 + 0.5 * tr.mag) * breathe + flare);
      const sy = starBase - STAR_H + tr.y;
      for (let x = mod(tr.x - ms, TILE) - TILE; x < w + 3; x += TILE) {
        if (x > -3) ctx.fillRect(x, sy, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    /* 2.5 — DRIFTING CLOUD DECKS: three parallax sheets (high slow thin /
     * main bank / low fast wisps). While lightning scatters through them the
     * LIT twin re-blits additively on the lower two decks. Behind skyline. */
    {
      const Ic = this.lightningI();
      const cloudY = hy * 0.16 - 40 - (cy - NOMINAL_Y) * 0.06 * cz;
      const offA = mod(-t * 3.2 - cx * 0.013 * cz, TILE);
      const offB = mod(-t * 5 - cx * 0.02 * cz, TILE);
      const offC = mod(-t * 8.4 - cx * 0.03 * cz, TILE);
      ctx.globalAlpha = 0.5;
      this.blitRow(ctx, this.cloudDark, offA, cloudY - 84);
      ctx.globalAlpha = 0.72;
      this.blitRow(ctx, this.cloudDark, offB, cloudY);
      ctx.globalAlpha = 0.44;
      this.blitRow(ctx, this.cloudDark, offC, cloudY + 104);
      ctx.globalAlpha = 1;
      if (Ic > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, Ic * 0.85);
        this.blitRow(ctx, this.cloudLit, offB, cloudY);
        ctx.globalAlpha = Math.min(1, Ic * 0.6);
        this.blitRow(ctx, this.cloudLit, offC, cloudY + 104);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }

    /* 2.8 — THE MOON (deep sky, BEHIND the city: the skyline occludes it,
     * never the other way around — a distant celestial body, not a disco
     * ball hanging in front of the towers). ECLIPSE: the drifting cloud
     * deck modulates disc + halo + the key light below. Halo tamed to
     * ~45% of the old bloom radius. */
    {
      const moonX = w * 0.87 - cx * 0.03 * cz - 84;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - 84;
      const clOff2 = mod(-t * 5 - cx * 0.02 * cz, TILE);
      const cloudY2 = hy * 0.16 - 40 - (cy - NOMINAL_Y) * 0.06 * cz;
      // eclipse coverage: O(16) blob falloff around the disc's tile x
      let cov = 0;
      const mxT = mod(moonX + 84 - clOff2, TILE);
      for (const b of CLOUD_BLOBS) {
        let dx = Math.abs(b.x - mxT);
        if (dx > TILE / 2) dx = TILE - dx;
        const wgt = Math.max(0, 1 - dx / (b.r * 1.12));
        cov += wgt * wgt * 0.62;
      }
      if (cov > 1) cov = 1;
      this.moonX = moonX + 84;
      this.moonY = moonY + 84;
      this.moonCover = cov;
      const discA = 1 - 0.52 * cov;
      const haloA = (1 - 0.78 * cov) * (0.82 + 0.18 * Math.sin(t * 0.13));
      const haloA2 = (1 - 0.78 * cov) * (0.7 + 0.3 * Math.sin(t * 0.087 + 1.7));
      ctx.globalAlpha = discA;
      ctx.drawImage(this.moonSpr, moonX, moonY, 168, 168);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = haloA * 0.78;
      ctx.drawImage(this.moonHalo, moonX + 84 - 141, moonY + 84 - 141, 282, 282);
      ctx.globalAlpha = haloA2 * 0.32;
      ctx.drawImage(this.moonHalo, moonX + 84 - 184, moonY + 84 - 184, 368, 368);
      // 22° ice-crystal halo ring — the physical optics detail
      ctx.globalAlpha = haloA * 0.9;
      ctx.drawImage(this.moonRing, moonX + 84 - 280, moonY + 84 - 280, 560, 560);
      // ZODIACAL / AIRGLOW — the warm dust band real night photos carry
      ctx.globalAlpha = 0.75 * (1 - 0.5 * cov);
      ctx.drawImage(this.zodiSpr, moonX + 84 - 330, moonY + 84 - 220, 660, 310);
      // PLATE-CRYSTAL LIGHT PILLAR — thin high clouds only, hard ceiling
      const pillA = haloA * clamp01(1 - 1.55 * cov) * 0.055;
      if (pillA > 0.004) {
        ctx.globalAlpha = pillA;
        ctx.drawImage(this.moonPillar, moonX + 84 - 55, moonY + 84 - 330, 110, 660);
      }
      ctx.globalCompositeOperation = 'source-over';
      // the cloud cage over the disc thickens with coverage
      ctx.globalAlpha = 0.34 + 0.3 * cov;
      this.blitRow(ctx, this.cloudDark, clOff2, cloudY2);
      ctx.globalAlpha = 1;
    }

    /* 3 — far mega-city (parallax 0.05) + blinking antenna beacons.
     * Far layer draws from its pre-blurred DOF variant (rainy-night bokeh);
     * during a strike the sharp tile re-blits additively → silhouette pop. */
    const I = this.lightningI();
    const byF = h * 0.5 + (LAY_FAR.lift - cy * LAY_FAR.vf) * cz;
    const mF = mod(cx * LAY_FAR.f * cz, TILE);
    ctx.fillStyle = LAY_FAR.below;
    this.fillBelow(ctx, byF);
    this.blitRow(ctx, this.farTileBlur, mF, byF - FAR_H);
    if (I > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 * I;
      this.blitRow(ctx, this.farTile, mF, byF - FAR_H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = BEACON_CORE;
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      const s = Math.max(0, Math.sin(t * b.sp + b.ph));
      const a = 0.1 + 0.9 * s * s * s * s;                 // slow soft blink
      const by = byF - b.yA;
      for (let x = mod(b.x - mF, TILE) - TILE; x < w + 8; x += TILE) {
        if (x < -8 || x > w + 8) continue;
        ctx.globalAlpha = a * 0.55;
        ctx.drawImage(this.beaconSpr, x - 8, by - 8);
        ctx.globalAlpha = a + 0.2 > 1 ? 1 : a + 0.2;
        ctx.fillRect(x - 1, by - 1, 2, 2);
      }
    }
    ctx.globalAlpha = 1;

    fogBand(0);   // deep haze plane between the far city and the mid city

    /* 4 — mid city (parallax 0.14, softly defocused) + flickering neon signs */
    const byM = h * 0.5 + (LAY_MID.lift - cy * LAY_MID.vf) * cz;
    const mM = mod(cx * LAY_MID.f * cz, TILE);
    ctx.fillStyle = LAY_MID.below;
    this.fillBelow(ctx, byM);
    this.blitRow(ctx, this.midTileBlur, mM, byM - MID_H);
    if (I > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.14 * I;
      this.blitRow(ctx, this.midTile, mM, byM - MID_H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.storm.drawSky(ctx);
    ctx.lineWidth = 1;
    for (let i = 0; i < this.signs.length; i++) {
      const s = this.signs[i];
      let mul = 1;
      if (s.state === 1) mul = 0.07 + 0.05 * Math.sin(t * 41 + s.ph);            // brown-out
      else if (s.state === 2) {                                                  // re-ignite
        const k = 1 - s.timer / 0.4;
        mul = k * (0.35 + 0.65 * Math.abs(Math.sin(t * 66 + s.ph)));
      }
      let a = mul * (0.72 + 0.19 * Math.sin(t * 31 + s.ph) + 0.09 * Math.sin(t * 97 + s.ph * 3));
      if (a < 0.03) a = 0.03;
      else if (a > 1) a = 1;
      const y0 = byM - s.yA;
      const iw = s.w - 10, ih = s.h - 10;
      for (let x = mod(s.x - s.w * 0.5 - mM, TILE) - TILE; x < w + 4; x += TILE) {
        if (x + s.w < -4 || x > w + 4) continue;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = SIGN_PANEL;
        rrPath(ctx, x, y0, s.w, s.h, 4);
        ctx.fill();
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = SIGN_BORDER[s.ci];
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';          // fake bloom
        ctx.globalAlpha = a * 0.18;
        ctx.drawImage(this.glyphSpr[s.ci], x + 5 - iw * 0.72, y0 + 5 - ih * 0.95, iw * 2.44, ih * 2.9);
        ctx.globalAlpha = a * 0.32;
        ctx.drawImage(this.glyphSpr[s.ci], x + 5 - iw * 0.38, y0 + 5 - ih * 0.45, iw * 1.76, ih * 1.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
        ctx.drawImage(this.glyphSpr[s.ci], x + 5, y0 + 5, iw, ih);
      }
    }
    ctx.globalAlpha = 1;

    /* 4.5 — humid horizon haze: thick soft band around the ground line that
     * the near towers cut through (depth separation before layer 5) */
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.07);
    ctx.drawImage(this.hazeSpr!, 0, hy - 96, w, 150);
    ctx.globalAlpha = 1;

    fogBand(1);   // mid haze plane between the mid city and the near towers

    /* 5 — near-mid towers (parallax 0.30): elevator dots + searchlights */
    const byN = h * 0.5 + (LAY_NEAR.lift - cy * LAY_NEAR.vf) * cz;
    const mN = mod(cx * LAY_NEAR.f * cz, TILE);
    ctx.fillStyle = LAY_NEAR.below;
    this.fillBelow(ctx, byN);
    this.blitRow(ctx, this.nearTile, mN, byN - NEAR_H);
    if (I > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 * I;
      this.blitRow(ctx, this.nearTile, mN, byN - NEAR_H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < this.lifts.length; i++) {
      const L = this.lifts[i];
      const v = t * L.sp + L.ph;
      const u = v - Math.floor(v);
      const tri = 1 - Math.abs(u * 2 - 1);                // ping-pong travel
      const sy = byN - (L.yA1 + (L.yA0 - L.yA1) * tri);
      ctx.fillStyle = LIFT_COL[L.ci];
      for (let x = mod(L.x - mN, TILE) - TILE; x < w + 4; x += TILE) {
        if (x < -4) continue;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x - 1, sy - 2, 2, 3);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x - 0.5, sy - 9, 1, 10);
      }
    }
    ctx.globalCompositeOperation = 'lighter';             // sweeping searchlights
    for (let i = 0; i < this.beams.length; i++) {
      const B = this.beams[i];
      const ang = -Math.PI * 0.5 + B.amp * Math.sin(t * B.sp + B.ph);
      const pulse = 0.55 + 0.45 * Math.sin(t * 0.43 + B.ph * 2.3);
      const by = byN - B.yA;
      for (let x = mod(B.x - mN, TILE) - TILE; x < w + 8; x += TILE) {
        if (x < -BEAM_LEN - 8 || x > w + BEAM_LEN + 8) continue;
        ctx.save();
        ctx.translate(x, by);
        ctx.rotate(ang);
        ctx.globalAlpha = pulse;
        ctx.drawImage(this.beamSpr, 0, -80);
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    /* 6 — front fog band (bands 0/1 already interleaved between the depth
     * planes above — fog is a volume BETWEEN depths, not one curtain) */
    fogBand(2);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ----------------------- world-space arena pass ------------------------ */

  drawArena(ctx: CanvasRenderingContext2D): void {
    this.ensureBuilt();
    const t = this.t;
    ctx.drawImage(this.arenaTile, ARENA_X0, 0);            // lip + facade (y 0..260)
    // STAIRWELL PRACTICAL — warm head-house + breathing pool (additive)
    ctx.drawImage(this.doorSpr, DOOR_X - 100, -172);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 + 0.05 * Math.sin(t * 0.11) + 0.06 * this.lightningI();
    ctx.drawImage(this.doorPool, DOOR_X - 260, -68);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // shimmering neon puddles
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i];
      let a = this.puddleA[i];
      if (!(a >= 0.12)) a = 0.12;
      ctx.globalAlpha = a;
      ctx.drawImage(this.puddleSpr[p.ci], p.x - p.rx, 7.5 - p.ry, p.rx * 2, p.ry * 2);
    }
    // twinkling wet-lip glints — the rain film catches moon and neon as
    // slow sparkle points that breathe across the metal
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const a = tw * tw * tw;
      if (a < 0.06) continue;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = SPARK_COL[s.ci];
      ctx.fillRect(s.x - 1.4, s.y - 0.6, 2.8, 1.2);
      ctx.globalAlpha = a * 0.22;
      ctx.fillRect(s.x - 3, s.y - 1.8, 6, 3.6);
    }
    // ground mist hugging the arena lip — two counter-scrolling soft bands,
    // density riding the wind gust, lit up when lightning scatters through
    if (this.q !== 'low') {
      const I = this.lightningI();
      const s1 = mod(t * MIST_SP, MIST_W);
      const s2 = mod(1024 - t * MIST_SP * 0.55, MIST_W);
      let a1 = (0.22 + 0.12 * this.gust) * (1 + 1.6 * I);
      if (a1 > 0.52) a1 = 0.52;
      ctx.globalAlpha = a1;
      for (let x = ARENA_X0 - MIST_W + s1; x < ARENA_X1; x += MIST_W) {
        ctx.drawImage(this.mistSpr, x, -34, MIST_W, 62);
      }
      ctx.globalAlpha = a1 * 0.7;
      for (let x = ARENA_X0 - MIST_W + s2; x < ARENA_X1; x += MIST_W) {
        ctx.drawImage(this.mistSpr, x, -6, MIST_W, 44);
      }
    }
    // drifting CLOUD SHADOWS on the wet deck — pre-baked dark plates with
    // slow parallax drift; the eclipse deepens them as banks cross the moon
    if (this.q !== 'low') {
      const csOff = mod(t * 26, TILE);
      ctx.globalAlpha = 0.18 + 0.12 * this.moonCover;
      for (let x = ARENA_X0 - TILE + csOff; x < ARENA_X1; x += TILE) {
        ctx.drawImage(this.cloudShadowSpr, x, -34, TILE, 140);
      }
      ctx.globalAlpha = 1;
    }
    // tiny blinking facade service lamps
    ctx.fillStyle = SVC_COL;
    for (let i = 0; i < this.svcLights.length; i++) {
      const L = this.svcLights[i];
      const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * L.sp + L.ph));
      ctx.globalAlpha = a;
      ctx.fillRect(L.x - 1, L.y - 1, 2, 2);
      ctx.globalAlpha = a * 0.3;
      ctx.fillRect(L.x - 2.5, L.y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------- screen-space weather pass ---------------------- */

  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void{
    this.storm.setView(cam);
    this.storm.drawRain(ctx);
  }

  /** TYPED LIGHT RIG on the deck (UE archetypes): directional key's diffuse
   *  pool (the lit surface shadows read against), the moon's specular
   *  glitter lane (the ray-traced wet look), two sweeping spot pools, and
   *  vent steam. moonWorldX = where the moon's reflection lane lands. */
  drawLightRig(ctx: CanvasRenderingContext2D, moonWorldX: number, moonWorldY: number): void {
    this.ensureBuilt();
    const t = this.t, cov = this.moonCover, li = this.lightningI();
    // CREPUSCULAR GAP RAYS — moonlight escaping the cloud deck scatters off
    // the rain (Mie). The drifting clouds ARE the occluder: coverage gates
    // the shafts, so they breathe/die as banks cross the disc. Drawn here —
    // after the skyline (atmospheric volume crosses in front of buildings),
    // before the pools (the deck's own diffuse term covers their landing).
    const shaftA = clamp01((0.55 - cov) * 1.8) * (0.8 + 0.2 * Math.sin(t * 0.23)) * 0.14 * (1 - Math.min(1, li * 1.3));
    if (shaftA > 0.004) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shaftA;
      ctx.drawImage(this.shaftFan, moonWorldX - 700, moonWorldY - 700, 1400, 1400);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // DIRECTIONAL — diffuse pool on the deck (under everything else).
    // Target-art calibration (image-2.png): shadows only read DRAMATICALLY
    // against a BRIGHT moonlit deck — this pool is the key's diffuse term.
    ctx.globalAlpha = (0.58 + 0.22 * li) * (1 - 0.5 * cov);
    ctx.drawImage(this.deckPool, ARENA_X0, -10, ARENA_W, 150);
    ctx.globalAlpha = 1;
    // LIGHT TRANSPORT — the door practical's warm bounce: scattered light
    // spreads wider and dimmer than the direct pool
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.13 * (1 - 0.4 * cov);
    ctx.drawImage(this.doorPool, DOOR_X - 430, -46, 860, 130);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // steam wisps (behind the specular layers)
    for (let i = 0; i < 3; i++) {
      const sx = 300 + i * 860;
      const rise = mod(t * (14 + i * 3) + i * 97, 190);
      const sway = Math.sin(t * 0.5 + i * 2.1) * 14;
      ctx.globalAlpha = 0.5 * (1 - rise / 190);
      ctx.drawImage(this.steamSpr, sx + sway - 60, -rise - 20);
    }
    ctx.globalAlpha = 1;
    // SPECULAR — the moon's fresnel glitter lane on the wet mirror: dual-
    // drift shimmer (two micro-facet fields interfering) + live glints that
    // dance along the lane. The FRESNEL law (brighter/denser toward the
    // grazing edge) is baked into the plate.
    ctx.globalCompositeOperation = 'lighter';
    const glA = (0.34 + 0.18 * li) * (1 - 0.72 * cov);
    const w1 = Math.sin(t * 2.1) * 2.4, w2 = Math.sin(t * 3.7 + 1.3) * 1.7;
    ctx.globalAlpha = glA;
    ctx.drawImage(this.moonGlitter, moonWorldX - 190 + w1, -10, 380, 160);
    ctx.globalAlpha = glA * 0.55;
    ctx.drawImage(this.moonGlitter, moonWorldX - 190 + w2, -10, 380, 160);
    for (let i = 0; i < this.glints.length; i++) {
      const gl = this.glints[i];
      const tw = 0.5 + 0.5 * Math.sin(t * gl.sp + gl.ph);
      const a = tw * tw * glA * 1.5;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = gl.c === 0 ? '#dceafc' : '#ffe9c8';
      ctx.fillRect(moonWorldX - 190 + gl.x, gl.y, gl.w, 1.4);
    }
    // SPOT — slow-sweeping cool pools (cone cross-sections)
    const sx1 = 560 + 150 * Math.sin(t * 0.21);
    const sx2 = 2260 + 180 * Math.sin(t * 0.17 + 2);
    ctx.globalAlpha = 0.3 * (1 - 0.4 * cov);
    ctx.drawImage(this.spotPool, sx1 - 170, -8, 340, 120);
    ctx.drawImage(this.spotPool, sx2 - 170, -8, 340, 120);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** WET-DECK ROUGHNESS — one static plate over the mirror band: matte
   *  dry islands + micro-striation chop the reflection, sharp puddle
   *  windows let it through with moonlit rims. */
  drawWetMask(ctx: CanvasRenderingContext2D): void {
    this.ensureBuilt();
    // strict deck band: the wet layer lives below the foot line only
    ctx.drawImage(this.wetMask, ARENA_X0, 12, ARENA_W, 142);
  }

  /** MOON-SHAFT OCCLUSION SOURCE — drawn into a scaled quarter-res ctx by
   *  the renderer's god-ray pass: moon glow bright, near skyline + cloud
   *  decks dark. The radial smear then streaks the sky gaps outward as
   *  shafts (GPU Gems 3 occlusion→radial-blur recipe, 2D style). Note the
   *  mask obeys light PHYSICS (towers in front of the glow) even though the
   *  painted moon floats over the skyline. */
  drawShaftMask(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y;
    const cz = Number.isFinite(cam.zoom) ? cam.zoom : 1;
    const t = this.t;
    const w = this.vw, h = this.vh;
    const hy = h * 0.5 + (0 - cy) * cz;
    const moonX = w * 0.87 - cx * 0.03 * cz - 110;
    const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - 110;
    ctx.drawImage(this.moonSpr, moonX, moonY);
    ctx.drawImage(this.moonHalo, moonX + 110 - 256, moonY + 110 - 256);
    // extra wide bright pool so the smear has source mass for long shafts
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.moonHalo, moonX + 110 - 384, moonY + 110 - 384, 768, 768);
    ctx.globalAlpha = 1;
    const byN = h * 0.5 + (LAY_NEAR.lift - cy * LAY_NEAR.vf) * cz;
    const mN = mod(cx * LAY_NEAR.f * cz, TILE);
    this.blitRow(ctx, this.nearTile, mN, byN - NEAR_H);
    const cloudY = hy * 0.16 - 40 - (cy - NOMINAL_Y) * 0.06 * cz;
    const offB = mod(-t * 5 - cx * 0.02 * cz, TILE);
    const offC = mod(-t * 8.4 - cx * 0.03 * cz, TILE);
    ctx.globalAlpha = 0.85;
    this.blitRow(ctx, this.cloudDark, offB, cloudY);
    ctx.globalAlpha = 0.7;
    this.blitRow(ctx, this.cloudDark, offC, cloudY + 104);
    ctx.globalAlpha = 1;
  }

  /* --------------------------- private helpers --------------------------- */

  /** screen-space baseline of a parallax layer for the current camera */
  private fillBelow(ctx: CanvasRenderingContext2D, y: number): void {
    const yy = y > 0 ? y : 0;
    if (yy < this.vh) ctx.fillRect(0, yy, this.vw, this.vh - yy);
  }

  private blitRow(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, m: number, y: number): void {
    for (let x = -m; x < this.vw; x += TILE) ctx.drawImage(img, x, y);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.skyStrip = buildSkyStrip();
    this.moonSpr = buildMoon();
    this.moonHalo = buildMoonHalo();
    this.moonRing = buildMoonRing();
    this.shaftFan = buildShaftFan();
    this.moonPillar = buildMoonPillar();
    this.zodiSpr = buildZodi();
    this.cloudShadowSpr = buildCloudShadowTile();
    this.doorSpr = this.buildDoorStructure();
    this.doorPool = this.buildDoorPool();
    this.moonGlitter = this.buildMoonGlitter();
    this.deckPool = this.buildDeckPool();
    this.spotPool = this.buildSpotPool();
    this.steamSpr = this.buildSteamWisp();
    this.fogSpr = buildFogSprite();
    this.mistSpr = buildMistSprite();
    this.beamSpr = buildBeamSprite();
    this.beaconSpr = buildBeaconSprite();
    this.puddleSpr = buildPuddleSprites();
    for (let ci = 0; ci < 5; ci++) this.glyphSpr.push(buildGlyph(ci));
    this.cloudDark = buildCloudTile(false);
    this.cloudLit = buildCloudTile(true);
    this.starTile = this.buildStarTile();
    this.farTile = this.buildFar();
    this.midTile = this.buildMid();
    this.nearTile = this.buildNear();
    this.arenaTile = this.buildArena();
    this.wetMask = this.buildWetMask();     // needs the puddle records above
    /* storm art: bolt variants, flash gradient, horizon haze, DOF tiles */
    this.hazeSpr = buildHazeStrip();
    this.farTileBlur = blurTile(this.farTile, 6);
    this.midTileBlur = blurTile(this.midTile, 3);
  }

  /* ------------------------- layer tile builders ------------------------- */

  private buildStarTile(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, STAR_H);
    const rng = mulberry32(0x51a2c9);
    for (let i = 0; i < 180; i++) {
      const x = rng() * TILE;
      const y = rng() * STAR_H;
      const f = y / STAR_H;
      const fade = f < 0.5 ? 1 : Math.max(0.06, 1 - (f - 0.5) * 1.85);   // city glow wash
      const a = (0.16 + rng() * 0.6) * fade;
      const big = rng() < 0.1;
      g.fillStyle = rng() < 0.12
        ? `rgba(232,220,200,${a.toFixed(3)})`
        : `rgba(201,216,221,${a.toFixed(3)})`;
      g.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
    }
    for (let i = 0; i < 16; i++) {
      const mag = rng();
      this.twinks.push({
        x: rng() * TILE, y: 170 + rng() * 260,
        ph: rng() * TAU, sp: 1.4 + rng() * 2.4,
        mag, spec: rng() < 0.24 ? 0 : rng() < 0.6 ? 1 : 2,
        sp2: 2.2 + rng() * 4.8, ph2: rng() * TAU,
      });
    }
    // scintillation draw groups: sort by spectral bucket so each tint costs
    // ONE fillStyle switch (never per-star state changes)
    this.twinks.sort((a, b) => a.spec - b.spec);
    return c;
  }

  private buildFar(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, FAR_H);
    const rng = mulberry32(0xc1f3a0);
    const shades = ['#121d28', '#14202b', '#15222e', '#172432'];
    let x = 0;
    while (x < TILE - 24) {
      let bw = 46 + rng() * 130;
      if (x + bw > TILE) bw = TILE - x;
      let bh = 110 + rng() * 330;
      if (rng() < 0.18) bh += 60 + rng() * 150;
      if (bh > FAR_H - 8) bh = FAR_H - 8;
      const shade = shades[(rng() * shades.length) | 0];
      g.fillStyle = shade;
      g.fillRect(x, FAR_H - bh, bw, bh);
      g.fillStyle = 'rgba(142,176,212,0.055)';              // moon catch: top only
      g.fillRect(x, FAR_H - bh, bw, 1);
      if (rng() < 0.25) {                                  // crowning setback
        const sw = bw * (0.35 + rng() * 0.3);
        let sh = 22 + rng() * 70;
        if (bh + sh > FAR_H - 6) sh = FAR_H - 6 - bh;
        if (sh > 6) {
          g.fillRect(x + (bw - sw) * rng(), FAR_H - bh - sh, sw, sh);
          g.fillStyle = 'rgba(60,80,92,0.12)';
          g.fillRect(x + (bw - sw) * rng(), FAR_H - bh - sh, sw, 1);
        }
      }
      if (bh > 330 && rng() < 0.6 && this.beacons.length < 9) {  // antenna + beacon
        const ax = x + bw * (0.2 + rng() * 0.6);
        let aH = 16 + rng() * 42;
        if (bh + aH > FAR_H - 4) aH = FAR_H - 4 - bh;
        if (aH > 8) {
          g.fillStyle = '#0d141b';
          g.fillRect(ax, FAR_H - bh - aH, 1, aH);
          this.beacons.push({ x: ax + 0.5, yA: bh + aH - 2, ph: rng() * TAU, sp: 0.8 + rng() * 1.5 });
        }
      }
      const stepX = 6.5 + rng() * 2.5, stepY = 8 + rng() * 3.5;
      for (let wx = x + 4; wx < x + bw - 4; wx += stepX) { // window grid INSIDE the facade
        for (let wy = FAR_H - bh + 5; wy < FAR_H - 6; wy += stepY) {
          g.fillStyle = 'rgba(9,14,21,0.55)';               // unlit cell = the grid reads
          g.fillRect(wx, wy, 2, 2);
          if (rng() < 0.15) {
            const warm = rng() < 0.82;
            const a = 0.5 + rng() * 0.45;
            g.fillStyle = warm ? `rgba(255,180,107,${a.toFixed(3)})` : `rgba(125,232,220,${a.toFixed(3)})`;
            g.fillRect(wx, wy, 2, rng() < 0.3 ? 3 : 2);
          }
        }
      }
      x += bw + (rng() < 0.22 ? 5 + rng() * 18 : 0);
    }
    const gr = g.createLinearGradient(0, FAR_H - 90, 0, FAR_H);   // base haze
    gr.addColorStop(0, 'rgba(10,16,22,0)');
    gr.addColorStop(1, 'rgba(10,16,22,0.55)');
    g.fillStyle = gr;
    g.fillRect(0, FAR_H - 90, TILE, 90);
    // ATMOSPHERIC PERSPECTIVE — far towers dissolve INTO the night sky:
    // top fade + aerial lift, both source-atop (sky gaps stay clean).
    g.globalCompositeOperation = 'source-atop';
    const tg = g.createLinearGradient(0, 0, 0, FOG.topFadeH);
    tg.addColorStop(0, 'rgba(26,42,66,0.5)');
    tg.addColorStop(1, 'rgba(26,42,66,0)');
    g.fillStyle = tg;
    g.fillRect(0, 0, TILE, FOG.topFadeH);
    g.fillStyle = FOG.farLift;
    g.fillRect(0, 0, TILE, FAR_H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  private buildMid(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, MID_H);
    const rng = mulberry32(0x2b6e5f);
    const shades = ['#0b141c', '#0d1721', '#0e1924', '#101c27'];
    const cands: { bx: number; bw: number; bh: number }[] = [];
    let x = 0;
    while (x < TILE - 60) {
      let bw = 90 + rng() * 210;
      if (x + bw > TILE) bw = TILE - x;
      let bh = 160 + rng() * 330;
      if (rng() < 0.14) bh += 60 + rng() * 90;             // occasional spire
      if (bh > MID_H - 70) bh = MID_H - 70;
      const shade = shades[(rng() * shades.length) | 0];
      g.fillStyle = shade;
      g.fillRect(x, MID_H - bh, bw, bh);
      g.fillStyle = 'rgba(150,185,215,0.07)';               // moon catch: top only
      g.fillRect(x, MID_H - bh, bw, 1);
      const bg2 = g.createLinearGradient(0, MID_H - bh, 0, MID_H - bh + bh * 0.6);
      bg2.addColorStop(0, 'rgba(30,48,68,0.24)');
      bg2.addColorStop(1, 'rgba(30,48,68,0)');
      g.fillStyle = bg2;
      g.fillRect(x, MID_H - bh, bw, bh * 0.6);
      g.fillStyle = 'rgba(60,82,90,0.18)';                 // parapet catch-light
      g.fillRect(x, MID_H - bh, bw, 2);
      if (rng() < 0.32 && bw > 110) {                      // rooftop tank
        const tw = 16 + rng() * 12, th = 18 + rng() * 15;
        const tx = x + 10 + rng() * (bw - tw - 20);
        g.fillStyle = shade;
        g.fillRect(tx, MID_H - bh - th, tw, th);
        g.fillStyle = 'rgba(70,94,102,0.15)';
        g.fillRect(tx, MID_H - bh - th, 1.5, th);
      }
      if (rng() < 0.45) {                                  // antenna mast
        const ax = x + bw * (0.15 + rng() * 0.7);
        let aH = 26 + rng() * 64;
        if (bh + aH > MID_H - 6) aH = MID_H - 6 - bh;
        if (aH > 12) {
          g.fillStyle = '#0a1116';
          g.fillRect(ax, MID_H - bh - aH, 1, aH);
          if (rng() < 0.5) {
            g.fillStyle = 'rgba(255,80,60,0.5)';
            g.fillRect(ax - 0.5, MID_H - bh - aH - 1, 2, 2);
          }
        }
      }
      // (vertical neon edge tubes REMOVED — glowing edge-strokes made the
      // towers read as floating rectangles; signage lives on faces only)
      if (rng() >= 0.22) {                                 // windows (some towers unlit)
        const stepX = 11 + rng() * 4, stepY = 14 + rng() * 4;
        for (let wx = x + 6; wx < x + bw - 8; wx += stepX) {
          for (let wy = MID_H - bh + 8; wy < MID_H - 12; wy += stepY) {
            if (rng() < 0.2) {
              const warm = rng() < 0.8;
              const a = 0.5 + rng() * 0.42;
              g.fillStyle = warm ? `rgba(255,184,119,${a.toFixed(3)})` : `rgba(141,240,226,${a.toFixed(3)})`;
              g.fillRect(wx, wy, 3, 4);
            }
          }
        }
      }
      if (bw > 130) cands.push({ bx: x, bw, bh });
      x += bw + (rng() < 0.35 ? 12 + rng() * 40 : 0);
    }
    if (cands.length >= 3) {                               // 5 neon signs, spread out
      for (let k = 0; k < 5; k++) {
        let idx = (cands.length * (0.1 + 0.2 * k) + rng() * 2) | 0;
        if (idx >= cands.length) idx = cands.length - 1;
        const b = cands[idx];
        const sw = Math.min(116, b.bw - 30);
        const sh = 24 + rng() * 14;
        this.signs.push({
          x: b.bx + b.bw * 0.5,
          yA: 40 + rng() * Math.max(10, b.bh - sh - 60),
          w: sw,
          h: sh,
          ci: k % SIGN_INK.length,
          ph: rng() * TAU,
          state: 0,
          timer: 0,
          next: 3 + rng() * 8,
        });
      }
    }
    const gr = g.createLinearGradient(0, MID_H - 70, 0, MID_H);
    gr.addColorStop(0, 'rgba(7,13,18,0)');
    gr.addColorStop(1, 'rgba(7,13,18,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, MID_H - 70, TILE, 70);
    g.globalCompositeOperation = 'source-atop';            // aerial lift (mid)
    g.fillStyle = 'rgba(36,56,80,0.09)';
    g.fillRect(0, 0, TILE, MID_H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  private buildNear(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, NEAR_H);
    const rng = mulberry32(0x77d1ee);
    const shades = ['#05090d', '#060b10', '#071015', '#050a0f'];
    const towers: { x: number; w: number; h: number }[] = [];
    let x = 0;
    while (x < TILE - 100) {
      let bw = 150 + rng() * 210;
      if (x + bw > TILE) bw = TILE - x;
      const bh = 190 + 260 * rng() * rng();                // mostly mid-height
      const shade = shades[(rng() * shades.length) | 0];
      g.fillStyle = shade;
      g.fillRect(x, NEAR_H - bh, bw, bh);
      g.fillStyle = 'rgba(160,195,228,0.11)';               // moon catch: top only
      g.fillRect(x, NEAR_H - bh, bw, 1);
      // sky bounce: the upper faces catch faint light-pollution so the
      // slabs read as buildings, not voids
      const bg2 = g.createLinearGradient(0, NEAR_H - bh, 0, NEAR_H - bh + bh * 0.72);
      bg2.addColorStop(0, 'rgba(36,54,74,0.30)');
      bg2.addColorStop(0.5, 'rgba(22,34,50,0.12)');
      bg2.addColorStop(1, 'rgba(22,34,50,0)');
      g.fillStyle = bg2;
      g.fillRect(x, NEAR_H - bh, bw, bh * 0.72);
      g.fillStyle = 'rgba(96,130,162,0.3)';                // parapet, moon-tinted
      g.fillRect(x, NEAR_H - bh, bw, 2);
      const nb = 1 + ((rng() * 3) | 0);                    // rooftop boxes
      for (let i = 0; i < nb; i++) {
        const rw = 18 + rng() * 42, rh = 8 + rng() * 14;
        const rx = x + 6 + rng() * Math.max(1, bw - rw - 12);
        g.fillStyle = '#04080b';
        g.fillRect(rx, NEAR_H - bh - rh, rw, rh);
        g.fillStyle = 'rgba(60,84,94,0.1)';
        g.fillRect(rx, NEAR_H - bh - rh, rw, 1);
      }
      if (rng() < 0.7) {                                   // sparse dim windows
        for (let wx = x + 10; wx < x + bw - 10; wx += 17 + rng() * 8) {
          for (let wy = NEAR_H - bh + 12; wy < NEAR_H - 20; wy += 23 + rng() * 9) {
            g.fillStyle = 'rgba(10,16,22,0.5)';             // unlit cell (facade grid)
            g.fillRect(wx, wy, 2, 2);
            if (rng() < 0.08) {
              g.fillStyle = 'rgba(84,112,122,0.42)';
              g.fillRect(wx, wy, 2, 2);
            }
          }
        }
      }
      towers.push({ x, w: bw, h: bh });
      x += bw + 18 + rng() * 60;
    }
    g.lineWidth = 1;                                       // hanging cables
    g.strokeStyle = 'rgba(28,40,48,0.85)';
    let cables = 0;
    for (let i = 0; i + 1 < towers.length && cables < 7; i++) {
      if (rng() >= 0.75) continue;
      const a = towers[i], b = towers[i + 1];
      const ax = a.x + a.w * (0.15 + rng() * 0.35);
      const bx = b.x + b.w * (0.15 + rng() * 0.35);
      const ay = NEAR_H - a.h + 5, by = NEAR_H - b.h + 5;
      const sag = 16 + rng() * 34;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo((ax + bx) * 0.5, Math.max(ay, by) + sag, bx, by);
      g.stroke();
      if (rng() < 0.35) {                                  // paired second strand
        g.beginPath();
        g.moveTo(ax, ay + 3);
        g.quadraticCurveTo((ax + bx) * 0.5, Math.max(ay, by) + sag + 3, bx, by + 3);
        g.stroke();
      }
      cables++;
    }
    const sorted = towers.slice().sort((p, q) => q.h - p.h);
    for (let i = 0; i < 4 && i < sorted.length; i++) {     // elevator lights
      const tw = sorted[i];
      this.lifts.push({
        x: tw.x + 6 + rng() * Math.max(2, tw.w - 12),
        yA0: tw.h - 18,
        yA1: 26,
        sp: 0.05 + rng() * 0.08,
        ph: rng(),
        ci: rng() < 0.6 ? 0 : 1,
      });
    }
    for (let i = 0; i < 2 && i < sorted.length; i++) {     // searchlight origins
      this.beams.push({
        x: sorted[i].x + sorted[i].w * 0.5,
        yA: sorted[i].h + 3,
        amp: 0.4 + rng() * 0.22,
        sp: 0.25 + rng() * 0.3,
        ph: rng() * TAU,
      });
    }
    const gr = g.createLinearGradient(0, NEAR_H - 60, 0, NEAR_H);
    gr.addColorStop(0, 'rgba(4,8,12,0)');
    gr.addColorStop(1, 'rgba(4,8,12,0.65)');
    g.fillStyle = gr;
    g.fillRect(0, NEAR_H - 60, TILE, 60);
    g.globalCompositeOperation = 'source-atop';            // whisper of air
    g.fillStyle = 'rgba(30,48,70,0.035)';
    g.fillRect(0, 0, TILE, NEAR_H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /* ------------------------ arena tile (world 1:1) ----------------------- */

  private buildArena(): HTMLCanvasElement {
    const { c, g } = makeCanvas(ARENA_W, LIP_H + FACADE_H);
    const rng = mulberry32(0x5eed11);
    const W = ARENA_W, H = LIP_H + FACADE_H;

    /* rooftop lip (world y 0..14) */
    let gr = g.createLinearGradient(0, 0, 0, LIP_H);
    gr.addColorStop(0, '#1d242a');
    gr.addColorStop(0.45, '#252d34');
    gr.addColorStop(1, '#161c21');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, LIP_H);
    g.fillStyle = 'rgba(0,0,0,0.38)';                      // contact shadow
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(150,172,180,0.14)';                // hairline at wall base
    g.fillRect(0, 2, W, 1);
    g.fillStyle = 'rgba(146,168,178,0.2)';                 // front-edge bevel
    g.fillRect(0, 12, W, 1);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 13, W, 1);
    for (let sx = 0; sx <= W; sx += 140) {                 // panel seams
      g.fillStyle = 'rgba(0,0,0,0.34)';
      g.fillRect(sx, 2, 1, 11);
      g.fillStyle = 'rgba(140,162,172,0.1)';
      g.fillRect(sx + 1, 2, 1, 11);
    }
    for (let bx = 70; bx < W; bx += 280) {                 // bolt dots
      g.fillStyle = '#0b0f13';
      g.fillRect(bx, 4, 2, 2);
      g.fillStyle = 'rgba(160,180,190,0.22)';
      g.fillRect(bx, 4, 1, 1);
    }
    g.lineWidth = 0.8;                                     // hairline wear scratches
    for (let i = 0; i < 26; i++) {
      const sx = rng() * W, sy = 3 + rng() * 9;
      const len = 5 + rng() * 13;
      g.strokeStyle = `rgba(158,178,186,${(0.04 + rng() * 0.05).toFixed(3)})`;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + len, sy + len * (rng() - 0.5) * 0.7);
      g.stroke();
    }
    for (let i = 0; i < 9; i++) {                          // vent grates
      const vx = 60 + rng() * (W - 140);
      g.fillStyle = '#0c1014';
      g.fillRect(vx, 3.5, 18, 7);
      g.fillStyle = 'rgba(120,140,150,0.2)';
      g.fillRect(vx, 3.5, 18, 1);
      g.fillStyle = 'rgba(44,56,62,0.9)';
      g.fillRect(vx + 2, 5.4, 14, 0.8);
      g.fillRect(vx + 2, 7.2, 14, 0.8);
      g.fillRect(vx + 2, 9, 14, 0.8);
    }
    gr = g.createLinearGradient(700, 0, 1500, 0);          // broad static sheen
    gr.addColorStop(0, 'rgba(160,185,195,0)');
    gr.addColorStop(0.5, 'rgba(160,185,195,0.08)');
    gr.addColorStop(1, 'rgba(160,185,195,0)');
    g.fillStyle = gr;
    g.fillRect(700, 2, 800, 11);
    for (const [sx, sw] of [[210, 420], [1240, 520], [1900, 460]] as const) { // extra gloss lanes
      const gl = g.createLinearGradient(sx, 0, sx + sw, 0);
      gl.addColorStop(0, 'rgba(170,196,208,0)');
      gl.addColorStop(0.5, 'rgba(170,196,208,0.055)');
      gl.addColorStop(1, 'rgba(170,196,208,0)');
      g.fillStyle = gl;
      g.fillRect(sx, 2, sw, 11);
    }
    /* NEON SMEAR REFLECTIONS — the city's signs smear across the wet lip as
     * soft color pools (magenta / cyan / amber / violet). Pre-baked into the
     * tile; live shimmer rides on top via the puddle + glint records. */
    const smearCols: ReadonlyArray<string> = ['255,45,149', '41,230,210', '255,176,46', '141,91,255'];
    for (let i = 0; i < 8; i++) {
      const col = smearCols[i % smearCols.length];
      const mx = 120 + rng() * (W - 260);
      const mw = 70 + rng() * 170;
      const sg = g.createRadialGradient(mx, 7, 0, mx, 7, mw);
      sg.addColorStop(0, `rgba(${col},${(0.1 + rng() * 0.07).toFixed(3)})`);
      sg.addColorStop(1, `rgba(${col},0)`);
      g.save();
      g.scale(1, 0.16);                                    // squash into the lip band
      g.fillStyle = sg;
      g.beginPath(); g.arc(mx, 7 / 0.16, mw, 0, TAU); g.fill();
      g.restore();
    }
    this.hazardTrim(g, rng, 0, 44);                        // worn edge trim
    this.hazardTrim(g, rng, W - 44, 44);

    /* SHALLOW 2.5D DECK (world y 14..150) — GROUND REBIRTH: the old
     * X-braced girder wall read as a perspective ice-rink grid under the
     * mirror. New ground = concrete deck band in shallow orthographic, the
     * reflective wet layer strictly below the character foot line. */
    gr = g.createLinearGradient(0, LIP_H, 0, 150);
    gr.addColorStop(0, '#242d36');
    gr.addColorStop(0.35, '#1c242c');
    gr.addColorStop(1, '#12181e');
    g.fillStyle = gr;
    g.fillRect(0, LIP_H, W, 150 - LIP_H);
    for (let sy = 34; sy < 150; sy += 38) {                // concrete pour seams
      g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(0, sy, W, 1.4);
      g.fillStyle = 'rgba(150,172,186,0.07)'; g.fillRect(0, sy + 1.4, W, 1);
    }
    for (let i = 0; i < 46; i++) {                         // aggregate speckle
      const px = rng() * W, py = 16 + rng() * 130, pr = 1 + rng() * 2.4;
      g.fillStyle = rng() < 0.5
        ? `rgba(255,255,255,${(0.02 + rng() * 0.04).toFixed(3)})`
        : `rgba(0,0,0,${(0.03 + rng() * 0.05).toFixed(3)})`;
      g.fillRect(px, py, pr, pr);
    }
    /* PARAPET EDGE (y 150..168) — the defined rooftop edge; its moonlit top
     * line is the ground-contact cue that anchors the whole scene */
    g.fillStyle = '#0d1216'; g.fillRect(0, 150, W, 18);
    g.fillStyle = 'rgba(158,186,206,0.16)'; g.fillRect(0, 150, W, 1.2);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 151.2, W, 2);
    for (let px = 0; px < W; px += 64) {                   // parapet posts
      g.fillStyle = 'rgba(120,142,158,0.10)'; g.fillRect(px, 152, 2, 16);
    }
    /* THE FALL (y 168..260) — the building drops away into the city dark:
     * sparse far-below lights give height, no grid, no mirror */
    gr = g.createLinearGradient(0, 168, 0, 258);
    gr.addColorStop(0, '#05080c');
    gr.addColorStop(1, '#010304');
    g.fillStyle = gr;
    g.fillRect(0, 168, W, 92);
    for (let i = 0; i < 64; i++) {                         // distant lower city
      const lx = rng() * W, ly = 176 + rng() * 76;
      g.fillStyle = rng() < 0.7
        ? `rgba(255,186,112,${(0.05 + rng() * 0.12).toFixed(3)})`
        : `rgba(120,210,220,${(0.04 + rng() * 0.1).toFixed(3)})`;
      g.fillRect(lx, ly, 1.6, 1.2);
    }
    /* wet-deck neon bounce: the deck just under the lip catches the sign
     * colors as soft pools of reflected light */
    for (let i = 0; i < 9; i++) {
      const col = smearCols[i % smearCols.length];
      const mx = 100 + rng() * (W - 200);
      const mw = 40 + rng() * 90;
      const mh = 30 + rng() * 55;
      const fg = g.createLinearGradient(0, LIP_H, 0, LIP_H + mh);
      fg.addColorStop(0, `rgba(${col},${(0.08 + rng() * 0.05).toFixed(3)})`);
      fg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = fg;
      g.fillRect(mx - mw / 2, LIP_H, mw, mh);
    }
    gr = g.createLinearGradient(0, 152, 0, 255);           // fade into darkness
    gr.addColorStop(0, 'rgba(2,5,8,0)');
    gr.addColorStop(1, 'rgba(2,5,8,0.96)');
    g.fillStyle = gr;
    g.fillRect(0, 152, W, 108);
    g.fillStyle = '#010304';
    g.fillRect(0, 252, W, 8);
    g.fillStyle = 'rgba(0,0,0,0.6)';                       // end caps
    g.fillRect(0, 0, 2, H);
    g.fillRect(W - 2, 0, 2, H);
    g.fillStyle = 'rgba(90,110,120,0.12)';
    g.fillRect(2, LIP_H, 1, H - LIP_H);
    g.fillRect(W - 3, LIP_H, 1, H - LIP_H);

    /* WARM DOOR REFLECTION — the stairwell practical smears down the wet
     * facade as a soft column with drip streaks; the wet-mask puddle
     * windows let it read as reflected firelight */
    const dgx = DOOR_X - ARENA_X0;
    const dg = g.createLinearGradient(0, 18, 0, 150);
    dg.addColorStop(0, 'rgba(255,150,80,0.17)');
    dg.addColorStop(0.55, 'rgba(255,130,60,0.08)');
    dg.addColorStop(1, 'rgba(255,120,50,0)');
    g.fillStyle = dg;
    g.fillRect(dgx - 78, 18, 156, 132);
    for (let i = 0; i < 7; i++) {                        // drip streaks
      const dx = dgx - 60 + rng() * 120;
      const dw = 2 + rng() * 7;
      const dy0 = 22 + rng() * 26;
      const dl = 50 + rng() * 76;
      const da = 0.06 + rng() * 0.12;
      const dgr = g.createLinearGradient(0, dy0, 0, dy0 + dl);
      dgr.addColorStop(0, `rgba(255,160,90,${da.toFixed(3)})`);
      dgr.addColorStop(1, 'rgba(255,140,70,0)');
      g.fillStyle = dgr;
      g.fillRect(dx, dy0, dw, dl);
    }
    const lg = g.createLinearGradient(dgx - 120, 0, dgx + 120, 0);   // warm lip
    lg.addColorStop(0, 'rgba(255,150,80,0)');
    lg.addColorStop(0.5, 'rgba(255,160,92,0.12)');
    lg.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = lg;
    g.fillRect(dgx - 120, 0, 240, LIP_H);

    /* animated decal records (world coords) */
    for (let i = 0; i < 11; i++) {
      const rx = 18 + rng() * 30;
      this.puddles.push({
        x: 130 + rng() * 2340,
        rx,
        ry: Math.max(3, Math.min(7, rx * 0.13)),
        ci: rng() < 0.5 ? 0 : 1,
        ph: rng() * TAU,
        sp: 0.7 + rng() * 1.3,
      });
    }
    this.puddleA = new Float32Array(this.puddles.length);
    /* wet-lip glints: the rain film on the metal catches distant neon and
     * moonlight as twinkle points (animated in drawArena) */
    for (let i = 0; i < 26; i++) {
      this.sparks.push({
        x: 40 + rng() * (W - 80),
        y: 2.2 + rng() * 9.5,
        ph: rng() * TAU,
        sp: 0.9 + rng() * 2.2,
        ci: rng() < 0.45 ? 0 : rng() < 0.75 ? 1 : 2,
      });
    }
    /* fresnel-lane glints: live sparkle points dancing along the moon's
     * specular lane (dual-drift shimmer over the baked plate) */
    for (let i = 0; i < 14; i++) {
      this.glints.push({
        x: 20 + rng() * 340,
        y: 6 + rng() * 118,
        w: 2 + rng() * 5,
        ph: rng() * TAU,
        sp: 1.6 + rng() * 3.4,
        c: rng() < 0.75 ? 0 : 1,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.svcLights.push({
        x: 240 + i * 900 + rng() * 260,
        y: rng() < 0.5 ? 40 : 122,
        ph: rng() * TAU,
        sp: 0.6 + rng() * 0.8,
      });
    }
    return c;
  }

  /** WET-DECK ROUGHNESS MASK — static world-space plate over the mirror
   *  band. Matte micro-striation + dry islands chop the reflection into
   *  wet-asphalt character; destination-out PUDDLE WINDOWS let the sharp
   *  mirror through, each with a moonlit specular rim on the moon side.
   *  Pre-baked: one blit per frame, zero allocs. */
  private buildWetMask(): HTMLCanvasElement {
    const { c, g } = makeCanvas(ARENA_W, 280);
    const rng = mulberry32(0x3ee7a1);
    // 1 — vertical micro-striation: thin matte strips chop the mirror
    for (let i = 0; i < 150; i++) {
      const sx = rng() * ARENA_W;
      const sw = 2 + rng() * 14;
      const sy = 4 + rng() * 46;
      const sh = 90 + rng() * 170;
      const a = 0.05 + rng() * 0.18;
      g.fillStyle = `rgba(30,39,49,${a.toFixed(3)})`;
      g.fillRect(sx, sy, sw, sh);
    }
    // 2 — matte DRY ISLANDS: soft blobs that flatten the mirror locally
    for (let i = 0; i < 11; i++) {
      const bx = 60 + rng() * (ARENA_W - 120);
      const by = 40 + rng() * 200;
      const rx = 130 + rng() * 250;
      const ry = 34 + rng() * 72;
      const gr = g.createRadialGradient(bx, by, 0, bx, by, rx);
      gr.addColorStop(0, 'rgba(32,42,52,0.52)');
      gr.addColorStop(0.62, 'rgba(29,38,48,0.32)');
      gr.addColorStop(1, 'rgba(26,34,44,0)');
      g.save();
      g.scale(1, ry / rx);
      g.fillStyle = gr;
      g.beginPath(); g.arc(bx, by * rx / ry, rx, 0, TAU); g.fill();
      g.restore();
    }
    // 3 — PUDDLE WINDOWS: erase clearings where the sharp mirror lives
    const wins: { x: number; y: number; r: number }[] = [];
    for (const p of this.puddles) wins.push({ x: p.x - ARENA_X0, y: 52 + rng() * 170, r: p.rx * 3.1 });
    for (let i = 0; i < 7; i++) wins.push({ x: 140 + rng() * (ARENA_W - 280), y: 56 + rng() * 160, r: 120 + rng() * 130 });
    g.globalCompositeOperation = 'destination-out';
    for (const wn of wins) {
      const gr = g.createRadialGradient(wn.x, wn.y, 0, wn.x, wn.y, wn.r);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.8, 'rgba(0,0,0,0.94)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.scale(1, 0.34);
      g.fillStyle = gr;
      g.beginPath(); g.arc(wn.x, wn.y / 0.34, wn.r, 0, TAU); g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    // 4 — moonlit specular rims: SHORT soft segments on the moon side only
    // (a full ellipse outline reads as a drawn circle — an artifact)
    g.lineWidth = 1.5;
    for (const wn of wins) {
      if (wn.r > 100 && rng() < 0.5) continue;             // big windows: rare rim
      g.strokeStyle = `rgba(172,205,235,${(0.04 + rng() * 0.035).toFixed(3)})`;
      const a0 = Math.PI * (1.12 + rng() * 0.18);
      g.beginPath();
      g.ellipse(wn.x, wn.y, wn.r * 0.84, wn.r * 0.28, 0, a0, a0 + 0.5 + rng() * 0.5);
      g.stroke();
    }
    return c;
  }

  /** STAIRWELL HEAD-HOUSE with the warm practical door — the scene's warm
   *  anchor against the cool moon (reference-image interior light). */
  private buildDoorStructure(): HTMLCanvasElement {
    const { c, g } = makeCanvas(200, 186);
    // box
    let gr = g.createLinearGradient(0, 14, 0, 120);
    gr.addColorStop(0, '#0d131a');
    gr.addColorStop(1, '#080c11');
    g.fillStyle = gr;
    g.fillRect(16, 12, 168, 174);
    // roof cap + moon rims (cool key from upper right)
    g.fillStyle = '#0a0f15';
    g.fillRect(8, 4, 184, 10);
    g.fillStyle = 'rgba(150,185,220,0.4)';
    g.fillRect(8, 4, 184, 1.5);
    g.fillStyle = 'rgba(150,185,220,0.17)';
    g.fillRect(189, 4, 1.5, 182);
    // THE WARM DOOR — hot core, warm falloff, dark frame
    gr = g.createLinearGradient(0, 62, 0, 186);
    gr.addColorStop(0, '#f5d9ab');
    gr.addColorStop(0.4, '#ffb066');
    gr.addColorStop(1, '#c96f31');
    g.fillStyle = gr;
    g.fillRect(68, 62, 64, 124);
    g.fillStyle = '#070a0e';
    g.fillRect(63, 57, 74, 5);
    g.fillRect(63, 57, 5, 129);
    g.fillRect(128, 57, 5, 129);
    // baked glow spill around the doorway
    g.globalCompositeOperation = 'lighter';
    gr = g.createRadialGradient(100, 128, 8, 100, 128, 120);
    gr.addColorStop(0, 'rgba(255,150,72,0.34)');
    gr.addColorStop(0.55, 'rgba(255,130,60,0.12)');
    gr.addColorStop(1, 'rgba(255,120,50,0)');
    g.fillStyle = gr;
    g.fillRect(0, 20, 200, 166);
    // small warm vent window
    g.fillStyle = 'rgba(255,186,116,0.55)';
    g.fillRect(28, 42, 26, 16);
    g.fillStyle = '#070a0e';
    g.fillRect(28, 49, 26, 2);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /** warm pool the practical spills onto the deck (additive, breathing) */
  private buildDoorPool(): HTMLCanvasElement {
    const { c, g } = makeCanvas(520, 300);
    const gr = g.createRadialGradient(260, 150, 10, 260, 150, 258);
    gr.addColorStop(0, 'rgba(255,152,74,0.5)');
    gr.addColorStop(0.42, 'rgba(255,132,58,0.19)');
    gr.addColorStop(1, 'rgba(255,120,46,0)');
    g.save();
    g.scale(1, 0.58);
    g.fillStyle = gr;
    g.beginPath(); g.arc(260, 150 / 0.58, 258, 0, TAU); g.fill();
    g.restore();
    return c;
  }

  /** MOON GLITTER PATH — the specular column a directional light throws on
   *  wet ground (moonlight-on-water). The ray-traced look in 2D: every
   *  micro-facet of the wet mirror reflects the moon toward the eye as a
   *  vertical shimmering lane. Pre-baked speckle + gradient, one blit. */
  private buildMoonGlitter(): HTMLCanvasElement {
    const { c, g } = makeCanvas(380, 272);
    const rng = mulberry32(0x91c3);
    const gr = g.createLinearGradient(0, 0, 380, 0);
    gr.addColorStop(0, 'rgba(180,208,238,0)');
    gr.addColorStop(0.28, 'rgba(180,208,238,0.10)');
    gr.addColorStop(0.5, 'rgba(196,220,246,0.30)');
    gr.addColorStop(0.72, 'rgba(180,208,238,0.10)');
    gr.addColorStop(1, 'rgba(180,208,238,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 380, 272);
    // vertical FRESNEL: grazing angles toward the viewer reflect MORE — the
    // lane brightens and densifies toward the deck's front edge (the old
    // bake dissolved it there; physics says the opposite)
    const vg = g.createLinearGradient(0, 0, 0, 272);
    vg.addColorStop(0, 'rgba(2,4,8,0.78)');
    vg.addColorStop(0.3, 'rgba(2,4,8,0.32)');
    vg.addColorStop(0.62, 'rgba(2,4,8,0)');
    vg.addColorStop(1, 'rgba(2,4,8,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, 380, 272);
    // micro-facet sparkle seeds — density + size grow toward the grazing edge
    for (let i = 0; i < 130; i++) {
      const x = 30 + rng() * 320, y = Math.pow(rng(), 0.62) * 258;
      const a = 0.12 + rng() * 0.34;
      g.fillStyle = `rgba(216,234,252,${a.toFixed(3)})`;
      g.fillRect(x, y, 1.4 + rng() * 2.6, 1 + rng() * 1.8);
    }
    return c;
  }

  /** directional key's diffuse pool on the deck — the LIT SURFACE that makes
   *  the shadows read (shadows on unlit ground are invisible). */
  private buildDeckPool(): HTMLCanvasElement {
    const { c, g } = makeCanvas(512, 150);
    const gr = g.createLinearGradient(0, 0, 0, 150);
    gr.addColorStop(0, 'rgba(136,164,206,0.42)');
    gr.addColorStop(0.45, 'rgba(118,148,192,0.24)');
    gr.addColorStop(1, 'rgba(100,130,178,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 150);
    return c;
  }

  /** spot-light cone cross-section (UE spot: hot inner disc + soft outer) */
  private buildSpotPool(): HTMLCanvasElement {
    const { c, g } = makeCanvas(340, 120);
    const gr = g.createRadialGradient(170, 52, 8, 170, 52, 168);
    gr.addColorStop(0, 'rgba(196,220,248,0.5)');
    gr.addColorStop(0.38, 'rgba(176,202,236,0.18)');
    gr.addColorStop(1, 'rgba(160,190,226,0)');
    g.save();
    g.scale(1, 0.35);
    g.fillStyle = gr;
    g.beginPath(); g.arc(170, 52 / 0.35, 168, 0, TAU); g.fill();
    g.restore();
    return c;
  }

  /** drifting steam wisp for roof vents (environment life) */
  private buildSteamWisp(): HTMLCanvasElement {
    const { c, g } = makeCanvas(120, 170);
    const rng = mulberry32(0x51ea);
    for (let i = 0; i < 6; i++) {
      const y = 160 - i * 24 - rng() * 10;
      const x = 60 + (rng() - 0.5) * (18 + i * 12);
      const r = 16 + i * 7 + rng() * 12;
      const a = 0.12 - i * 0.016;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(148,168,188,${Math.max(0.02, a).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(148,168,188,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 120, 170);
    }
    return c;
  }

  /** worn yellow/black diagonal hazard stripes for one floor-end trim */
  private hazardTrim(g: CanvasRenderingContext2D, rng: () => number, x0: number, wTrim: number): void {
    g.save();
    g.beginPath();
    g.rect(x0, 0, wTrim, LIP_H);
    g.clip();
    g.fillStyle = '#141719';
    g.fillRect(x0, 0, wTrim, LIP_H);
    for (let k = -3; k * 20 < wTrim + 40; k++) {
      const sx = x0 + k * 20;
      g.fillStyle = `rgba(190,150,42,${(0.4 + rng() * 0.3).toFixed(3)})`;
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx + 10, 0);
      g.lineTo(sx + 24, LIP_H);
      g.lineTo(sx + 14, LIP_H);
      g.closePath();
      g.fill();
    }
    for (let i = 0; i < 10; i++) {                         // grime wear
      g.fillStyle = `rgba(10,12,14,${(0.2 + rng() * 0.25).toFixed(3)})`;
      g.fillRect(x0 + rng() * wTrim, rng() * LIP_H, 2 + rng() * 4, 2 + rng() * 3);
    }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x0, 0, 1, LIP_H);
    g.fillRect(x0 + wTrim - 1, 0, 1, LIP_H);
  }
}

export default CyberBackground;
