import {StormEngine} from './storm'
import {FOG} from '../render/look'
import { SkyVaultCache, blitWorldFrustum } from '../render/bhst'

/** the broken streetlight's world x — the stage's second practical (was
 *  STREET_LIGHT from the deleted lighting engine) */
const LAMP_X = 830
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

/** The stripped background contract: sky, arena, optional front dressing,
 *  weather. Every optional engine hook (GL plates, occluders, light rig,
 *  wet mask, shaft mask, horizon mist, env offset) is gone with the 120 fps
 *  strip — the renderer blits only these four passes. */
export interface BackgroundRenderer {
  readonly storm:StormEngine
  onThunder:(()=>void)|null
  moonX:number
  moonY:number
  moonCover:number
  resize(w:number,h:number):void
  update(dt:number):void
  /** Change the draw budget WITHOUT discarding baked art. */
  setQuality(q:Quality):void
  lightningI():number
  lightningAz():number
  drawSky(ctx:CanvasRenderingContext2D,cam:BgCam):void
  drawArena(ctx:CanvasRenderingContext2D):void
  /** OPTIONAL foreground pass — world-space, drawn AFTER the entities so
   *  near-lane dressing occludes fighters. */
  drawFront?(ctx:CanvasRenderingContext2D):void
  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void
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
const DEEP_H = 420;           // deepest skyline band (new)
const FAR_H = 480;
const MID_H = 560;
const NEAR_H = 480;

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

/**
 * PARALLAX LADDER — geometric depth engine.
 *
 * Every band doubles its horizontal parallax factor over the previous one
 * (≈×2.1 per step), so depth reads as an even progression instead of three
 * arbitrary speeds with a hole between them:
 *
 *   stars  0.015 → deep 0.032 → far 0.065 → mid 0.14 → near 0.30
 *
 * Vertical factors fall in the same order (0.98 → 0.805): distant bands
 * barely move with the camera's height, foreground bands track it almost
 * 1:1 — the classic horizon-anchored parallax stack. All four bands draw
 * through one `drawCityBand()` path (fill + slice-blit + lightning pop).
 */
/** deepest silhouette ridge, just above the far mega-city */
const LAY_DEEP: LayerDef = { f: 0.032, vf: 0.978, lift: -4, below: '#0b1219' };
/** far mega-city — parallax 0.065 */
const LAY_FAR: LayerDef = { f: 0.065, vf: 0.9675, lift: -10, below: '#0a1016' };
/** mid city with neon signs — parallax 0.14 */
const LAY_MID: LayerDef = { f: 0.14, vf: 0.901, lift: -26, below: '#070d12' };
/** near-mid foreground towers — parallax 0.30 */
const LAY_NEAR: LayerDef = { f: 0.3, vf: 0.805, lift: -46, below: '#04080c' };

/** drifting fog bands: parallax, y-offset from horizon, alpha, speed, phase */
/* ============================ fixed palettes ============================= */

const SKY_BELOW = '#070d12';
const BEACON_CORE = '#ff5040';
const SIGN_PANEL = '#04070a';
const SIGN_INK: ReadonlyArray<string> = ['#ff2d95', '#29e6d2', '#ffb02e', '#8d5bff', '#3fa9ff'];
const SIGN_CORE: ReadonlyArray<string> = ['#ffd7ec', '#d9fff8', '#ffe9c6', '#e8dcff', '#dcefff'];
const SIGN_BORDER: ReadonlyArray<string> = [
  'rgba(255,45,149,0.55)', 'rgba(41,230,210,0.55)', 'rgba(255,176,46,0.55)',
  'rgba(141,91,255,0.55)', 'rgba(63,169,255,0.55)',
];
const LIFT_COL: ReadonlyArray<string> = ['#ffd9a0', '#9df0e2'];

/* ======================== animated-record shapes ========================= */

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

/** CREPUSCULAR WEDGE FAN — moonlight escaping through the cloud gaps and
 *  scattering off the rain (Mie). Rays visually converge at the source, so
 *  this is a radial fan from the moon's position; the LIVE cloud deck
 *  modulates its alpha, so shafts breathe and die as banks drift (the
 *  clouds are the occluder — physically honest, one blit at runtime). */

/** MOON LIGHT PILLAR — horizontal plate ice crystals stacking like mirrors
 *  throw a vertical beam through bright sources. Rare, thin-high-cloud only,
 *  ALWAYS subtle (hard alpha ceiling: the no-disco law). */

/** ZODIACAL / AIRGLOW BAND — the faint warm-grey sky light that real night
 *  photos always carry near the moon (dust-scattered sunlight). One soft
 *  diagonal band, additive, barely there. */

/** MACRO-RAIN BOKEH — a defocused highlight disc: soft core with a
 *  slightly brighter rim (the soap-bubble edge of real bokeh). */

/** LENS DIRT — sparse sensor/front-element smudges that flare when a bright
 *  source hits the lens. Near-invisible at rest; drawn ONLY at flash energy
 *  (the selective-bloom law — never permanent full-screen glow). */

/** drifting CLOUD-SHADOW plate for the wet deck — soft dark masses on
 *  transparent, pre-baked, scrolled in world space. The deck's own texture
 *  lives in the arena tile; this adds slow moving light variance. */

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

/** dense rain-spray mist band, horizontally seamless — deliberately bolder
 *  than fogSpr so it stays legible when squashed onto the arena lip. */

/** long soft searchlight beam (apex at left-center, fading to the tip) */

/** tiny red glow for antenna beacons */

/** two puddle decals (magenta / cyan neon reflections), stretched per decal */

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
  /* pre-rendered art (built once, resolution independent) */
  private built = false;
  private skyStrip!: HTMLCanvasElement;
  /** light-pollution glow plate (perf, baked at viewport width for 1:1 blit) */
  private pollPlate: HTMLCanvasElement | null = null;
  private pollW = 0;
  private starTile!: HTMLCanvasElement;
  private moonSpr!: HTMLCanvasElement;
  private moonHalo!: HTMLCanvasElement;   // 4-ring additive scattering bake
  private deepTile!: HTMLCanvasElement;
  private farTile!: HTMLCanvasElement;
  private midTile!: HTMLCanvasElement;
  private nearTile!: HTMLCanvasElement;
  private deepTileBlur!: HTMLCanvasElement;
  private arenaTile!: HTMLCanvasElement;
  private cloudDark!: HTMLCanvasElement;   // drifting night cloud deck
  private doorSpr!: HTMLCanvasElement;    // stairwell head-house + warm door
  private doorPool!: HTMLCanvasElement;   // warm pool the door spills
  private glyphSpr: HTMLCanvasElement[] = [];   // sign glyphs (baked into mid tile)
  /** moon state for the render pass (updated by drawSky): screen-space disc
   *  center + eclipse coverage 0..1 (how much cloud mass sits over it) */
  moonX = 0;
  moonY = 0;
  moonCover = 0;

