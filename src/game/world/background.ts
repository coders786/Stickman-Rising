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

export type Quality = 'low' | 'medium' | 'high';

export interface BgCam {
  /** camera center in world coordinates */
  x: number;
  y: number;
  zoom: number;
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
  { f: 0.1, oy: -70, a: 0.035, sp: 7, ph: 0.0 },
  { f: 0.16, oy: -16, a: 0.05, sp: -5, ph: 2.1 },
  { f: 0.22, oy: 30, a: 0.06, sp: 9, ph: 4.4 },
];

/* ============================ fixed palettes ============================= */

const SKY_BELOW = '#070d12';
const TWINK_COL = '#cfe0e8';
const BEACON_CORE = '#ff5040';
const SIGN_PANEL = '#04070a';
const SIGN_INK: ReadonlyArray<string> = ['#ff2d95', '#29e6d2', '#ffb02e'];
const SIGN_CORE: ReadonlyArray<string> = ['#ffd7ec', '#d9fff8', '#ffe9c6'];
const SIGN_BORDER: ReadonlyArray<string> = [
  'rgba(255,45,149,0.55)', 'rgba(41,230,210,0.55)', 'rgba(255,176,46,0.55)',
];
const LIFT_COL: ReadonlyArray<string> = ['#ffd9a0', '#9df0e2'];
const SVC_COL = '#ffb02e';
const RIPPLE_COL = '#a9c6d8';
const FLASH_COL = '#cdd9ec';
const RAIN_TIP = 'rgba(214,236,246,0.16)';
const RAIN_STYLES: ReadonlyArray<string> = [
  'rgba(173,196,210,0.05)', 'rgba(173,196,210,0.063)', 'rgba(173,196,210,0.076)',
  'rgba(173,196,210,0.089)', 'rgba(173,196,210,0.102)', 'rgba(173,196,210,0.115)',
  'rgba(173,196,210,0.128)', 'rgba(173,196,210,0.14)',
];
const MOTE_STYLES: ReadonlyArray<string> = [
  'rgba(205,225,232,0.03)', 'rgba(205,225,232,0.045)',
  'rgba(205,225,232,0.06)', 'rgba(205,225,232,0.08)',
];

/* ======================== animated-record shapes ========================= */

interface TwinkRec { x: number; y: number; ph: number; sp: number }
interface BeaconRec { x: number; yA: number; ph: number; sp: number }
interface SignRec { x: number; yA: number; w: number; h: number; ci: number; ph: number; state: number; timer: number; next: number }
interface LiftRec { x: number; yA0: number; yA1: number; sp: number; ph: number; ci: number }
interface BeamRec { x: number; yA: number; amp: number; sp: number; ph: number }
interface RippleRec { wx: number; oy: number; ph: number; sp: number; r: number }
interface PuddleRec { x: number; rx: number; ry: number; ci: number; ph: number; sp: number }
interface SvcRec { x: number; y: number; ph: number; sp: number }
interface GlyphStroke { x0: number; y0: number; x1: number; y1: number; dot: boolean }

/* ======================= static sprite pre-renders ======================= */

/** vertical sky gradient strip (stretched to 0..horizon at draw time) */
function buildSkyStrip(): HTMLCanvasElement {
  const { c, g } = makeCanvas(8, 600);
  const gr = g.createLinearGradient(0, 0, 0, 600);
  gr.addColorStop(0, '#04070c');
  gr.addColorStop(0.42, '#081019');
  gr.addColorStop(0.62, '#0a1118');
  gr.addColorStop(0.8, '#0e1720');
  gr.addColorStop(0.9, '#16222b');      // faint horizon glow
  gr.addColorStop(0.955, '#252a22');    // subtle warm smog band just above horizon
  gr.addColorStop(1, '#121b20');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 600);
  return c;
}