  /** City art consumes a persistent external weather service. */
  readonly storm:StormEngine;
  private hazeSpr: HTMLCanvasElement | null = null;   // humid horizon haze strip

  /* depth-of-field variants of the city tiles (pre-blurred once) */
  private farTileBlur!: HTMLCanvasElement;
  private midTileBlur!: HTMLCanvasElement;

  private q: Quality;
  private skyVault = new SkyVaultCache();
  private lastCam: BgCam = { x: 1300, y: NOMINAL_Y, zoom: 1 };

  get onThunder(){return this.storm.onThunder}
  set onThunder(cb:(()=>void)|null){this.storm.onThunder=cb}
  constructor(quality:Quality,storm=new StormEngine(quality)){
    this.q=quality;this.storm=storm;
  }

  /** Tier change is a DRAW BUDGET change, never a re-bake. Every tile is
   *  built from a fixed seed in resolution-independent layer space, so the
   *  art is identical at every tier — only how much of it we draw differs. */
  setQuality(q:Quality):void{
    this.q=q;
  }

  /** CSS-pixel size of the game canvas viewport. */
  resize(w: number, h: number): void {
    this.storm.resize(w,h);
    const nw = w > 0 ? w : 1;
    const nh = h > 0 ? h : 1;
    if (nw !== this.vw || nh !== this.vh) this.skyVault.invalidate();
    this.vw = nw;
    this.vh = nh;
    // All art is pre-rendered in a fixed layer space from a fixed seed, so a
    // resize only changes the viewport dims — the layout stays identical and
    // no tile ever needs re-rendering.
  }

  /** advance ambient animation; dt in seconds (clamped internally).
   *  The sign/puddle state machines are gone — everything animated in the
   *  city layer is baked now, so this only advances the shared clock. */
  update(dt: number): void {
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.t += d;
  }

  lightningI():number{return this.storm.intensity}
  lightningAz():number{return this.storm.azimuthValue}

  /* ------------------------ screen-space sky pass ------------------------ */