/** dim moon disc + halo */
function buildMoon(): HTMLCanvasElement {
  const { c, g } = makeCanvas(160, 160);
  let gr = g.createRadialGradient(80, 80, 30, 80, 80, 79);
  gr.addColorStop(0, 'rgba(150,178,184,0.16)');
  gr.addColorStop(1, 'rgba(150,178,184,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 160, 160);
  gr = g.createRadialGradient(72, 72, 6, 80, 80, 34);
  gr.addColorStop(0, '#c4d0d3');
  gr.addColorStop(1, '#8b9ca0');
  g.fillStyle = gr;
  g.beginPath(); g.arc(80, 80, 34, 0, TAU); g.fill();
  g.fillStyle = 'rgba(66,84,88,0.2)';                     // faint craters
  g.beginPath(); g.arc(68, 70, 7, 0, TAU); g.fill();
  g.beginPath(); g.arc(88, 92, 5, 0, TAU); g.fill();
  g.beginPath(); g.arc(93, 66, 3.5, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(214,229,232,0.28)';
  g.lineWidth = 1;
  g.beginPath(); g.arc(80, 80, 34, 0, TAU); g.stroke();
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
  private slant = 0.72;        // rain slant dx/dy, animated in update()
  private fogCount = 3;

  /* pre-rendered art (built once, resolution independent) */
  private built = false;
  private skyStrip!: HTMLCanvasElement;
  private starTile!: HTMLCanvasElement;
  private moonSpr!: HTMLCanvasElement;
  private farTile!: HTMLCanvasElement;
  private midTile!: HTMLCanvasElement;
  private nearTile!: HTMLCanvasElement;
  private arenaTile!: HTMLCanvasElement;
  private fogSpr!: HTMLCanvasElement;
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
  private svcLights: SvcRec[] = [];

  /* weather particles (preallocated, wrap-indexed in place) */
  private rainCap: number;
  private rainX: Float32Array;
  private rainY: Float32Array;
  private rainL: Float32Array;
  private rainS: Float32Array;
  private rainB: Uint8Array;
  private moteCap: number;
  private moteX: Float32Array;
  private moteY: Float32Array;
  private moteP: Float32Array;
  private moteB: Uint8Array;
  private ripples: RippleRec[] = [];

  /* distant lightning state */
  private ltnT = -1;
  private ltnNext = 6;

  constructor(quality: Quality) {
    this.rainCap = quality === 'high' ? 130 : quality === 'medium' ? 70 : 0;
    this.moteCap = quality === 'high' ? 20 : quality === 'medium' ? 10 : 0;
    this.fogCount = quality === 'low' ? 2 : 3;
    const nRain = this.rainCap, nMote = this.moteCap;
    this.rainX = new Float32Array(nRain);
    this.rainY = new Float32Array(nRain);
    this.rainL = new Float32Array(nRain);
    this.rainS = new Float32Array(nRain);
    this.rainB = new Uint8Array(nRain);
    this.moteX = new Float32Array(nMote);
    this.moteY = new Float32Array(nMote);
    this.moteP = new Float32Array(nMote);
    this.moteB = new Uint8Array(nMote);
    // deterministic first scatter for rain / motes / ripples
    const rng = mulberry32(0x5170394);
    for (let i = 0; i < nRain; i++) {
      this.rainX[i] = rng() * 1360 - 40;
      this.rainY[i] = rng() * 800 - 40;
      this.rainL[i] = 10 + rng() * 16;
      this.rainS[i] = 480 + rng() * 300;
      this.rainB[i] = (rng() * 8) | 0;
    }
    for (let i = 0; i < nMote; i++) {
      this.moteX[i] = rng() * 1320 - 20;
      this.moteY[i] = rng() * 760 - 20;
      this.moteP[i] = rng() * TAU;
      this.moteB[i] = (rng() * 4) | 0;
    }
    for (let i = 0; i < 10; i++) {
      this.ripples.push({ wx: 140 + rng() * 2470, oy: 3 + rng() * 9, ph: rng(), sp: 0.45 + rng() * 0.4, r: 6 + rng() * 8 });
    }
    this.ltnNext = 4 + rng() * 6;
  }

  /** CSS-pixel size of the game canvas viewport. */
  resize(w: number, h: number): void {
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
    this.slant = 0.72 + 0.16 * Math.sin(t * 0.09) + 0.08 * Math.sin(t * 0.037 + 2.1);

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

    /* rain + motes (in-place wrap, no allocations) */
    if (this.rainCap > 0) {
      const w = this.vw, h = this.vh, sl = this.slant;
      for (let i = 0; i < this.rainCap; i++) {
        let y = this.rainY[i] + this.rainS[i] * d;
        let x = this.rainX[i] + this.rainS[i] * sl * d;
        if (y > h + 40) { y = -30 - Math.random() * 90; x = Math.random() * (w + 80) - 40; }
        if (x > w + 40) x -= w + 80;
        else if (x < -40) x += w + 80;
        this.rainX[i] = x;
        this.rainY[i] = y;
      }
    }
    if (this.moteCap > 0) {
      for (let i = 0; i < this.moteCap; i++) {
        const ph = this.moteP[i];
        let x = this.moteX[i] + (5 + 3 * Math.sin(t * 0.05 + ph)) * d;
        let y = this.moteY[i] + Math.sin(t * 0.21 + ph) * 5 * d;
        if (x > this.vw + 20) x -= this.vw + 40;
        if (y > this.vh + 20) y -= this.vh + 40;
        else if (y < -20) y += this.vh + 40;
        this.moteX[i] = x;
        this.moteY[i] = y;
      }
    }

    /* distant lightning scheduler (8..15 s cadence) */
    if (this.ltnT >= 0) {
      this.ltnT += d;
      if (this.ltnT > 1) this.ltnT = -1;
    } else {
      this.ltnNext -= d;
      if (this.ltnNext <= 0) { this.ltnT = 0; this.ltnNext = 8 + Math.random() * 7; }
    }
  }

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
    const skyH = hy > 1 ? (hy < h ? hy : h) : 1;
    ctx.drawImage(this.skyStrip, 0, 0, 8, 600, 0, 0, w, skyH);
    ctx.fillStyle = SKY_BELOW;
    this.fillBelow(ctx, hy);

    /* 2 — stars + moon (celestial parallax) */
    const starBase = hy - 70 > h * 0.25 ? hy - 70 : h * 0.25;
    const ms = mod(cx * 0.02 * cz, TILE);
    this.blitRow(ctx, this.starTile, ms, starBase - STAR_H);
    ctx.fillStyle = TWINK_COL;
    for (let i = 0; i < this.twinks.length; i++) {
      const tr = this.twinks[i];
      ctx.globalAlpha = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(t * tr.sp + tr.ph));
      const sy = starBase - STAR_H + tr.y;
      for (let x = mod(tr.x - ms, TILE) - TILE; x < w + 3; x += TILE) {
        if (x > -3) ctx.fillRect(x, sy, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.moonSpr, w * 0.62 - cx * 0.03 * cz - 80, h * 0.16 - (cy - NOMINAL_Y) * 0.08 * cz - 80);

    /* 3 — far mega-city (parallax 0.05) + blinking antenna beacons */
    const byF = h * 0.5 + (LAY_FAR.lift - cy * LAY_FAR.vf) * cz;
    const mF = mod(cx * LAY_FAR.f * cz, TILE);
    ctx.fillStyle = LAY_FAR.below;
    this.fillBelow(ctx, byF);
    this.blitRow(ctx, this.farTile, mF, byF - FAR_H);
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

    /* 4 — mid city (parallax 0.14) + flickering neon signs */
    const byM = h * 0.5 + (LAY_MID.lift - cy * LAY_MID.vf) * cz;
    const mM = mod(cx * LAY_MID.f * cz, TILE);
    ctx.fillStyle = LAY_MID.below;
    this.fillBelow(ctx, byM);
    this.blitRow(ctx, this.midTile, mM, byM - MID_H);
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
        ctx.globalAlpha = a * 0.22;
        ctx.drawImage(this.glyphSpr[s.ci], x + 5 - iw * 0.38, y0 + 5 - ih * 0.45, iw * 1.76, ih * 1.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
        ctx.drawImage(this.glyphSpr[s.ci], x + 5, y0 + 5, iw, ih);
      }
    }
    ctx.globalAlpha = 1;

    /* 5 — near-mid towers (parallax 0.30): elevator dots + searchlights */
    const byN = h * 0.5 + (LAY_NEAR.lift - cy * LAY_NEAR.vf) * cz;
    const mN = mod(cx * LAY_NEAR.f * cz, TILE);
    ctx.fillStyle = LAY_NEAR.below;
    this.fillBelow(ctx, byN);
    this.blitRow(ctx, this.nearTile, mN, byN - NEAR_H);
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

    /* 6 — drifting fog bands */
    for (let i = 0; i < this.fogCount; i++) {
      const F = FOG_BANDS[i];
      const fy = hy + F.oy - (cy - NOMINAL_Y) * 0.15 * cz;
      ctx.globalAlpha = F.a * (0.85 + 0.15 * Math.sin(t * 0.05 + F.ph));
      const off = mod(t * F.sp - cx * F.f * cz, FOG_W);
      for (let x = off - FOG_W; x < w; x += FOG_W) {
        ctx.drawImage(this.fogSpr, x, fy - FOG_H * 0.5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ----------------------- world-space arena pass ------------------------ */

  drawArena(ctx: CanvasRenderingContext2D): void {
    this.ensureBuilt();
    const t = this.t;
    ctx.drawImage(this.arenaTile, ARENA_X0, 0);            // lip + facade (y 0..260)
    // shimmering neon puddles
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i];
      let a = this.puddleA[i];
      if (!(a >= 0.12)) a = 0.12;
      ctx.globalAlpha = a;
      ctx.drawImage(this.puddleSpr[p.ci], p.x - p.rx, 7.5 - p.ry, p.rx * 2, p.ry * 2);
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

  drawWeather(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensureBuilt();
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y;
    const cz = Number.isFinite(cam.zoom) ? cam.zoom : 1;
    const w = this.vw, h = this.vh, t = this.t;

    ctx.save();
    ctx.lineCap = 'round';

    /* rain streaks (quality-scaled) — batched per alpha bucket */
    if (this.rainCap > 0) {
      const ox = -cx * cz * 0.5, oy = -(cy - NOMINAL_Y) * cz * 0.3;
      const inv = 1 / Math.sqrt(1 + this.slant * this.slant);
      const ux = this.slant * inv, uy = inv;
      const wrapW = w + 80, wrapH = h + 80;
      for (let b = 0; b < 8; b++) {
        ctx.strokeStyle = RAIN_STYLES[b];
        ctx.beginPath();
        for (let i = 0; i < this.rainCap; i++) {
          if (this.rainB[i] !== b) continue;
          const x = mod(this.rainX[i] + ox, wrapW) - 40;
          const y = mod(this.rainY[i] + oy, wrapH) - 40;
          ctx.moveTo(x, y);
          ctx.lineTo(x - ux * this.rainL[i], y - uy * this.rainL[i]);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = RAIN_TIP;                          // subtle bright tips
      ctx.beginPath();
      for (let i = 0; i < this.rainCap; i++) {
        if (this.rainB[i] < 4) continue;
        const x = mod(this.rainX[i] + ox, wrapW) - 40;
        const y = mod(this.rainY[i] + oy, wrapH) - 40;
        ctx.moveTo(x, y);
        ctx.lineTo(x - ux * 4, y - uy * 4);
      }
      ctx.stroke();

      /* tiny ripple ellipses pinned to the arena floor */
      const hy = h * 0.5 + (0 - cy) * cz;
      if (hy > -30 && hy < h + 40) {
        ctx.strokeStyle = RIPPLE_COL;
        ctx.lineWidth = 1;
        for (let i = 0; i < this.ripples.length; i++) {
          const r = this.ripples[i];
          let u = (t * r.sp + r.ph) % 1;
          if (u < 0) u += 1;
          const sx = w * 0.5 + (r.wx - cx) * cz;
          if (sx < -24 || sx > w + 24) continue;
          const e = Math.sin(u * Math.PI);
          ctx.globalAlpha = e * e * 0.12;
          ctx.beginPath();
          ctx.ellipse(sx, hy + r.oy * cz, r.r * (0.3 + 0.7 * u) * cz, r.r * (0.3 + 0.7 * u) * cz * 0.24, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    /* drifting motes */
    if (this.moteCap > 0) {
      const ox = -cx * cz * 0.22, oy = -(cy - NOMINAL_Y) * cz * 0.15;
      const wrapW = w + 40, wrapH = h + 40;
      for (let b = 0; b < 4; b++) {
        ctx.fillStyle = MOTE_STYLES[b];
        for (let i = 0; i < this.moteCap; i++) {
          if (this.moteB[i] !== b) continue;
          ctx.fillRect(mod(this.moteX[i] + ox, wrapW) - 20, mod(this.moteY[i] + oy, wrapH) - 20, 2, 2);
        }
      }
    }

    /* distant lightning — 2-frame silhouette flash, then a slow fade */
    if (this.ltnT >= 0) {
      const u = this.ltnT;
      let I = 0;
      if (u < 0.05) I = 1;
      else if (u < 0.09) I = 0.22;
      else if (u < 0.14) I = 0.78;
      else I = 0.78 * Math.exp(-(u - 0.14) * 7);
      if (I > 0.012) {
        ctx.globalAlpha = 0.085 * I;
        ctx.fillStyle = FLASH_COL;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
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
    this.fogSpr = buildFogSprite();
    this.beamSpr = buildBeamSprite();
    this.beaconSpr = buildBeaconSprite();
    this.puddleSpr = buildPuddleSprites();
    for (let ci = 0; ci < 3; ci++) this.glyphSpr.push(buildGlyph(ci));
    this.starTile = this.buildStarTile();
    this.farTile = this.buildFar();
    this.midTile = this.buildMid();
    this.nearTile = this.buildNear();
    this.arenaTile = this.buildArena();
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
      this.twinks.push({ x: rng() * TILE, y: 170 + rng() * 260, ph: rng() * TAU, sp: 1.4 + rng() * 2.4 });
    }
    return c;
  }

  private buildFar(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, FAR_H);
    const rng = mulberry32(0xc1f3a0);
    const shades = ['#0b1219', '#0d151d', '#0e1720', '#101a24'];
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
      for (let wx = x + 4; wx < x + bw - 4; wx += stepX) { // sparse lit windows
        for (let wy = FAR_H - bh + 5; wy < FAR_H - 6; wy += stepY) {
          if (rng() < 0.085) {
            const warm = rng() < 0.82;
            const a = 0.4 + rng() * 0.4;
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
    return c;
  }

  private buildMid(): HTMLCanvasElement {
    const { c, g } = makeCanvas(TILE, MID_H);
    const rng = mulberry32(0x2b6e5f);
    const shades = ['#081014', '#0a141a', '#0b171d', '#0c181e'];
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
      if (rng() >= 0.3) {                                  // windows (some towers unlit)
        const stepX = 11 + rng() * 4, stepY = 14 + rng() * 4;
        for (let wx = x + 6; wx < x + bw - 8; wx += stepX) {
          for (let wy = MID_H - bh + 8; wy < MID_H - 12; wy += stepY) {
            if (rng() < 0.1) {
              const warm = rng() < 0.8;
              const a = 0.38 + rng() * 0.34;
              g.fillStyle = warm ? `rgba(255,184,119,${a.toFixed(3)})` : `rgba(141,240,226,${a.toFixed(3)})`;
              g.fillRect(wx, wy, 3, 4);
            }
          }
        }
      }
      if (bw > 130) cands.push({ bx: x, bw, bh });
      x += bw + (rng() < 0.35 ? 12 + rng() * 40 : 0);
    }
    if (cands.length >= 3) {                               // 3 neon signs, spread out
      for (let k = 0; k < 3; k++) {
        let idx = (cands.length * (0.18 + 0.32 * k) + rng() * 2) | 0;
        if (idx >= cands.length) idx = cands.length - 1;
        const b = cands[idx];
        const sw = Math.min(116, b.bw - 30);
        const sh = 24 + rng() * 14;
        this.signs.push({
          x: b.bx + b.bw * 0.5,
          yA: 40 + rng() * Math.max(10, b.bh - sh - 60),
          w: sw,
          h: sh,
          ci: k,
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
      g.fillStyle = 'rgba(52,74,84,0.22)';                 // parapet
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
            if (rng() < 0.035) {
              g.fillStyle = 'rgba(64,86,92,0.3)';
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
    return c;
  }

  /* ------------------------ arena tile (world 1:1) ----------------------- */

  private buildArena(): HTMLCanvasElement {
    const { c, g } = makeCanvas(ARENA_W, LIP_H + FACADE_H);
    const rng = mulberry32(0x5eed11);
    const W = ARENA_W, H = LIP_H + FACADE_H;

    /* rooftop lip (world y 0..14) */
    let gr = g.createLinearGradient(0, 0, 0, LIP_H);
    gr.addColorStop(0, '#242c33');
    gr.addColorStop(0.45, '#2d363d');
    gr.addColorStop(1, '#1b2227');
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
    gr.addColorStop(0.5, 'rgba(160,185,195,0.05)');
    gr.addColorStop(1, 'rgba(160,185,195,0)');
    g.fillStyle = gr;
    g.fillRect(700, 2, 800, 11);
    this.hazardTrim(g, rng, 0, 44);                        // worn edge trim
    this.hazardTrim(g, rng, W - 44, 44);

    /* facade (world y 14..260): X-braced girder skeleton */
    gr = g.createLinearGradient(0, LIP_H, 0, H);
    gr.addColorStop(0, '#151c22');
    gr.addColorStop(0.22, '#0d1319');
    gr.addColorStop(0.5, '#070c10');
    gr.addColorStop(0.82, '#020407');
    gr.addColorStop(1, '#000306');
    g.fillStyle = gr;
    g.fillRect(0, LIP_H, W, FACADE_H);
    for (let cx0 = 8; cx0 < W - 240; cx0 += 232) {         // X-braced bays
      const cx1 = cx0 + 232;
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(24,33,41,0.85)';
      g.beginPath(); g.moveTo(cx0 + 6, 49); g.lineTo(cx1 - 6, 116); g.stroke();
      g.beginPath(); g.moveTo(cx1 - 6, 49); g.lineTo(cx0 + 6, 116); g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(20,28,35,0.6)';
      g.beginPath(); g.moveTo(cx0 + 6, 129); g.lineTo(cx1 - 6, 206); g.stroke();
      g.beginPath(); g.moveTo(cx1 - 6, 129); g.lineTo(cx0 + 6, 206); g.stroke();
    }
    g.fillStyle = '#18212a';                               // horizontal beams
    g.fillRect(0, 36, W, 11);
    g.fillStyle = 'rgba(80,102,112,0.22)';
    g.fillRect(0, 36, W, 1);
    g.fillStyle = '#141d25';
    g.fillRect(0, 118, W, 9);
    g.fillStyle = 'rgba(70,92,102,0.18)';
    g.fillRect(0, 118, W, 1);
    g.fillStyle = '#121a22';
    g.fillRect(0, 168, W, 3);
    for (let cx0 = 8; cx0 < W; cx0 += 232) {               // columns
      g.fillStyle = '#1a232b';
      g.fillRect(cx0, LIP_H, 10, H - LIP_H);
      g.fillStyle = 'rgba(70,92,102,0.25)';
      g.fillRect(cx0, LIP_H, 1, H - LIP_H);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(cx0 + 9, LIP_H, 1, H - LIP_H);
    }
    for (let rx = 14; rx < W; rx += 58) {                  // rivets
      g.fillStyle = '#0a0f13';
      g.fillRect(rx, 40, 2, 2);
      g.fillRect(rx, 121, 2, 2);
    }
    gr = g.createLinearGradient(0, 120, 0, 255);           // fade into darkness
    gr.addColorStop(0, 'rgba(2,5,8,0)');
    gr.addColorStop(1, 'rgba(2,5,8,0.96)');
    g.fillStyle = gr;
    g.fillRect(0, 120, W, 135);
    g.fillStyle = '#010304';
    g.fillRect(0, 252, W, 8);
    g.fillStyle = 'rgba(0,0,0,0.6)';                       // end caps
    g.fillRect(0, 0, 2, H);
    g.fillRect(W - 2, 0, 2, H);
    g.fillStyle = 'rgba(90,110,120,0.12)';
    g.fillRect(2, LIP_H, 1, H - LIP_H);
    g.fillRect(W - 3, LIP_H, 1, H - LIP_H);

    /* animated decal records (world coords) */
    for (let i = 0; i < 6; i++) {
      const rx = 18 + rng() * 24;
      this.puddles.push({
        x: 130 + rng() * 2340,
        rx,
        ry: Math.max(3, Math.min(6, rx * 0.13)),
        ci: rng() < 0.5 ? 0 : 1,
        ph: rng() * TAU,
        sp: 0.7 + rng() * 1.3,
      });
    }
    this.puddleA = new Float32Array(this.puddles.length);
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