  drawSky(outerCtx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensureBuilt();
    this.lastCam = cam;
    // light-pollution glow plate (perf): vertical gradient, no-lightning case
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y;
    const cz = Number.isFinite(cam.zoom) ? cam.zoom : 1;
    const w = this.vw, h = this.vh, t = this.t;

    // Moon position — analytic, no coverage scan (nothing reads moonCover
    // since the light rig and god rays were stripped).
    {
      const moonX = w * 0.87 - cx * 0.03 * cz - 84;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - 84;
      this.moonX = moonX + 84;
      this.moonY = moonY + 84;
      this.moonCover = 0;
    }

    this.skyVault.draw(outerCtx, w, h, cx, cy, cz, t, this.lightningI(), Boolean(this.storm.boltActive), this.q, (ctx) => {
    ctx.save();

    /* 1 — sky gradient anchored to the world ground line */
    const hy = h * 0.5 + (0 - cy) * cz;                     // screen y of world y=0
    const skyH = hy > 1 ? (hy < h ? hy : h) : 1;
    ctx.drawImage(this.skyStrip, 0, 0, 8, 600, 0, 0, w, skyH);
    ctx.fillStyle = SKY_BELOW;
    this.fillBelow(ctx, hy);

    /* 1.5 — CITY LIGHT-POLLUTION GLOW: the megapolis below breathes color
     * up into the cloud deck — cool electric blue at altitude, warm sodium
     * and magenta neon right at the skyline. Additive; towers occlude it.
     * PERF: the gradient is vertical-only, so the no-lightning case comes
     * from a baked 8×216 strip stretched full width (identical pixels — a
     * horizontal stretch interpolates identical columns); the rare
     * lightning-modulated case keeps the live gradient. */
    {
      const I0 = this.lightningI();
      const pw = Math.max(2, Math.floor(w));
      if (!this.pollPlate || this.pollW !== pw) {
        const pc = document.createElement('canvas');
        pc.width = pw; pc.height = 216;
        const pg2 = pc.getContext('2d')!;
        const lg = pg2.createLinearGradient(0, 0, 0, 216);
        lg.addColorStop(0, 'rgba(40,70,140,0)');
        lg.addColorStop(0.55, 'rgba(46,78,152,0.075)');
        lg.addColorStop(0.84, 'rgba(122,64,150,0.1)');
        lg.addColorStop(1, 'rgba(255,116,84,0.115)');
        pg2.fillStyle = lg;
        pg2.fillRect(0, 0, pw, 216);
        this.pollPlate = pc;
        this.pollW = pw;
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = I0 > 0 ? 1 + I0 * 0.55 : 1;
      ctx.drawImage(this.pollPlate, 0, hy - 210, w, 216);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 2 — stars + moon (celestial parallax) */
    const starBase = hy - 70 > h * 0.25 ? hy - 70 : h * 0.25;
    const ms = mod(cx * 0.015 * cz, TILE);
    this.blitRow(ctx, this.starTile, ms, starBase - STAR_H);
    /* 2.5 — DRIFTING CLOUD DECKS: three parallax sheets (high slow thin /
     * main bank / low fast wisps). While lightning scatters through them the
     * LIT twin re-blits additively on the lower two decks. Behind skyline. */
    {
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
    }

    /* 2.8 — THE MOON: two baked blits (disc + halo). No eclipse scan, no
     * ring/zodiac/pillar optics — stripped with the rest of the engines. */
    {
      const moonX = w * 0.87 - cx * 0.03 * cz - 84;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - 84;
      this.moonX = moonX + 84;
      this.moonY = moonY + 84;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.moonSpr, moonX, moonY, 168, 168);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8;
      ctx.drawImage(this.moonHalo, moonX + 84 - 141, moonY + 84 - 141, 282, 282);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    /* 3 — DEEP + FAR skylines through the shared parallax engine.
     * Both draw from their pre-blurred DOF variants; during a strike the
     * sharp tile re-blits additively → silhouette pop. */
    const I = this.lightningI();
    this.drawCityBand(ctx, LAY_DEEP, h, cx, cy, cz, I, this.deepTileBlur, this.deepTile, DEEP_H, 0.34);
    this.drawCityBand(ctx, LAY_FAR, h, cx, cy, cz, I, this.farTileBlur, this.farTile, FAR_H, 0.3);

    /* 4 — mid city: baked neon signs, one shared band draw */
    this.drawCityBand(ctx, LAY_MID, h, cx, cy, cz, I, this.midTileBlur, this.midTile, MID_H, 0.14);

    /* 4.5 — humid horizon haze: one blit around the ground line */
    ctx.globalAlpha = 0.65;
    ctx.drawImage(this.hazeSpr!, 0, hy - 96, w, 150);
    ctx.globalAlpha = 1;

    /* 5 — near towers (no DOF blur — the action plane stays crisp) */
    this.drawCityBand(ctx, LAY_NEAR, h, cx, cy, cz, I, this.nearTile, this.nearTile, NEAR_H, 0.12);
    ctx.restore();
    });
  }

  /* ----------------------- world-space arena pass ------------------------ */

  drawArena(ctx: CanvasRenderingContext2D): void {
    this.ensureBuilt();
    const t = this.t;
    const cam = this.lastCam;
    const halfW = this.vw / Math.max(0.4, cam.zoom || 1) * 0.52;
    const viewL = cam.x - halfW, viewR = cam.x + halfW;
    // stage blit: lip + facade + baked deck dressing (contact shadows under
    // the stairwell and the broken streetlight, its ground pool, the moon
    // pool) — three props, zero live state
    blitWorldFrustum(ctx, this.arenaTile, ARENA_X0, 0, viewL, viewR);
    // STAIRWELL PRACTICAL — warm head-house + breathing pool (additive)
    ctx.drawImage(this.doorSpr, DOOR_X - 100, -172);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 + 0.05 * Math.sin(t * 0.11) + 0.06 * this.lightningI();
    ctx.drawImage(this.doorPool, DOOR_X - 260, -68);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* ---------------------- screen-space weather pass ---------------------- */

  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void{
    this.ensureBuilt();
    this.storm.setView(cam);
    this.storm.drawRain(ctx);
    // lightning flash — one tinted overlay instead of the bolt path art,
    // the glow blit and every gated deck effect
    const li = this.lightningI();
    if (li > 0.02) {
      ctx.fillStyle = 'rgba(178,206,244,1)';
      ctx.globalAlpha = Math.min(0.22, li * 0.22);
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
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
    this.doorSpr = this.buildDoorStructure();
    this.doorPool = this.buildDoorPool();
    for (let ci = 0; ci < 5; ci++) this.glyphSpr.push(buildGlyph(ci));
    this.cloudDark = buildCloudTile(false);
    this.starTile = this.buildStarTile();
    this.deepTile = this.buildDeep();
    this.farTile = this.buildFar();
    this.midTile = this.buildMid();
    this.nearTile = this.buildNear();
    this.arenaTile = this.buildArena();
    /* storm art: horizon haze + per-layer DOF variants (baked once) */
    this.hazeSpr = buildHazeStrip();
    this.deepTileBlur = blurTile(this.deepTile, 8);
    this.farTileBlur = blurTile(this.farTile, 6);
    this.midTileBlur = blurTile(this.midTile, 3);
  }

  /**
   * One parallax band: ground fill under the band + the frustum-sliced
   * tile blit + the lightning silhouette pop. All four city layers share
   * this single code path — the whole parallax engine is one method.
   */
  private drawCityBand(
    ctx: CanvasRenderingContext2D,
    lay: LayerDef,
    h: number,
    cx: number,
    cy: number,
    cz: number,
    I: number,
    soft: HTMLCanvasElement,
    sharp: HTMLCanvasElement,
    bandH: number,
    popAlpha: number,
  ): void {
    const by = h * 0.5 + (lay.lift - cy * lay.vf) * cz;
    const m = mod(cx * lay.f * cz, TILE);
    ctx.fillStyle = lay.below;
    this.fillBelow(ctx, by);
    this.blitRow(ctx, soft, m, by - bandH);
    if (I > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = popAlpha * I;
      this.blitRow(ctx, sharp, m, by - bandH);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------- layer tile builders ------------------------- */

  private buildStarTile(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, STAR_H);
    const rng = mulberry32(0x51a2c9);
    // FAINT NEBULA BLOOMS — two soft color clouds so the upper sky reads
    // as depth instead of a flat ramp (wrap-aware: drawn at ±TILE too)
    const nebs: ReadonlyArray<readonly [string, number, number, number]> = [
      ['rgba(70,96,168,0.055)', 0.3, 0.2, 300],
      ['rgba(140,84,146,0.04)', 0.64, 0.3, 260],
      ['rgba(60,120,150,0.04)', 0.86, 0.16, 240],
    ];
    for (const [col, px, py, rad] of nebs) {
      const nx = px * TILE, ny = STAR_H * py;
      for (const ox of [-TILE, 0, TILE]) {
        const rg = g.createRadialGradient(nx + ox, ny, 0, nx + ox, ny, rad);
        rg.addColorStop(0, col);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        g.fillRect(nx + ox - rad, ny - rad, rad * 2, rad * 2);
      }
    }
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
    return c;
  }

  /**
   * DEEPEST SKYLINE (new parallax band) — the megastructure ridge behind
   * the far city: huge simple slabs, needle spires, one landmark tower
   * with a lit crown, distant billboard glows. Everything dissolves into
   * the heaviest aerial fog of the stack; window grids are reduced to
   * specks because at this distance individual cells no longer read.
   */
  private buildDeep(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, DEEP_H);
    const rng = mulberry32(0x33d1e7);
    const shades = ['#16222f', '#182534', '#1a2838', '#152030'];
    const glow: ReadonlyArray<string> = [
      'rgba(255,45,149,0.20)', 'rgba(41,230,210,0.20)', 'rgba(255,176,46,0.18)',
      'rgba(141,91,255,0.20)', 'rgba(63,169,255,0.18)',
    ];
    let landmark = false;
    let x = 0;
    while (x < TILE - 60) {
      let bw = 110 + rng() * 190;
      if (x + bw > TILE) bw = TILE - x;
      let bh = 170 + rng() * 210;
      if (rng() < 0.22) bh += 60 + rng() * 120;
      if (bh > DEEP_H - 10) bh = DEEP_H - 10;
      const shade = shades[(rng() * shades.length) | 0];
      g.fillStyle = shade;
      g.fillRect(x, DEEP_H - bh, bw, bh);
      g.fillStyle = 'rgba(150,185,220,0.06)';            // moon catch, top only
      g.fillRect(x, DEEP_H - bh, bw, 1);
      const kind = rng();
      if (kind < 0.28) {                                  // stepped crown
        const sw1 = bw * (0.55 + rng() * 0.2);
        const sh1 = 14 + rng() * 26;
        g.fillStyle = shade;
        g.fillRect(x + (bw - sw1) * 0.5, DEEP_H - bh - sh1, sw1, sh1);
        const sw2 = sw1 * (0.4 + rng() * 0.25);
        const sh2 = 10 + rng() * 22;
        g.fillRect(x + (bw - sw2) * 0.5, DEEP_H - bh - sh1 - sh2, sw2, sh2);
        g.fillStyle = 'rgba(150,185,220,0.05)';
        g.fillRect(x + (bw - sw2) * 0.5, DEEP_H - bh - sh1 - sh2, sw2, 1);
      } else if (kind < 0.45) {                           // needle spire
        const ax = x + bw * (0.3 + rng() * 0.4);
        const aH = 40 + rng() * 90;
        g.fillStyle = '#131d29';
        g.fillRect(ax, DEEP_H - bh - aH, 2, aH);
        g.fillStyle = 'rgba(255,90,70,0.45)';             // obstruction light
        g.fillRect(ax - 0.5, DEEP_H - bh - aH - 2, 3, 2);
      } else if (kind < 0.58) {                           // slanted roof
        g.beginPath();
        g.moveTo(x, DEEP_H - bh);
        g.lineTo(x + bw, DEEP_H - bh - (18 + rng() * 36));
        g.lineTo(x + bw, DEEP_H - bh);
        g.closePath();
        g.fillStyle = shade;
        g.fill();
        g.strokeStyle = 'rgba(150,185,220,0.08)';
        g.lineWidth = 1;
        g.stroke();
      }
      // LANDMARK MEGA-TOWER — one per tile: glowing crown + twin antennas
      if (!landmark && bh > 300 && bw > 150 && x > 280 && x < TILE - 420) {
        landmark = true;
        const cy0 = DEEP_H - bh + 8;
        const cg = g.createLinearGradient(0, cy0, 0, cy0 + 30);
        cg.addColorStop(0, 'rgba(120,220,255,0.5)');
        cg.addColorStop(1, 'rgba(120,220,255,0)');
        g.fillStyle = cg;
        g.fillRect(x + 4, cy0, bw - 8, 30);
        g.fillStyle = 'rgba(190,240,255,0.75)';
        g.fillRect(x + 6, cy0 + 5, bw - 12, 2);
        g.fillStyle = '#131d29';
        g.fillRect(x + bw * 0.3, cy0 - 34, 2, 34);
        g.fillRect(x + bw * 0.66, cy0 - 46, 2, 46);
        g.fillStyle = 'rgba(255,90,70,0.6)';
        g.fillRect(x + bw * 0.3, cy0 - 36, 2, 2);
        g.fillRect(x + bw * 0.66, cy0 - 48, 2, 2);
      }
      if (rng() < 0.75) {                                 // sparse light specks
        const stepX = 14 + rng() * 10, stepY = 16 + rng() * 10;
        for (let wx = x + 6; wx < x + bw - 6; wx += stepX) {
          for (let wy = DEEP_H - bh + 8; wy < DEEP_H - 8; wy += stepY) {
            if (rng() < 0.07) {
              const a = 0.25 + rng() * 0.4;
              g.fillStyle = rng() < 0.85
                ? `rgba(255,196,130,${a.toFixed(3)})`
                : `rgba(140,235,225,${a.toFixed(3)})`;
              g.fillRect(wx, wy, 2, 2);
            }
          }
        }
      }
      if (rng() < 0.16 && bw > 130 && bh > 200) {          // distant billboard glow
        const bx0 = x + 8 + rng() * Math.max(4, bw - 76);
        const by0 = DEEP_H - bh + 30 + rng() * 80;
        const bwid = 40 + rng() * 26, bhei = 18 + rng() * 14;
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = glow[(rng() * glow.length) | 0];
        g.fillRect(bx0, by0, bwid, bhei);
        g.globalCompositeOperation = 'source-over';
      }
      x += bw + (rng() < 0.3 ? 10 + rng() * 30 : 0);
    }
    const gr = g.createLinearGradient(0, DEEP_H - 110, 0, DEEP_H);   // base haze
    gr.addColorStop(0, 'rgba(11,18,25,0)');
    gr.addColorStop(1, 'rgba(11,18,25,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, DEEP_H - 110, TILE, 110);
    // heaviest aerial perspective of the stack — the ridge melts into night
    g.globalCompositeOperation = 'source-atop';
    const tg = g.createLinearGradient(0, 0, 0, FOG.topFadeH + 40);
    tg.addColorStop(0, 'rgba(30,48,76,0.62)');
    tg.addColorStop(1, 'rgba(30,48,76,0)');
    g.fillStyle = tg;
    g.fillRect(0, 0, TILE, FOG.topFadeH + 40);
    g.fillStyle = 'rgba(46,70,104,0.34)';
    g.fillRect(0, 0, TILE, DEEP_H);
    g.globalCompositeOperation = 'source-over';
    // wrap-aware soft bake (the DOF variant in ensureBuilt goes further)
    const blurred = makeCanvas(TILE, DEEP_H);
    blurred.g.filter = 'blur(3px)';
    blurred.g.drawImage(c, -TILE, 0);
    blurred.g.drawImage(c, 0, 0);
    blurred.g.drawImage(c, TILE, 0);
    blurred.g.filter = 'none';
    return blurred.c;
  }

  private buildFar(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, FAR_H);
    const rng = mulberry32(0xc1f3a0);
    const shades = ['#121d28', '#14202b', '#15222e', '#172432'];
    let beaconCount = 0;
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
      const roof = rng();
      if (roof < 0.25) {                                  // crowning setback
        const sw = bw * (0.35 + rng() * 0.3);
        let sh = 22 + rng() * 70;
        if (bh + sh > FAR_H - 6) sh = FAR_H - 6 - bh;
        if (sh > 6) {
          g.fillRect(x + (bw - sw) * rng(), FAR_H - bh - sh, sw, sh);
          g.fillStyle = 'rgba(60,80,92,0.12)';
          g.fillRect(x + (bw - sw) * rng(), FAR_H - bh - sh, sw, 1);
        }
      } else if (roof < 0.38) {                           // slanted shed roof
        g.beginPath();
        g.moveTo(x, FAR_H - bh);
        g.lineTo(x + bw, FAR_H - bh - (12 + rng() * 26));
        g.lineTo(x + bw, FAR_H - bh);
        g.closePath();
        g.fillStyle = shade;
        g.fill();
        g.strokeStyle = 'rgba(60,80,92,0.14)';
        g.lineWidth = 1;
        g.stroke();
      } else if (roof < 0.47 && bw > 90) {                // twin cooling stacks
        for (let si = 0; si < 2; si++) {
          const sx = x + bw * (0.3 + si * 0.32 + rng() * 0.08);
          const sh2 = 10 + rng() * 16;
          g.fillStyle = '#101923';
          g.fillRect(sx, FAR_H - bh - sh2, 5, sh2);
          g.fillStyle = 'rgba(70,94,110,0.16)';
          g.fillRect(sx, FAR_H - bh - sh2, 5, 1);
        }
      }
      if (bh > 330 && rng() < 0.6 && beaconCount < 9) {  // antenna + baked beacon
        const ax = x + bw * (0.2 + rng() * 0.6);
        let aH = 16 + rng() * 42;
        if (bh + aH > FAR_H - 4) aH = FAR_H - 4 - bh;
        if (aH > 8) {
          g.fillStyle = '#0d141b';
          g.fillRect(ax, FAR_H - bh - aH, 1, aH);
          // static red beacon core + glow baked into the tile (was a live
          // per-frame blink loop over 9 records × every tile copy)
          const by = FAR_H - bh - aH + 2;
          g.fillStyle = 'rgba(255,80,64,0.28)';
          g.fillRect(ax - 3.5, by - 3.5, 7, 7);
          g.fillStyle = BEACON_CORE;
          g.fillRect(ax - 1, by - 1, 2, 2);
          beaconCount++;
        }
      }
      // LIT FLOOR: sometimes a whole office floor burns at night (band row),
      // sometimes one stairwell shaft runs the full height — both read as
      // occupancy instead of random noise
      const litFloorY = rng() < 0.34 ? FAR_H - bh + 12 + rng() * Math.max(12, bh - 34) : -999;
      const shaftX = rng() < 0.18 ? x + 8 + rng() * Math.max(2, bw - 18) : -999;
      const floorHue = rng();
      const stepX = 6.5 + rng() * 2.5, stepY = 8 + rng() * 3.5;
      for (let wx = x + 4; wx < x + bw - 4; wx += stepX) { // window grid INSIDE the facade
        for (let wy = FAR_H - bh + 5; wy < FAR_H - 6; wy += stepY) {
          g.fillStyle = 'rgba(9,14,21,0.55)';               // unlit cell = the grid reads
          g.fillRect(wx, wy, 2, 2);
          const onFloor = wy > litFloorY - stepY * 0.55 && wy < litFloorY + stepY * 0.55;
          const onShaft = Math.abs(wx - shaftX) < stepX * 0.6;
          if (onFloor || onShaft || rng() < 0.15) {
            const warm = onFloor ? floorHue < 0.7 : rng() < 0.82;
            const cool = !onFloor && rng() < 0.1;
            const a = onFloor ? 0.55 + rng() * 0.4 : 0.5 + rng() * 0.45;
            g.fillStyle = cool
              ? `rgba(141,150,255,${(a * 0.8).toFixed(3)})`
              : warm ? `rgba(255,180,107,${a.toFixed(3)})` : `rgba(125,232,220,${a.toFixed(3)})`;
            g.fillRect(wx, wy, 2, rng() < 0.3 ? 3 : 2);
          }
        }
      }
      // DISTANT BILLBOARD — a soft colored glow plate on a tall face
      if (rng() < 0.12 && bw > 100 && bh > 240) {
        const cols = ['rgba(255,45,149,0.16)', 'rgba(41,230,210,0.16)', 'rgba(255,176,46,0.14)', 'rgba(63,169,255,0.15)'];
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = cols[(rng() * cols.length) | 0];
        g.fillRect(x + 8 + rng() * Math.max(4, bw - 60), FAR_H - bh + 30 + rng() * 70, 34 + rng() * 18, 14 + rng() * 10);
        g.globalCompositeOperation = 'source-over';
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
    // AERIAL FOCUS — the far plate sits past the focal plane: bake a one-
    // time soft blur (runtime cost ZERO — same drawImage) with wrap-aware
    // edges so the tile seam stays invisible; the fog carries the rest of
    // the depth read (bokeh DOF law).
    const blurred = makeCanvas(TILE, FAR_H);
    blurred.g.filter = 'blur(2px)';
    blurred.g.drawImage(c, -TILE, 0);
    blurred.g.drawImage(c, 0, 0);
    blurred.g.drawImage(c, TILE, 0);
    blurred.g.filter = 'none';
    return blurred.c;
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
      const roofKind = rng();
      if (roofKind < 0.3 && bw > 110) {                    // water tower on legs
        const tw = 18 + rng() * 14, th = 20 + rng() * 16;
        const tx = x + 10 + rng() * (bw - tw - 20);
        const ty = MID_H - bh - th;
        g.fillStyle = shade;
        g.fillRect(tx, ty, tw, th);
        g.beginPath();                                     // conical roof
        g.moveTo(tx - 2, ty);
        g.lineTo(tx + tw / 2, ty - 7 - rng() * 5);
        g.lineTo(tx + tw + 2, ty);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(70,94,102,0.15)';              // tank sheen
        g.fillRect(tx, ty, 1.5, th);
        g.strokeStyle = 'rgba(34,46,54,0.95)';             // three legs
        g.lineWidth = 1.5;
        for (let li = 0; li < 3; li++) {
          const lx = tx + 2 + (li * (tw - 4)) / 2;
          g.beginPath();
          g.moveTo(lx, ty + th);
          g.lineTo(lx + (li - 1) * 3, ty + th + 9);
          g.stroke();
        }
      } else if (roofKind < 0.44 && bw > 100) {            // AC condenser + vent pipe
        const aw = 16 + rng() * 14, ah = 8 + rng() * 6;
        const ax2 = x + 10 + rng() * Math.max(4, bw - aw - 20);
        const ay = MID_H - bh - ah;
        g.fillStyle = '#0a1218';
        g.fillRect(ax2, ay, aw, ah);
        g.fillStyle = 'rgba(90,116,128,0.22)';             // grille lines
        for (let gi = 1; gi < 3; gi++) g.fillRect(ax2 + 2, ay + gi * (ah / 3), aw - 4, 1);
        g.fillStyle = 'rgba(70,94,102,0.3)';
        g.fillRect(ax2, ay, aw, 1);
        g.strokeStyle = 'rgba(40,54,62,0.9)';              // vent pipe
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(ax2 + aw - 3, ay);
        g.lineTo(ax2 + aw - 3, ay - 12 - rng() * 10);
        g.stroke();
      } else if (roofKind < 0.52 && bw > 90) {             // satellite dish
        const dx = x + 14 + rng() * Math.max(4, bw - 40);
        const dy = MID_H - bh - 4;
        const dr = 7 + rng() * 6;
        g.strokeStyle = 'rgba(80,104,116,0.5)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(dx, dy, dr, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
        g.fillStyle = 'rgba(80,104,116,0.35)';
        g.fillRect(dx - 1, dy, 2, 6);
      } else if (roofKind < 0.6 && bw > 90) {              // stair bulkhead
        const sw2 = 20 + rng() * 16, sh2 = 12 + rng() * 8;
        const sx2 = x + 8 + rng() * Math.max(4, bw - sw2 - 16);
        g.fillStyle = shade;
        g.fillRect(sx2, MID_H - bh - sh2, sw2, sh2);
        g.fillStyle = 'rgba(60,82,90,0.2)';
        g.fillRect(sx2, MID_H - bh - sh2, sw2, 1);
        g.fillStyle = 'rgba(20,30,38,0.9)';                // door
        g.fillRect(sx2 + sw2 * 0.55, MID_H - bh - sh2 + 3, 6, sh2 - 3);
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
      // ROOFTOP BILLBOARD on posts — the cyberpunk skyline's signature.
      // Baked: panel gradient + one neon glyph, no live state.
      if (rng() < 0.14 && bw > 150 && bh > 240) {
        const ci = (rng() * SIGN_INK.length) | 0;
        const bwi = Math.min(96, bw - 40), bhei = 34 + rng() * 16;
        const bx0 = x + 20 + rng() * Math.max(4, bw - bwi - 40);
        const by0 = MID_H - bh - bhei - 14;
        g.strokeStyle = 'rgba(30,42,50,0.95)';             // two posts
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(bx0 + 8, by0 + bhei);
        g.lineTo(bx0 + 8, by0 + bhei + 14);
        g.moveTo(bx0 + bwi - 8, by0 + bhei);
        g.lineTo(bx0 + bwi - 8, by0 + bhei + 14);
        g.stroke();
        g.globalAlpha = 0.9;
        g.fillStyle = SIGN_PANEL;
        rrPath(g, bx0, by0, bwi, bhei, 3);
        g.fill();
        g.globalAlpha = 0.55;
        g.strokeStyle = SIGN_BORDER[ci];
        g.stroke();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.34;
        g.drawImage(this.glyphSpr[ci], bx0 + 6, by0 + 5, bwi - 12, bhei - 10);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.8;
        g.drawImage(this.glyphSpr[ci], bx0 + 10, by0 + 8, bwi - 20, bhei - 16);
        g.globalAlpha = 1;
      }
      // FACE NEON STRIP — a thin lit line inset from the facade edge
      // (on the FACE, never on the silhouette edge: edge tubes made the
      // towers read as floating rectangles)
      if (rng() < 0.22 && bh > 150) {
        const ni = (rng() * SIGN_INK.length) | 0;
        const nx = rng() < 0.5 ? x + 7 : x + bw - 9;
        const ny0 = MID_H - bh + 16 + rng() * 30;
        const nh = Math.min(bh - 40, 60 + rng() * 140);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.5;
        g.fillStyle = SIGN_INK[ni];
        g.fillRect(nx, ny0, 2, nh);
        g.globalAlpha = 0.18;
        g.fillRect(nx - 2, ny0, 6, nh);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      }
      if (rng() >= 0.22) {                                 // windows (some towers unlit)
        // LIT FLOOR bands + occasional server-floor hue, over the random grid
        const litFloorY = rng() < 0.3 ? MID_H - bh + 16 + rng() * Math.max(14, bh - 50) : -999;
        const serverFloor = rng() < 0.16;
        const stepX = 11 + rng() * 4, stepY = 14 + rng() * 4;
        for (let wx = x + 6; wx < x + bw - 8; wx += stepX) {
          for (let wy = MID_H - bh + 8; wy < MID_H - 12; wy += stepY) {
            const onFloor = wy > litFloorY - stepY * 0.55 && wy < litFloorY + stepY * 0.55;
            if (onFloor || rng() < 0.2) {
              const warm = serverFloor ? false : rng() < 0.8;
              const a = onFloor ? 0.6 + rng() * 0.35 : 0.5 + rng() * 0.42;
              g.fillStyle = serverFloor
                ? `rgba(120,150,255,${(a * 0.75).toFixed(3)})`
                : warm ? `rgba(255,184,119,${a.toFixed(3)})` : `rgba(141,240,226,${a.toFixed(3)})`;
              g.fillRect(wx, wy, 3, 4);
            }
          }
        }
      }
      if (bw > 130) cands.push({ bx: x, bw, bh });
      x += bw + (rng() < 0.35 ? 12 + rng() * 40 : 0);
    }
    if (cands.length >= 3) {                               // 5 neon signs, BAKED
      for (let k = 0; k < 5; k++) {
        let idx = (cands.length * (0.1 + 0.2 * k) + rng() * 2) | 0;
        if (idx >= cands.length) idx = cands.length - 1;
        const b = cands[idx];
        const sw = Math.min(116, b.bw - 30);
        const sh = 24 + rng() * 14;
        const ci = k % SIGN_INK.length;
        const y0 = MID_H - (40 + rng() * Math.max(10, b.bh - sh - 60));
        const x0 = b.bx + b.bw * 0.5 - sw * 0.5;
        // static neon panel + glyph, baked into the tile — no rounded-rect
        // paths, strokes, glow passes or flicker state machines per frame
        g.globalAlpha = 0.92;
        g.fillStyle = SIGN_PANEL;
        rrPath(g, x0, y0, sw, sh, 4);
        g.fill();
        g.globalAlpha = 0.6;
        g.strokeStyle = SIGN_BORDER[ci];
        g.stroke();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.3;
        g.drawImage(this.glyphSpr[ci], x0 + 5 - (sw - 10) * 0.38, y0 + 5 - (sh - 10) * 0.45, (sw - 10) * 1.76, (sh - 10) * 1.9);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.85;
        g.drawImage(this.glyphSpr[ci], x0 + 5, y0 + 5, sw - 10, sh - 10);
        g.globalAlpha = 1;
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
    // AERIAL FOCUS (mid): lighter than the far plate — the action plane
    // stays crisp, only the depth layers soften (wrap-aware bake blur).
    const blurred = makeCanvas(TILE, MID_H);
    blurred.g.filter = 'blur(1.1px)';
    blurred.g.drawImage(c, -TILE, 0);
    blurred.g.drawImage(c, 0, 0);
    blurred.g.drawImage(c, TILE, 0);
    blurred.g.filter = 'none';
    return blurred.c;
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
      const clutter = rng();                               // near-lane roof dressing
      if (clutter < 0.16 && bw > 170) {                    // water tower silhouette
        const tw = 26 + rng() * 16, th = 26 + rng() * 18;
        const tx = x + 14 + rng() * (bw - tw - 28);
        const ty = NEAR_H - bh - th - 10;
        g.fillStyle = '#04080b';
        g.fillRect(tx, ty, tw, th);
        g.beginPath();                                     // conical roof
        g.moveTo(tx - 3, ty);
        g.lineTo(tx + tw / 2, ty - 9 - rng() * 6);
        g.lineTo(tx + tw + 3, ty);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(24,34,40,0.95)';             // splayed legs
        g.lineWidth = 2;
        for (let li = 0; li < 3; li++) {
          const lx = tx + 3 + (li * (tw - 6)) / 2;
          g.beginPath();
          g.moveTo(lx, ty + th);
          g.lineTo(lx + (li - 1) * 5, NEAR_H - bh);
          g.stroke();
        }
        g.fillStyle = 'rgba(70,94,102,0.12)';              // tank sheen
        g.fillRect(tx, ty, 2, th);
      } else if (clutter < 0.27 && bw > 150) {             // billboard, seen from behind
        const bwi = Math.min(120, bw - 50), bhei = 40 + rng() * 22;
        const bx0 = x + 24 + rng() * Math.max(4, bw - bwi - 48);
        const by0 = NEAR_H - bh - bhei - 16;
        g.strokeStyle = 'rgba(20,30,36,0.95)';             // two posts
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(bx0 + 10, by0 + bhei);
        g.lineTo(bx0 + 10, by0 + bhei + 16);
        g.moveTo(bx0 + bwi - 10, by0 + bhei);
        g.lineTo(bx0 + bwi - 10, by0 + bhei + 16);
        g.stroke();
        g.fillStyle = '#060b0f';                           // back panel
        g.fillRect(bx0, by0, bwi, bhei);
        g.strokeStyle = 'rgba(50,66,74,0.5)';              // frame + cross brace
        g.lineWidth = 2;
        g.strokeRect(bx0 + 1, by0 + 1, bwi - 2, bhei - 2);
        g.beginPath();
        g.moveTo(bx0 + 4, by0 + 4);
        g.lineTo(bx0 + bwi - 4, by0 + bhei - 4);
        g.moveTo(bx0 + bwi - 4, by0 + 4);
        g.lineTo(bx0 + 4, by0 + bhei - 4);
        g.stroke();
      } else if (clutter < 0.38 && bw > 130) {             // AC box with fan circle
        const aw = 20 + rng() * 16, ah = 12 + rng() * 8;
        const ax2 = x + 10 + rng() * Math.max(4, bw - aw - 20);
        const ay = NEAR_H - bh - ah;
        g.fillStyle = '#04080b';
        g.fillRect(ax2, ay, aw, ah);
        g.strokeStyle = 'rgba(80,104,116,0.4)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(ax2 + aw * 0.5, ay + ah * 0.5, Math.min(aw, ah) * 0.32, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(60,84,94,0.16)';
        g.fillRect(ax2, ay, aw, 1);
      }
      if (rng() < 0.16) {                                  // red obstruction light
        const rx2 = x + 8 + rng() * Math.max(4, bw - 16);
        g.fillStyle = 'rgba(255,80,60,0.18)';
        g.fillRect(rx2 - 2, NEAR_H - bh - 4, 6, 6);
        g.fillStyle = 'rgba(255,80,60,0.6)';
        g.fillRect(rx2, NEAR_H - bh - 2, 2, 2);
      }
      if (rng() < 0.3 && bh > 200) {                       // facade utility pipes
        const px = x + 10 + rng() * Math.max(4, bw - 20);
        g.strokeStyle = 'rgba(46,60,68,0.7)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, NEAR_H - bh + 8);
        g.lineTo(px, NEAR_H - 6);
        g.stroke();
        g.strokeStyle = 'rgba(90,114,124,0.25)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px - 1.5, NEAR_H - bh + 8);
        g.lineTo(px - 1.5, NEAR_H - 6);
        g.stroke();
      }
      if (rng() < 0.7) {                                   // windows + lit floor bands
        const litFloorY = rng() < 0.3
          ? NEAR_H - bh + 20 + rng() * Math.max(16, bh - 60)
          : -999;
        const stepYN = 23 + rng() * 9;
        for (let wx = x + 10; wx < x + bw - 10; wx += 17 + rng() * 8) {
          for (let wy = NEAR_H - bh + 12; wy < NEAR_H - 20; wy += stepYN) {
            g.fillStyle = 'rgba(10,16,22,0.5)';             // unlit cell (facade grid)
            g.fillRect(wx, wy, 2, 2);
            const onFloor = wy > litFloorY - stepYN * 0.55 && wy < litFloorY + stepYN * 0.55;
            if (onFloor || rng() < 0.08) {
              const a = onFloor ? 0.5 + rng() * 0.3 : 0.42;
              g.fillStyle = onFloor && rng() < 0.7
                ? `rgba(230,190,140,${a.toFixed(3)})`
                : `rgba(84,112,122,${a.toFixed(3)})`;
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
    for (let i = 0; i < 4 && i < sorted.length; i++) {     // elevator lights, baked
      const tw = sorted[i];
      const lx = tw.x + 6 + rng() * Math.max(2, tw.w - 12);
      const ly = NEAR_H - (tw.h - 8) * 0.5;                // mid-travel position
      const ci = rng() < 0.6 ? 0 : 1;
      g.fillStyle = LIFT_COL[ci];
      g.globalAlpha = 0.75;
      g.fillRect(lx - 1, ly - 2, 2, 3);
      g.globalAlpha = 0.12;
      g.fillRect(lx - 0.5, ly - 9, 1, 10);
      g.globalAlpha = 1;
    }
    // sweeping searchlights removed with the engines strip
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

    /* PROP GROUNDING — baked, zero live state. The stage's two practicals
     * are anchored to the deck again: a broad static moon wash, contact
     * ellipses under the stairwell and the broken streetlight, and the
     * lamp's own ground pool. (These were deleted by c857433's live-shadow
     * removal and never restored — the props floated until now.) */
    const doorX = DOOR_X - ARENA_X0;                      // tile coords
    const lampX = LAMP_X - ARENA_X0;
    const wash = g.createLinearGradient(0, LIP_H, 0, 150);
    wash.addColorStop(0, 'rgba(178,202,232,0.10)');
    wash.addColorStop(0.55, 'rgba(178,202,232,0.055)');
    wash.addColorStop(1, 'rgba(178,202,232,0)');
    g.fillStyle = wash;
    g.fillRect(0, LIP_H, W, 150 - LIP_H);
    // stairwell contact — the head-house meets the deck
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(doorX, 18, 150, 19, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.beginPath();
    g.ellipse(doorX, 16, 104, 12, 0, 0, TAU);
    g.fill();
    // broken streetlight — its own pool + contact under the pole base
    g.fillStyle = 'rgba(178,202,232,0.07)';
    g.beginPath();
    g.ellipse(lampX, 56, 96, 11, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(lampX, 7, 44, 9, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath();
    g.ellipse(lampX, 6, 28, 5, 0, 0, TAU);
    g.fill();
    return c;
  }

  /** WET-DECK ROUGHNESS MASK — static world-space plate over the mirror
   *  band. Matte micro-striation + dry islands chop the reflection into
   *  wet-asphalt character; destination-out PUDDLE WINDOWS let the sharp
   *  mirror through, each with a moonlit specular rim on the moon side.
   *  Pre-baked: one blit per frame, zero allocs. */

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

  /** directional key's diffuse pool on the deck — the LIT SURFACE that makes
   *  the shadows read (shadows on unlit ground are invisible). */

  /** spot-light cone cross-section (UE spot: hot inner disc + soft outer) */

  /** drifting steam wisp for roof vents (environment life) */

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
