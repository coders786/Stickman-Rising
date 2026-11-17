import {StormEngine} from './storm'
import {FOG} from '../render/look'
import { SkyVaultCache, blitWorldFrustum } from '../render/bhst'
import { MOOD_PALETTES, moodForSeed, type MoodPalette } from './mood'
import { makeProfile, type EnvironmentProfile } from './profile'
import { NightLayer } from './night'

/** the broken streetlight's world x — the stage's second practical (was
 *  STREET_LIGHT from the deleted lighting engine) */
const LAMP_X = 830
/** stylized moon plate: bake size and on-screen draw size */
const MOON_D = 210
const MOON_HALF = MOON_D * 0.5
const MOON_HALO_D = 402
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
  /** OPTIONAL: re-seed the procedural skyline for a fresh run. Invalidates
   *  the baked tiles; the rebuild happens once, before the next frame. */
  setRunSeed?(seed:number):void
  lightningI():number
  lightningAz():number
  drawSky(ctx:CanvasRenderingContext2D,cam:BgCam):void
  drawArena(ctx:CanvasRenderingContext2D):void
  /** OPTIONAL foreground pass — world-space, drawn AFTER the entities so
   *  near-lane dressing occludes fighters. */
  drawFront?(ctx:CanvasRenderingContext2D):void
  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void
  /** V3 reactive layer (optional so lightweight test doubles stay valid) */
  practicalLight?(x: number): { warm: number; cool: number }
  drawPlayerLight?(ctx: CanvasRenderingContext2D, px: number, py: number, face?: number): void
  drawReflections?(ctx: CanvasRenderingContext2D, cam: BgCam, quality: Quality): void
  /** The run identity (world/profile.ts). Optional so the test doubles and the
   *  HUD-only renderers do not need a night. */
  getProfile?(): EnvironmentProfile | null
  /** Which path baked this run's plates ('gpu' = the WebGL2 baker ran). */
  plateStats?(): ReturnType<NightLayer['stats']> | null
  /** Bake the run's plates now and report the cost in ms (see warm above). */
  warm?(): number
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

/* ============================================================================
 * ADVANCED PRE-BAKED LIGHTING + PROCEDURAL ARCHETYPE TOOLKIT
 * ----------------------------------------------------------------------------
 * Everything below runs ONCE inside build*(). Nothing here is on the frame
 * path — no shaders, no WebGL, no live lights, no per-frame gradients. The
 * techniques follow the standard baked-lightmap practice: emissive windows
 * spill soft radial light onto their own facade, a single directional key
 * gives every extrusion a lit face / shadow face / contact AO, and skewed
 * shadow volumes are projected onto neighbouring geometry with source-atop.
 * Reflections use the canonical cheap 2D trick: a vertically FLIPPED sprite
 * with a baked vertical alpha fade — one drawImage, zero live mirror cost.
 * ==========================================================================*/

/** one soft radial light disc, baked once, reused for every emissive source */
function buildGlowDisc(rgb: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},0.9)`);
  gr.addColorStop(0.32, `rgba(${rgb},0.3)`);
  gr.addColorStop(0.7, `rgba(${rgb},0.07)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** EMISSIVE LIGHTMAP SPILL — additive soft light from a source onto its
 *  surrounding surface. Baked into the tile, so the facade looks lit by its
 *  own windows/signs at zero runtime cost. */
function bakeSpill(g: CanvasRenderingContext2D, disc: HTMLCanvasElement, cx: number, cy: number, r: number, a: number): void {
  // Guard: drawImage throws a hard TypeError on undefined. A bake order slip
  // must never take the whole render loop down — skip the spill instead.
  if (!disc) return;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = a;
  g.drawImage(disc, cx - r, cy - r, r * 2, r * 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/** DIRECTIONAL 3D KEY — one moon from the upper right: lit right face,
 *  occluded left face, a diagonal falloff across the plane, and ledge AO
 *  where a horizontal surface bites into the wall below it. */
function bake3DKey(g: CanvasRenderingContext2D, x: number, topY: number, bw: number, bh: number, s: number): void {
  const gr = g.createLinearGradient(x + bw, topY, x, topY + bh);
  gr.addColorStop(0, `rgba(186,216,246,${(0.075 * s).toFixed(3)})`);
  gr.addColorStop(0.52, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(2,5,10,${(0.2 * s).toFixed(3)})`);
  g.fillStyle = gr;
  g.fillRect(x, topY, bw, bh);
  g.fillStyle = `rgba(190,220,250,${(0.1 * s).toFixed(3)})`;
  g.fillRect(x + bw - 5, topY, 5, bh);
  g.fillStyle = `rgba(0,0,0,${(0.28 * s).toFixed(3)})`;
  g.fillRect(x, topY, Math.min(6, bw * 0.15), bh);
  const ao = g.createLinearGradient(0, topY, 0, topY + 22);
  ao.addColorStop(0, `rgba(0,0,0,${(0.3 * s).toFixed(3)})`);
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ao;
  g.fillRect(x, topY, bw, 22);
}

/** PROJECTED CAST SHADOWS — skewed shadow volumes thrown to the lower-left
 *  by every tower. source-atop clips them to the existing city silhouettes
 *  so sky gaps stay clean and a tall tower darkens its shorter neighbour. */
function bakeCastShadows(g: CanvasRenderingContext2D, towers: ReadonlyArray<{ x: number; bw: number; bh: number }>, H: number, alpha: number): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (const t of towers) {
    const y = H - t.bh;
    const lean = 34 + t.bh * 0.14;
    const w = Math.min(t.bw * 0.72, 118);
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.beginPath();
    g.moveTo(t.x - w, H);
    g.lineTo(t.x - w + lean, y + 10);
    g.lineTo(t.x + w * 0.4 + lean, y + 10);
    g.lineTo(t.x + w * 0.4, H);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** FLIPPED-SPRITE REFLECTION — the cheapest possible 2D mirror: copy the
 *  sprite upside down, squash it, fade it with destination-in, then blit it
 *  under the object. Fully baked. No render target, no readback, no shader. */
function bakeFlipReflection(
  g: CanvasRenderingContext2D, spr: HTMLCanvasElement,
  dx: number, dy: number, dw: number, dh: number, alpha: number,
): void {
  if (!spr) return;
  const { c, g: m } = makeCanvas(Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)));
  m.save();
  m.translate(0, dh);
  m.scale(1, -1);
  m.drawImage(spr, 0, 0, dw, dh);
  m.restore();
  m.globalCompositeOperation = 'destination-in';
  const fade = m.createLinearGradient(0, 0, 0, dh);
  fade.addColorStop(0, 'rgba(0,0,0,0.85)');
  fade.addColorStop(0.35, 'rgba(0,0,0,0.4)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = fade;
  m.fillRect(0, 0, dw, dh);
  m.globalCompositeOperation = 'source-over';
  // additive over the wet deck: only the sprite's LIT pixels contribute,
  // so the mirror reads as reflected light instead of a dark smudge.
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  g.drawImage(c, dx, dy);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/* ---------------------- procedural building archetypes ------------------- */

export type ArchKind = 'slab' | 'setback' | 'glass' | 'warehouse' | 'spire';

interface BldSpec {
  x: number; bw: number; bh: number; H: number; shade: string;
  rng: () => number;
  /** personality baked into the facade: 0 grid / 1 shaft / 2 checker / 3 clusters */
  persona: number;
  warm: HTMLCanvasElement; cool: HTMLCanvasElement;
}

/** ARCHETYPE GENERATOR — five genuinely different silhouettes + four window
 *  personalities, chosen per building from the seeded RNG. This is the
 *  "visibly procedural" layer: no two runs share the same skyline shape. */
function bakeArchetype(g: CanvasRenderingContext2D, b: BldSpec, kind: ArchKind): void {
  const { x, bw, bh, H, rng, warm, cool, persona } = b;
  const top = H - bh;
  const lit = (px: number, py: number, r: number, a: number, coolLight = false): void =>
    bakeSpill(g, coolLight ? cool : warm, px, py, r, a);

  if (kind === 'setback') {
    // three receding tiers, each with its own ledge AO + emissive crown
    let tw = bw, ty = top, tx = x;
    for (let i = 0; i < 3; i++) {
      const th = i === 0 ? 12 + rng() * 18 : 30 + rng() * 48;
      g.fillStyle = b.shade;
      g.fillRect(tx, ty - th, tw, th);
      g.fillStyle = 'rgba(160,196,228,0.13)';
      g.fillRect(tx, ty - th, tw, 1.5);
      g.fillStyle = 'rgba(0,0,0,0.34)';
      g.fillRect(tx, ty - 1, tw, 3);
      lit(tx + tw * 0.5, ty - th - 1, 26, 0.14, i === 2);
      ty -= th;
      const nw = tw * (0.6 + rng() * 0.16);
      tx += (tw - nw) * (0.3 + rng() * 0.4);
      tw = nw;
    }
    bake3DKey(g, tx, ty, tw, top - ty + 8, 0.8);
  } else if (kind === 'glass') {
    // curtain wall: reflected sky gradient + vertical mullions + cool seams
    const gr = g.createLinearGradient(x, top, x + bw * 0.7, top + bh);
    gr.addColorStop(0, 'rgba(96,148,196,0.19)');
    gr.addColorStop(0.38, 'rgba(24,42,64,0.05)');
    gr.addColorStop(0.62, 'rgba(126,178,214,0.1)');
    gr.addColorStop(1, 'rgba(6,12,20,0)');
    g.fillStyle = gr;
    g.fillRect(x, top, bw, bh);
    const step = 9 + rng() * 7;
    for (let px = x + 4; px < x + bw - 3; px += step) {
      g.fillStyle = 'rgba(140,190,220,0.09)';
      g.fillRect(px, top, 1, bh);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(px + 1, top, 1.5, bh);
    }
    for (let py = top + 16; py < H - 14; py += 22 + rng() * 10) {
      g.fillStyle = 'rgba(150,196,226,0.055)';
      g.fillRect(x, py, bw, 1);
    }
    g.fillStyle = 'rgba(170,214,244,0.24)';
    g.fillRect(x + bw - 3, top, 3, bh);
  } else if (kind === 'warehouse') {
    // sawtooth roof, shutter bays, sodium interior spill
    const teeth = Math.max(2, Math.round(bw / 58));
    const th = 12 + rng() * 14;
    for (let i = 0; i < teeth; i++) {
      const sx = x + (i * bw) / teeth;
      g.fillStyle = b.shade;
      g.beginPath();
      g.moveTo(sx, top);
      g.lineTo(sx + bw / teeth, top - th);
      g.lineTo(sx + bw / teeth, top);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(150,186,216,0.12)';
      g.lineWidth = 1;
      g.stroke();
    }
    const bays = 2 + ((rng() * 2) | 0);
    for (let i = 0; i < bays; i++) {
      const sx = x + 10 + i * (bw - 20) / bays;
      const sw = (bw - 20) / bays - 6;
      const sh = 34 + rng() * 26;
      const sy = H - sh - 12;
      g.fillStyle = '#080d12';
      g.fillRect(sx, sy, sw, sh);
      g.fillStyle = 'rgba(255,182,108,0.12)';
      g.fillRect(sx + 2, sy + 2, sw - 4, sh - 5);
      for (let sy2 = sy + 4; sy2 < sy + sh - 3; sy2 += 5) {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(sx + 2, sy2, sw - 4, 1.5);
      }
      lit(sx + sw * 0.5, sy + 4, 34, 0.2);
    }
  } else if (kind === 'spire') {
    // tapered crown + emissive ring + beacon
    const cw = bw * (0.28 + rng() * 0.18);
    const ch = 26 + rng() * 60;
    const cx = x + bw * (0.35 + rng() * 0.3);
    g.fillStyle = b.shade;
    g.beginPath();
    g.moveTo(cx - cw / 2, top);
    g.lineTo(cx - cw * 0.18, top - ch);
    g.lineTo(cx + cw * 0.18, top - ch);
    g.lineTo(cx + cw / 2, top);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(170,208,240,0.22)';
    g.fillRect(cx - cw * 0.18, top - ch, cw * 0.36, 1.5);
    lit(cx, top - ch + 2, 22, 0.24, true);
    g.fillStyle = '#0a1118';
    g.fillRect(cx - 1, top - ch - 26 - rng() * 30, 2, 28);
    g.fillStyle = BEACON_CORE;
    g.fillRect(cx - 1.5, top - ch - 30, 3, 3);
  } else {
    // slab: horizontal floor bands + one long lit ribbon
    for (let i = 1; i <= 3; i++) {
      const py = top + (bh * i) / 4;
      g.fillStyle = 'rgba(0,0,0,0.24)';
      g.fillRect(x, py, bw, 3);
      g.fillStyle = 'rgba(150,186,214,0.07)';
      g.fillRect(x, py + 3, bw, 1);
    }
    g.fillStyle = 'rgba(255,190,120,0.16)';
    g.fillRect(x + 6, top + bh * 0.5, bw - 12, 2);
    lit(x + bw * 0.5, top + bh * 0.5, bw * 0.38, 0.13);
  }

  // Consistent 3D key on EVERY archetype (setback already has its own
  // stronger crown key): diagonal falloff, moon rim, left-face occlusion
  // and ledge contact AO. Fully baked, zero runtime cost.
  bake3DKey(g, x, top, bw, bh, kind === 'setback' ? 0.3 : 0.45);

  /* WINDOW PERSONALITY — per-building occupancy. Every lit cell emits a
   * baked spill disc so the wall around it is actually illuminated. */
  const n = persona === 3 ? 14 : 8;
  for (let i = 0; i < n; i++) {
    let wx: number, wy: number;
    if (persona === 1) {                       // vertical service shaft
      wx = x + bw * (0.24 + rng() * 0.5);
      wy = top + 14 + rng() * Math.max(8, bh - 40);
    } else if (persona === 2) {                // checkerboard occupancy
      wx = x + 8 + ((i * 17 + (rng() * 5) | 0)) % Math.max(10, bw - 18);
      wy = top + 12 + ((i * 29) % Math.max(10, bh - 28));
    } else if (persona === 3) {                // clustered apartments
      wx = x + 8 + rng() * Math.max(8, bw - 20);
      wy = top + 16 + rng() * Math.max(8, bh - 40);
    } else {                                   // strict office grid
      wx = x + 7 + ((i % 4) * (bw - 16)) / 4;
      wy = top + 14 + Math.floor(i / 4) * 26;
    }
    if (wy > H - 14 || wy < 2) continue;
    const coolL = rng() < 0.2;
    g.fillStyle = coolL ? 'rgba(150,236,228,0.82)' : 'rgba(255,198,132,0.85)';
    g.fillRect(wx, wy, 3, 4);
    lit(wx + 1.5, wy + 2, 13 + rng() * 9, 0.22 + rng() * 0.16, coolL);
  }
}

/** AURORA / HIGH-CLOUD SHEET — a sixth parallax plane baked from soft
 *  procedural ribbons. Drifts at its own factor with a slow alpha pulse;
 *  lives inside the cached sky vault so the frame cost is one blit. */
function buildAuroraTile(pal: MoodPalette): HTMLCanvasElement {
  const { c, g } = makeCanvas(512, 190);
  const rng = mulberry32(0xa0c17e);
  const cols = [pal.pop2, pal.shadow, pal.pop, pal.highlight];
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const col = cols[i % cols.length];
    const y = 20 + rng() * 90;
    const amp = 10 + rng() * 24;
    const ph = rng() * TAU;
    const gr = g.createLinearGradient(0, y - 34, 0, y + 62);
    gr.addColorStop(0, `rgba(${col},0)`);
    gr.addColorStop(0.45, `rgba(${col},${(0.09 + rng() * 0.05).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, y + 60);
    for (let px = 0; px <= 512; px += 8) {
      g.lineTo(px, y - 20 + Math.sin(px * 0.018 + ph) * amp + Math.sin(px * 0.047 + ph * 1.7) * amp * 0.3);
    }
    g.lineTo(512, y + 60);
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}


/* ============================================================================
 * DUAL-REGISTER NEUROAESTHETIC BAKE TOOLKIT
 * ----------------------------------------------------------------------------
 * ADULT register = filmic restraint: baked split-toning (cool shadows / warm
 * highlights), a raised black point, baked film grain and a screen vignette.
 * TEEN register = isolated supernormal pops: peak-shift exaggeration of the
 * most recognisable cues (rim light, neon bloom, crowns), ONE saturated hero
 * per plane (isolation / von Restorff), rhythmic repetition, graffiti and
 * holo panels. Both are BAKED ONCE — the frame path only blits canvases.
 * ==========================================================================*/

/** BAKED FILM GRADE — split toning + shadow lift + grain. `source-atop`
 *  keeps sky gaps clean, so this is safe on transparent city tiles. Pure
 *  bake-time work: no per-frame gradient, no shader, no LUT lookup. */
function bakeFilmGrade(
  g: CanvasRenderingContext2D, w: number, h: number,
  pal: MoodPalette, strength: number, rng: () => number,
): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const sg = g.createLinearGradient(0, h, w * 0.35, 0);
  sg.addColorStop(0, `rgba(${pal.shadow},${(0.14 * strength).toFixed(3)})`);
  sg.addColorStop(0.6, `rgba(${pal.shadow},${(0.04 * strength).toFixed(3)})`);
  sg.addColorStop(1, `rgba(${pal.shadow},0)`);
  g.fillStyle = sg;
  g.fillRect(0, 0, w, h);
  const hg = g.createLinearGradient(w, 0, 0, h);
  hg.addColorStop(0, `rgba(${pal.highlight},${(0.11 * strength).toFixed(3)})`);
  hg.addColorStop(0.55, `rgba(${pal.highlight},0)`);
  g.fillStyle = hg;
  g.fillRect(0, 0, w, h);
  // film grain — the analog texture adults read as "shot on film"
  const n = Math.min(9000, Math.round((w * h) / 900));
  for (let i = 0; i < n; i++) {
    const a = (0.012 + rng() * 0.022).toFixed(3);
    g.fillStyle = rng() < 0.5 ? `rgba(226,238,250,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(rng() * w, rng() * h, 1, 1);
  }
  g.restore();
}

/** SCREEN VIGNETTE — one baked plate, one blit in the existing weather pass.
 *  Dark corners guide the eye to the centre (visual hierarchy) without any
 *  live radial gradient or full-screen post engine. */
function buildVignettePlate(w: number, h: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)));
  const rg = g.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(0.6, 'rgba(4,8,14,0.055)');
  rg.addColorStop(1, 'rgba(2,4,9,0.5)');
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);
  const wg = g.createLinearGradient(0, h * 0.74, 0, h);
  wg.addColorStop(0, 'rgba(255,150,80,0)');
  wg.addColorStop(1, 'rgba(255,150,80,0.03)');
  g.fillStyle = wg;
  g.fillRect(0, h * 0.74, w, h * 0.26);
  return c;
}

/** ISOLATION + PEAK SHIFT — one supernormal hero per plane. A single
 *  saturated crown, an oversized halo and a light ribbon against a
 *  desaturated field is the strongest attention magnet in the literature. */
function bakeIsolationHero(
  g: CanvasRenderingContext2D, x: number, bw: number, top: number, H: number,
  pal: MoodPalette, disc: HTMLCanvasElement,
): void {
  const cx = x + bw * 0.5;
  const cw = bw * (0.58 + 0.12);
  bakeSpill(g, disc, cx, top - 4, bw * 1.05, 0.5);
  bakeSpill(g, disc, cx, top - 4, bw * 0.5, 0.34);
  g.fillStyle = `rgba(${pal.pop},0.75)`;
  g.fillRect(cx - cw * 0.5, top - 4, cw, 3);
  g.fillStyle = `rgba(${pal.pop},0.3)`;
  g.fillRect(cx - cw * 0.5, top - 10, cw, 6);
  const len = Math.min(H - top - 12, 150 + bw * 0.35);
  const rg = g.createLinearGradient(0, top + 4, 0, top + len);
  rg.addColorStop(0, `rgba(${pal.pop},0.55)`);
  rg.addColorStop(1, `rgba(${pal.pop},0)`);
  g.fillStyle = rg;
  g.fillRect(cx - 2, top + 4, 4, len);
  g.fillStyle = `rgba(${pal.pop2},0.8)`;
  g.fillRect(cx - 1, top - 18, 2, 14);
  g.fillRect(cx - 3, top - 20, 6, 2);
  // symmetry + rhythm: two matching flanking pips
  g.fillRect(cx - cw * 0.42, top - 1, 2, 2);
  g.fillRect(cx + cw * 0.42, top - 1, 2, 2);
}

/** CHROMATIC EDGE FRINGE — peak-shifted outline energy: saturated 1px rims
 *  on a few near silhouettes plus a rhythmic parapet strip (grouping /
 *  repetition / balance). Baked, never a per-frame aberration pass. */
function bakeChromaticEdges(
  g: CanvasRenderingContext2D, towers: ReadonlyArray<{ x: number; w: number; h: number }>,
  H: number, pal: MoodPalette, rng: () => number,
): void {
  for (const t of towers) {
    if (rng() > 0.46) continue;
    const top = H - t.h;
    g.fillStyle = `rgba(${pal.pop},0.32)`;
    g.fillRect(t.x - 1, top + 2, 1.4, t.h - 2);
    g.fillStyle = `rgba(${pal.pop2},0.28)`;
    g.fillRect(t.x + t.w - 1, top + 2, 1.4, t.h - 2);
    g.fillStyle = `rgba(${pal.pop2},0.2)`;
    for (let k = 0; k < t.w / 22; k++) g.fillRect(t.x + 8 + k * 22, top + 5, 10, 1);
  }
}

/** GRAFFITI TAG — teen "street" appeal: a bold abstract mark with a
 *  chromatic offset, spray dots and a dark outline so it reads as a light
 *  figure on a dark ground (Schloss & Palmer's highest-preference pairing). */
function bakeGraffiti(
  g: CanvasRenderingContext2D, x: number, top: number, bw: number, bh: number,
  pal: MoodPalette, rng: () => number,
): void {
  const gx = x + 14 + rng() * Math.max(4, bw - 108);
  const gy = top + 34 + rng() * Math.max(10, bh * 0.38);
  const s = 0.8 + rng() * 0.55;
  g.save();
  g.translate(gx, gy);
  g.rotate(-0.16 + rng() * 0.32);
  g.scale(s, s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const strokes: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 26, 12, 2], [12, 2, 4, 26], [4, 26, 26, 12],
    [30, 4, 30, 28], [30, 4, 46, 16], [30, 28, 46, 16],
  ];
  g.strokeStyle = 'rgba(2,5,9,0.85)';
  g.lineWidth = 7;
  for (const s0 of strokes) { g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s0[2], s0[3]); g.stroke(); }
  g.strokeStyle = `rgba(${pal.pop},0.85)`;
  g.lineWidth = 4;
  for (const s0 of strokes) { g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s0[2], s0[3]); g.stroke(); }
  g.strokeStyle = `rgba(${pal.pop2},0.7)`;
  g.lineWidth = 1.4;
  for (const s0 of strokes) { g.beginPath(); g.moveTo(s0[0] + 3, s0[1] + 3); g.lineTo(s0[2] + 3, s0[3] + 3); g.stroke(); }
  g.fillStyle = `rgba(${pal.pop2},0.55)`;
  for (let i = 0; i < 12; i++) {
    g.beginPath(); g.arc(rng() * 62 - 8, rng() * 40 - 6, 0.6 + rng() * 1.2, 0, TAU); g.fill();
  }
  g.restore();
}

/** HOLO AD PANEL — a peak-shifted neon billboard: colour-gradient glass,
 *  scanlines, an abstract glyph and a baked glow spill. Isolated novelty. */
function bakeHoloPanel(
  g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  pal: MoodPalette, rng: () => number, disc: HTMLCanvasElement,
): void {
  g.save();
  const bg = g.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, `rgba(${pal.pop2},0.2)`);
  bg.addColorStop(1, `rgba(${pal.pop},0.14)`);
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  g.strokeStyle = `rgba(${pal.pop},0.6)`;
  g.lineWidth = 1.5;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.strokeStyle = `rgba(${pal.pop2},0.8)`;
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(x + 8, y + h - 8);
  g.lineTo(x + w * 0.38, y + 7);
  g.lineTo(x + w * 0.56, y + h - 10);
  g.lineTo(x + w - 8, y + 9);
  g.stroke();
  g.fillStyle = 'rgba(3,7,12,0.3)';
  for (let sy = y + 3; sy < y + h - 2; sy += 4) g.fillRect(x + 1, sy, w - 2, 1);
  g.fillStyle = `rgba(${pal.pop2},0.8)`;
  for (let i = 0; i < 4; i++) g.fillRect(x + 6 + rng() * (w - 14), y + 6 + rng() * (h - 12), 2, 2);
  g.restore();
  bakeSpill(g, disc, x + w * 0.5, y + h * 0.5, w * 0.85, 0.24);
}

/** MILKY-WAY DUST — a diagonal band of dense fine specks and faint haze.
 *  Adds optimal complexity (structured novelty, not noise) to the skybox. */
function bakeMilkyWay(g: CanvasRenderingContext2D, rng: () => number, pal: MoodPalette): void {
  g.save();
  g.translate(TILE * 0.52, STAR_H * 0.38);
  g.rotate(-0.42);
  const band = g.createLinearGradient(0, -110, 0, 110);
  band.addColorStop(0, `rgba(${pal.pop2},0)`);
  band.addColorStop(0.5, `rgba(${pal.pop2},0.035)`);
  band.addColorStop(1, `rgba(${pal.pop2},0)`);
  g.fillStyle = band;
  g.fillRect(-TILE * 0.8, -110, TILE * 1.6, 220);
  for (let i = 0; i < 420; i++) {
    const px = rng() * TILE * 1.6 - TILE * 0.8;
    const py = (rng() + rng() + rng() - 1.5) * 70;
    const a = (0.08 + rng() * 0.3).toFixed(3);
    g.fillStyle = rng() < 0.14 ? `rgba(${pal.pop},${a})` : `rgba(216,230,248,${a})`;
    g.fillRect(px, py, rng() < 0.08 ? 2 : 1, 1);
  }
  g.restore();
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

/** BAKED PROP SHADOW — key light comes from the upper right (moon), so a
 *  roof prop's contact shadow falls to its lower-left. Drawn at bake time
 *  only; zero runtime cost. */
function bakePropShadow(g: CanvasRenderingContext2D, cx: number, baseY: number, halfW: number, alpha = 0.3): void {
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  g.beginPath();
  g.ellipse(cx - halfW * 0.3, baseY + 1.5, halfW, Math.max(2.5, halfW * 0.2), 0, 0, TAU);
  g.fill();
}

/** PARALLAX FOG PLANE — a soft horizontal haze sheet with procedural
 *  puffs cut out of it, tiled at its own parallax factor so the mist
 *  moves WITH depth instead of sticking to the screen. */
function buildFogPlane(): HTMLCanvasElement {
  const { c, g } = makeCanvas(512, 170);
  const gr = g.createLinearGradient(0, 0, 0, 170);
  gr.addColorStop(0, 'rgba(122,152,192,0)');
  gr.addColorStop(0.5, 'rgba(122,152,192,0.17)');
  gr.addColorStop(1, 'rgba(122,152,192,0.02)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 170);
  const rng = mulberry32(0x40bf11);
  g.globalCompositeOperation = 'destination-out';          // procedural puffs
  for (let i = 0; i < 7; i++) {
    const px = rng() * 512, py = 30 + rng() * 120, pr = 55 + rng() * 95;
    const rg = g.createRadialGradient(px, py, 0, px, py, pr);
    rg.addColorStop(0, 'rgba(0,0,0,0.55)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

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

/** PLAYER RIM — a crescent of light for the reactive layer: the moon key on
 *  the upper-right edge, coloured by whichever practical is nearest. Baked
 *  once per palette, blitted additively at the player (≤2 blits/frame). */
function buildRim(pal: MoodPalette, warm: boolean): HTMLCanvasElement {
  const W = 96, H = 190;
  const { c, g } = makeCanvas(W, H);
  const col = warm ? pal.highlight : pal.pop2;
  g.globalCompositeOperation = 'lighter';
  // soft body glow behind the figure
  const body = g.createRadialGradient(W * 0.5, H * 0.52, 6, W * 0.5, H * 0.52, W * 0.55);
  body.addColorStop(0, `rgba(${col},0.16)`);
  body.addColorStop(0.6, `rgba(${col},0.05)`);
  body.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = body;
  g.fillRect(0, 0, W, H);
  // the crescent itself: an offset ring segment, thick at the shoulder line
  g.save();
  g.beginPath();
  g.ellipse(W * 0.5, H * 0.55, W * 0.30, H * 0.36, 0, 0, TAU);
  g.clip();
  const rim = g.createLinearGradient(W * 0.2, 0, W, 0);
  rim.addColorStop(0, `rgba(${col},0)`);
  rim.addColorStop(0.62, `rgba(${col},0.16)`);
  rim.addColorStop(1, `rgba(${col},0.52)`);
  g.fillStyle = rim;
  g.fillRect(0, 0, W, H);
  g.restore();
  return c;
}

/** DECK POOL — the wet concrete lifting under the player as they pass a
 *  practical: one baked soft ellipse, one blit, alpha = proximity. */
function buildDeckPool(): HTMLCanvasElement {
  const { c, g } = makeCanvas(240, 64);
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(120, 30, 4, 120, 30, 116);
  gr.addColorStop(0, 'rgba(196,222,248,0.20)');
  gr.addColorStop(0.45, 'rgba(178,206,238,0.09)');
  gr.addColorStop(1, 'rgba(160,190,226,0)');
  g.save();
  g.scale(1, 0.26);
  g.fillStyle = gr;
  g.beginPath(); g.arc(120, 30 / 0.26, 116, 0, TAU); g.fill();
  g.restore();
  return c;
}

/** STYLIZED MOON — a real sphere, not a sticker. 512² plate baked once per
 *  palette, drawn as ONE blit. Physics/stylization kept:
 *   · gibbous terminator with earthshine on the dark limb
 *   · 6 maria + 16 craters (shadowed bowl, lit rim from the upper-right key,
 *     raised floor on the big ones) — the Saturn/early-3D look, not flat dots
 *   · limb darkening + a palette-tinted rim pair (warm key / cool bounce), so
 *     the moon belongs to the run's colour identity
 *   · chromatic fringe on the limb — 2 offset arcs, the "photographed through
 *     glass" tell that reads as premium
 *   · 3 thin cloud wisps crossing the lower limb for depth against the sky */
function buildMoon(pal: MoodPalette): HTMLCanvasElement {
  const S = 512, C = 256, R = 152;
  const { c, g } = makeCanvas(S, S);
  const rng = mulberry32(0x4d00d1);
  g.globalCompositeOperation = 'source-over';

  /* inner corona — the tight scattering right at the limb */
  let gr = g.createRadialGradient(C, C, R * 0.92, C, C, R * 1.42);
  gr.addColorStop(0, 'rgba(176,204,220,0.20)');
  gr.addColorStop(0.45, 'rgba(140,176,204,0.075)');
  gr.addColorStop(1, 'rgba(108,142,178,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);

  /* body — key from upper right, so the sphere turns */
  gr = g.createRadialGradient(C - R * 0.38, C - R * 0.42, R * 0.06, C, C, R);
  gr.addColorStop(0, '#f4f8f6');
  gr.addColorStop(0.34, '#dde7e5');
  gr.addColorStop(0.62, '#b9c7c9');
  gr.addColorStop(0.84, '#8a9aa0');
  gr.addColorStop(1, `rgba(${pal.shadow},0.92)`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.fill();

  g.save();
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.clip();

  /* MARIA — soft basalt seas, cooled toward the run palette */
  const maria: ReadonlyArray<[number, number, number]> = [
    [-46, -30, 44], [18, -52, 30], [58, 22, 38], [-18, 46, 33], [36, -8, 22], [-70, 34, 20],
  ];
  for (const [mx, my, mr] of maria) {
    const m = g.createRadialGradient(C + mx, C + my, mr * 0.1, C + mx, C + my, mr);
    m.addColorStop(0, 'rgba(58,76,86,0.30)');
    m.addColorStop(0.6, 'rgba(64,84,94,0.16)');
    m.addColorStop(1, 'rgba(70,90,100,0)');
    g.fillStyle = m;
    g.beginPath(); g.arc(C + mx, C + my, mr, 0, TAU); g.fill();
    g.fillStyle = `rgba(${pal.pop2},0.045)`;      // palette bounce in the seas
    g.beginPath(); g.arc(C + mx, C + my, mr * 0.8, 0, TAU); g.fill();
  }

  /* CRATERS — bowl shadow + lit rim (upper right) + raised floor */
  for (let i = 0; i < 16; i++) {
    const a = rng() * TAU, rr = Math.sqrt(rng()) * R * 0.84;
    const x = C + Math.cos(a) * rr, y = C + Math.sin(a) * rr;
    const rad = 3.5 + rng() * 13;
    if (Math.hypot(x - C, y - C) + rad > R * 0.95) continue;
    const bowl = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
    bowl.addColorStop(0, 'rgba(48,62,70,0.30)');
    bowl.addColorStop(1, 'rgba(40,54,62,0.06)');
    g.fillStyle = bowl;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(246,252,250,0.34)';        // sunlit rim
    g.lineWidth = Math.max(1, rad * 0.16);
    g.beginPath(); g.arc(x, y, rad * 0.92, -2.5, -0.25); g.stroke();
    g.strokeStyle = 'rgba(30,42,50,0.22)';           // shadowed rim
    g.beginPath(); g.arc(x, y, rad * 0.92, 0.55, 2.35); g.stroke();
    if (rad > 9) {                                    // central peak
      g.fillStyle = 'rgba(238,246,244,0.20)';
      g.beginPath(); g.arc(x - rad * 0.12, y - rad * 0.12, rad * 0.22, 0, TAU); g.fill();
    }
  }

  /* TERMINATOR — the gibbous dark limb, lower left, with earthshine */
  let term = g.createRadialGradient(C + R * 0.55, C + R * 0.62, R * 0.15, C + R * 0.5, C + R * 0.55, R * 1.45);
  term.addColorStop(0, 'rgba(10,16,26,0.66)');
  term.addColorStop(0.55, 'rgba(10,16,26,0.30)');
  term.addColorStop(1, 'rgba(10,16,26,0)');
  g.fillStyle = term;
  g.fillRect(0, 0, S, S);
  const es = g.createRadialGradient(C + R * 0.55, C + R * 0.62, R * 0.1, C + R * 0.45, C + R * 0.5, R * 1.1);
  es.addColorStop(0, `rgba(${pal.pop2},0.16)`);        // earthshine = cool bounce
  es.addColorStop(1, `rgba(${pal.pop2},0)`);
  g.fillStyle = es;
  g.fillRect(0, 0, S, S);

  /* CLOUD WISPS crossing the lower limb — depth against the sky */
  for (let i = 0; i < 3; i++) {
    const y = C + R * (0.42 + i * 0.2);
    const w = g.createLinearGradient(0, y - 16, 0, y + 16);
    w.addColorStop(0, 'rgba(10,16,26,0)');
    w.addColorStop(0.5, `rgba(10,16,26,${0.30 - i * 0.06})`);
    w.addColorStop(1, 'rgba(10,16,26,0)');
    g.fillStyle = w;
    g.fillRect(C - R, y - 16, R * 2, 32);
  }
  g.restore();

  /* LIMB DARKENING — the edge falls off, which is what makes it a sphere */
  gr = g.createRadialGradient(C, C, R * 0.72, C, C, R);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(6,12,20,0.42)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.fill();

  /* PALETTE RIMS — warm key upper right, cool bounce lower left */
  g.lineWidth = 2.6;
  g.strokeStyle = `rgba(${pal.highlight},0.55)`;
  g.beginPath(); g.arc(C, C, R * 0.985, -2.45, -0.15); g.stroke();
  g.lineWidth = 1.8;
  g.strokeStyle = `rgba(${pal.pop2},0.38)`;
  g.beginPath(); g.arc(C, C, R * 0.975, 0.6, 2.3); g.stroke();

  /* CHROMATIC FRINGE — two offset arcs, the glass tell */
  g.lineWidth = 1.1;
  g.strokeStyle = `rgba(${pal.pop},0.20)`;
  g.beginPath(); g.arc(C - 1.2, C, R + 1.4, -2.3, -0.2); g.stroke();
  g.strokeStyle = `rgba(${pal.pop2},0.18)`;
  g.beginPath(); g.arc(C + 1.2, C, R + 1.6, 0.7, 2.2); g.stroke();

  return c;
}

/** MOON CORONA — 4 scattering rings + 6 crepuscular rays + one lens streak.
 *  Palette-tinted, fully baked, ONE additive blit at runtime. */
function buildMoonHalo(pal: MoodPalette): HTMLCanvasElement {
  const { c, g } = makeCanvas(512, 512);
  const C = 256;
  const rings: ReadonlyArray<[number, string, number, number]> = [
    [88, '206,226,238', 0.30, 34],
    [176, `180,206,226`, 0.13, 66],
    [272, `140,178,214`, 0.055, 118],
    [404, `100,140,186`, 0.024, 176],
  ];
  g.globalCompositeOperation = 'lighter';
  for (const [r, col, a, inner] of rings) {
    const gr = g.createRadialGradient(C, C, inner, C, C, r);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.55, `rgba(${col},${(a * 0.4).toFixed(4)})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 512);
  }
  /* crepuscular rays — moonlight leaking through the cloud gaps */
  g.save();
  g.translate(C, C);
  for (let i = 0; i < 6; i++) {
    const ang = -0.9 + i * 0.33;
    g.save();
    g.rotate(ang);
    const ray = g.createLinearGradient(0, 0, 250, 0);
    ray.addColorStop(0, `rgba(${pal.pop2},0.10)`);
    ray.addColorStop(0.5, `rgba(190,214,232,0.045)`);
    ray.addColorStop(1, 'rgba(160,196,226,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(0, -10); g.lineTo(252, -34); g.lineTo(252, 34); g.lineTo(0, 10);
    g.closePath(); g.fill();
    g.restore();
  }
  g.restore();
  /* horizontal lens streak — anamorphic tell, very low alpha */
  const ls = g.createLinearGradient(0, 0, 512, 0);
  ls.addColorStop(0, 'rgba(150,190,230,0)');
  ls.addColorStop(0.35, 'rgba(178,212,246,0.10)');
  ls.addColorStop(0.5, 'rgba(206,230,255,0.17)');
  ls.addColorStop(0.65, 'rgba(178,212,246,0.10)');
  ls.addColorStop(1, 'rgba(150,190,230,0)');
  g.fillStyle = ls;
  g.fillRect(0, C - 3, 512, 6);
  g.fillStyle = `rgba(${pal.highlight},0.05)`;
  g.fillRect(0, C - 9, 512, 18);
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
  // MEMORY: return the DOWNSCALED plate only (1/down each axis). The old
  // version upscaled it back into a second full-size canvas, which kept
  // ~12 MB of duplicate tiles resident for a look we get for free by letting
  // the draw call scale the blit — smaller source, fewer bytes, same blur.
  const sw = Math.max(2, Math.round(src.width / down));
  const sh = Math.max(2, Math.round(src.height / down));
  const small = makeCanvas(sw, sh);
  small.g.imageSmoothingEnabled = true;
  small.g.imageSmoothingQuality = 'high';
  small.g.drawImage(src, 0, 0, sw, sh);
  return small.c;
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
  private fogPlane!: HTMLCanvasElement;   // parallax haze sheet (procedural puffs)
  private auroraTile!: HTMLCanvasElement; // 6th parallax plane: aurora ribbons
  private glowWarm!: HTMLCanvasElement;   // baked emissive light discs
  private glowCool!: HTMLCanvasElement;
  private glowSigns: HTMLCanvasElement[] = [];
  private lampSpr!: HTMLCanvasElement;    // broken streetlight, restored + baked
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
  private runSeed = 0;
  /** dual-register colour identity for this run (60/30/10 harmony) */
  private mood: MoodPalette = MOOD_PALETTES[0];
  /** THE RUN IDENTITY (world/profile.ts): twelve axes of night, all visible,
   *  all baked. Null until the first ensureBuilt, so a headless import never
   *  touches a canvas. */
  private profile: EnvironmentProfile | null = null;
  /** Baked plates + the two reactive passes for the current profile. */
  private night: NightLayer | null = null;
  /** Last few run seeds, so a new run cannot be a near-copy of the last one
   *  (profile.ts §LAW 3). Bounded: three is enough for the metric to work. */
  private seedHistory: number[] = [];
  private heroDisc!: HTMLCanvasElement;
  private vignette: HTMLCanvasElement | null = null;
  /* V3 reactive layer — baked sprites + a tiny reflection buffer */
  private rimWarm!: HTMLCanvasElement;
  private rimCool!: HTMLCanvasElement;
  private deckPool!: HTMLCanvasElement;
  private reflBuf: HTMLCanvasElement | null = null;
  private reflW = 0;
  private reflH = 0;
  private vigW = 0;
  private vigH = 0;
  private pollMood = -1;
  private skyVault = new SkyVaultCache();
  private lastCam: BgCam = { x: 1300, y: NOMINAL_Y, zoom: 1 };

  get onThunder(){return this.storm.onThunder}
  set onThunder(cb:(()=>void)|null){this.storm.onThunder=cb}
  constructor(quality:Quality,storm=new StormEngine(quality)){
    this.q=quality;this.storm=storm;
    this.mood = moodForSeed(0x51a2c9);
  }

  /** Tier change is a DRAW BUDGET change, never a re-bake. Every tile is
   *  built from a fixed seed in resolution-independent layer space, so the
   *  art is identical at every tier — only how much of it we draw differs. */
  setQuality(q:Quality):void{
    this.q=q;
  }

  /** RE-SEED THE SKYLINE — the whole point of procedural generation: every
   *  run gets a different set of building archetypes, silhouettes, window
   *  personalities, bridges and neon. Baked once on the next draw, so the
   *  120 Hz frame path is unchanged (still one blit per band). */
  setRunSeed(seed:number):void{
    const s=seed>>>0;
    if(s===this.runSeed)return;
    this.runSeed=s;
    // The profile is the run's identity: mood, moon, stars, clouds, aurora,
    // fog, grade, practicals and prop density, all from one seed. `seedHistory`
    // keeps a new run from being a near-copy of the previous one.
    this.profile = makeProfile(s, this.seedHistory);
    this.seedHistory = [s, ...this.seedHistory].slice(0, 3);
    this.mood = this.profile.mood;   // coherent colour identity + per-run novelty
    // Release the old plates BEFORE building the new ones: two nights resident
    // at once is exactly the doubling the ledger exists to prevent.
    this.night?.dispose();
    this.night = new NightLayer(this.profile);
    this.pollMood = -1;           // force the horizon bloom to re-bake
    this.built=false;
    this.skyVault.invalidate();   // force one composite with the NEW skyline
  }

  /** The current run identity, for the debug overlay and the bench. */
  getProfile(): EnvironmentProfile | null { return this.profile; }

  /** BAKE NOW, NOT ON THE FIRST ACTION FRAME.
   *
   * A reseed invalidates every tile, and the bake used to happen inside the
   * first `drawSky` of the run — i.e. the player pressed PLAY and watched a
   * frozen frame (measured 120–400 ms depending on the device's canvas speed).
   * Warming synchronously at the moment of the click moves that cost onto the
   * menu, where a still frame is what the player already expects. Returns the
   * milliseconds spent so the frame log can report the truth. */
  warm(): number {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.ensureBuilt()
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  }

  /** Which path baked the plates this run — 'gpu' means the WebGL2 baker ran. */
  plateStats(): ReturnType<NightLayer['stats']> | null { return this.night?.stats() ?? null; }

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
      // slow orbital drift (~5 min period) — the skybox is alive without
      // any per-frame cost: this runs inside the cached vault rebuild
      const moonX = w * 0.87 - cx * 0.03 * cz - MOON_HALF + Math.sin(t * 0.021) * 46;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - MOON_HALF + Math.cos(t * 0.014) * 16;
      this.moonX = moonX + MOON_HALF;
      this.moonY = moonY + MOON_HALF;
      this.moonCover = 0;
    }

    this.skyVault.draw(outerCtx, w, h, cx, cy, cz, t, this.lightningI(), Boolean(this.storm.boltActive), this.q, (ctx) => {
    ctx.save();

    /* 1 — sky gradient anchored to the world ground line */
    const hy = h * 0.5 + (0 - cy) * cz;                     // screen y of world y=0
    const skyH = hy > 1 ? (hy < h ? hy : h) : 1;
    ctx.drawImage(this.skyStrip, 0, 0, 8, 600, 0, 0, w, skyH);
    // DYNAMIC SKY TINT — a slow ~90s night pulse swinging the vault
    // between deep indigo and storm-violet. One fillRect inside the
    // cached sky vault: zero cost on the 60/120Hz frame path.
    {
      const tintA = 0.5 + 0.5 * Math.sin(t * 0.07);
      ctx.globalAlpha = 0.04 + tintA * 0.045;
      ctx.fillStyle = `rgba(${this.mood.sky},1)`;
      ctx.fillRect(0, 0, w, skyH);
      // baked-in split tone: warm highlights from the moon side, cool
      // shadows below — the film look that reads as premium to adults
      const split = ctx.createLinearGradient(w, 0, 0, skyH);
      split.addColorStop(0, `rgba(${this.mood.highlight},0.035)`);
      split.addColorStop(0.55, `rgba(${this.mood.shadow},0.02)`);
      split.addColorStop(1, `rgba(${this.mood.shadow},0.06)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = split;
      ctx.fillRect(0, 0, w, skyH);
    }
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
      const mi = MOOD_PALETTES.indexOf(this.mood);
      if (!this.pollPlate || this.pollW !== pw || this.pollMood !== mi) {
        const pc = document.createElement('canvas');
        pc.width = pw; pc.height = 216;
        const pg2 = pc.getContext('2d')!;
        const lg = pg2.createLinearGradient(0, 0, 0, 216);
        lg.addColorStop(0, `rgba(${this.mood.shadow},0)`);
        lg.addColorStop(0.55, `rgba(${this.mood.shadow},0.09)`);
        lg.addColorStop(0.84, `rgba(${this.mood.pop},0.075)`);
        lg.addColorStop(1, `rgba(${this.mood.highlight},0.14)`);
        pg2.fillStyle = lg;
        pg2.fillRect(0, 0, pw, 216);
        this.pollPlate = pc;
        this.pollW = pw;
        this.pollMood = mi;
      }
      ctx.globalCompositeOperation = 'lighter';
      // The megapolis' glow is a profile axis: a bright-city run breathes more
      // light up into the cloud deck than a blackout run.
      const pollA = (this.profile ? this.profile.atmosphere.pollution : 1);
      ctx.globalAlpha = (I0 > 0 ? 1 + I0 * 0.55 : 1) * pollA;
      ctx.drawImage(this.pollPlate, 0, hy - 210, w, 216);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 2 — stars + moon (celestial parallax) */
    const starBase = hy - 70 > h * 0.25 ? hy - 70 : h * 0.25;
    const ms = mod(cx * 0.015 * cz, TILE);
    // The tile may be a half-resolution bake (GPU/CPU star field); blitRowScaled
    // handles both cases and is one drawImage per wrap either way.
    if (this.starTile.width === TILE) this.blitRow(ctx, this.starTile, ms, starBase - STAR_H);
    else this.blitRowScaled(ctx, this.starTile, ms, starBase - STAR_H, STAR_H);
    /* 2.5 — DRIFTING CLOUD DECKS: three parallax sheets (high slow thin /
     * main bank / low fast wisps). While lightning scatters through them the
     * LIT twin re-blits additively on the lower two decks. Behind skyline. */
    {
      const C = this.profile ? this.profile.clouds : null;
      const cov = C ? C.coverage : 0.6;      // 0 clear .. 1 overcast
      const spd = C ? C.speed : 1;           // drift multiplier
      const alt = C ? C.altitude : 1;        // bank height
      const cloudY = hy * 0.16 - 40 - (cy - NOMINAL_Y) * 0.06 * cz + (alt - 1) * 54;
      const offA = mod(-t * 3.2 * spd - cx * 0.013 * cz, TILE);
      const offB = mod(-t * 5 * spd - cx * 0.02 * cz, TILE);
      const offC = mod(-t * 8.4 * spd - cx * 0.03 * cz, TILE);
      // Coverage scales all three decks together; a clear run keeps a thin
      // high veil (that is what "clear" looks like in a lit city, not black).
      ctx.globalAlpha = 0.10 + 0.42 * cov;
      this.blitRow(ctx, this.cloudDark, offA, cloudY - 84);
      ctx.globalAlpha = 0.14 + 0.62 * cov;
      this.blitRow(ctx, this.cloudDark, offB, cloudY);
      ctx.globalAlpha = 0.08 + 0.38 * cov;
      this.blitRow(ctx, this.cloudDark, offC, cloudY + 104);
      ctx.globalAlpha = 1;
    }

    /* 2.6 — AURORA / HIGH-CLOUD SHEET — a sixth parallax plane. Soft
     * procedural ribbons at f=0.045 with a slow alpha pulse; inside the
     * cached vault, so this is one blit per vault rebuild, not per frame. */
    {
      // Aurora is RARE by design (≈1 run in 3, profile.ts): when it is absent
      // the whole pass is skipped, which is both cheaper and honest — a faint
      // always-on ribbon is a filter, not an event.
      const A = this.profile ? this.profile.aurora : null;
      const presence = A ? A.presence : 1;
      if (presence > 0.02) {
        const aOff = mod(-t * 1.6 - cx * 0.045 * cz, 512);
        const hgt = A ? A.height : 1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.42 + 0.24 * Math.sin(t * 0.033 + 1.2)) * presence;
        const ay = hy * 0.08 - 30 - (cy - NOMINAL_Y) * 0.03 * cz;
        for (let ax = -aOff; ax < w; ax += 512) {
          ctx.drawImage(this.auroraTile, ax, ay, 512, this.auroraTile.height * hgt);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* 2.8 — THE MOON: two baked blits (disc + halo). No eclipse scan, no
     * ring/zodiac/pillar optics — stripped with the rest of the engines. */
    {
      // Size and drift are profile axes: a big low moon and a small high one
      // are the two most legible "different night" signals in the sky.
      const M = this.profile ? this.profile.moon : null;
      const sizeMul = M ? M.size : 1;
      const D = MOON_D * sizeMul;
      const half = D * 0.5;
      const drift = M ? M.drift : 1;
      const moonX = w * 0.87 - cx * 0.03 * cz - half + Math.sin(t * 0.021 * drift) * 46;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - half + Math.cos(t * 0.014 * drift) * 16;
      this.moonX = moonX + half;
      this.moonY = moonY + half;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.moonSpr, moonX, moonY, D, D);
      ctx.globalCompositeOperation = 'lighter';
      const haloD = MOON_HALO_D * sizeMul;
      ctx.globalAlpha = 0.82 * (M ? Math.min(1.2, M.corona) : 1);
      ctx.drawImage(this.moonHalo, moonX + half - haloD * 0.5, moonY + half - haloD * 0.5, haloD, haloD);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    /* DYNAMIC SKY EVENT — SHOOTING STARS: deterministic streaks (pure
     * function of t, no state) in the first 0.7s of every 9s slot. */
    {
      // Cadence is a profile axis: some nights the sky is busy, some it is not.
      const meteorMul = this.profile ? this.profile.atmosphere.meteors : 1;
      const slot = 9 / Math.max(0.35, meteorMul);
      const ev = Math.floor(t / slot);
      const k = t - ev * slot;
      if (k < 0.7) {
        const h1 = ((ev * 9301 + 49297) % 233280) / 233280;
        const h2 = ((ev * 49297 + 9301) % 233280) / 233280;
        const prog = k / 0.7;
        const sx0 = w * (0.08 + h1 * 0.7);
        const sy0 = h * (0.05 + h2 * 0.22);
        const dir = h1 < 0.5 ? 1 : -1;
        const hx = sx0 + dir * prog * 240;
        const hyy = sy0 + prog * 120;
        const tail = 110;
        ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.9;
        ctx.strokeStyle = 'rgba(226,240,255,0.95)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(hx, hyy);
        ctx.lineTo(hx - dir * tail, hyy - tail * 0.5);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(hx, hyy, 1.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    /* 3 — DEEP + FAR skylines through the shared parallax engine.
     * Both draw from their pre-blurred DOF variants; during a strike the
     * sharp tile re-blits additively → silhouette pop. */
    const I = this.lightningI();
    this.drawCityBand(ctx, LAY_DEEP, h, cx, cy, cz, I, this.deepTileBlur, this.deepTile, DEEP_H, 0.34);
    this.drawCityBand(ctx, LAY_FAR, h, cx, cy, cz, I, this.farTileBlur, this.farTile, FAR_H, 0.3);

    /* 3.5 — PARALLAX FOG PLANE: a procedural haze sheet at its own factor
     * (0.098 — between far and mid) drifting slowly with time, so the mist
     * moves WITH depth instead of sticking to the screen. */
    {
      const byF2 = h * 0.5 + (LAY_FAR.lift - cy * LAY_FAR.vf) * cz;
      const fpM = mod(cx * 0.098 * cz + t * 2.4, 512);
      // Fog is a profile axis and it is the cheapest depth cue in the sky: a
      // heavy-fog run separates the four parallax bands without new geometry.
      const A2 = this.profile ? this.profile.atmosphere : null;
      const fogA = Math.min(1.2, A2 ? A2.fog : 1);
      const fogY = byF2 - 216 * (A2 ? A2.fogHeight : 1);
      ctx.globalAlpha = fogA;
      for (let fx = -fpM; fx < w; fx += 512) {
        ctx.drawImage(this.fogPlane, fx, fogY);
      }
      ctx.globalAlpha = 1;
    }

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


  /* ---------------------- V3 reactive light layer ------------------------ */

  /** Proximity of a world x to the stage's two practicals (1 = at the source,
   *  0 = beyond its reach). Three |x| comparisons — the whole "which light is
   *  the player standing in" query. */
  practicalLight(x: number): { warm: number; cool: number } {
    const fall = (d: number): number => {
      const a = Math.abs(d)
      return a >= 300 ? 0 : 1 - a / 300
    }
    return { warm: fall(x - DOOR_X), cool: fall(x - LAMP_X) }
  }

  /** PLAYER-KEYED LIGHT — a rim crescent + a wet deck pool, painted from two
   *  baked sprites with an alpha driven by proximity to the nearest practical.
   *  This is the only lighting in the game that reacts to the player, and it
   *  costs at most 2 additive blits per frame. */
  drawPlayerLight(ctx: CanvasRenderingContext2D, px: number, py: number, face = 1): void {
    this.ensureBuilt();
    const L = this.practicalLight(px);
    const a = Math.max(L.warm, L.cool);
    const K = this.profile ? this.profile.light : null;
    // Practicals are profile-lightable: a run whose stairwell is dying is a
    // different place to stand than one where it is blazing.
    if (a > 0.02) {
      const rim = L.warm >= L.cool ? this.rimWarm : this.rimCool;
      const gain = (L.warm >= L.cool ? (K ? K.warm : 1) : (K ? K.cool : 1));
      // A failing tube's flicker only ever DIMS the practical (never adds
      // light): an additive flicker reads as a strobe, which is a medical
      // consideration as well as a taste one.
      const fl = K ? 1 - K.flicker * 0.35 * (0.5 + 0.5 * Math.sin(this.t * 13.3)) : 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.8, 0.55 * a * gain * fl);
      ctx.drawImage(rim, px - 48, py - 190, 96, 190);
      ctx.globalAlpha = Math.min(0.7, 0.42 * a * gain * fl);
      ctx.drawImage(this.deckPool, px - 120, py - 14, 240, 64);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // MOON KEY RIM — the reactive light that is never absent, because the moon
    // is never absent. It answers the practical the player stands in (near) and
    // the phase (a crescent rims harder than a full disc, which flattens it).
    if (this.night) {
      this.night.drawKeyRim(ctx, px, py, face, a, this.t);
    }
  }

  /** SCREEN-SPACE REFLECTION — the "very low cpu post processing" pass.
   *  The live canvas band ABOVE the deck line is copied into a 1/8-scale
   *  buffer (that downscale IS the blur), then blitted back flipped, in three
   *  fading slices with a per-slice ripple offset. Because the source is the
   *  frame itself, the reflection automatically contains the player, enemies,
   *  projectiles and FX — it reacts without a render target, shader, filter or
   *  readback. 4 drawImage calls, ~15 KB, zero allocations. */
  drawReflections(ctx: CanvasRenderingContext2D, cam: BgCam, quality: Quality): void {
    if (quality === 'low' || typeof document === 'undefined') return;
    this.ensureBuilt();
    const w = this.vw, h = this.vh;
    const zoom = Math.max(0.35, Number.isFinite(cam.zoom) ? cam.zoom : 1);
    const deckY = h * 0.5 + zoom * (0 - (Number.isFinite(cam.y) ? cam.y : NOMINAL_Y));
    const bandH = Math.min(h * 0.6, Math.max(10, 104 * zoom));
    if (deckY < -4 || deckY > h + 4) return;
    const bw = Math.max(24, Math.ceil(w / 8));
    const bh = Math.max(6, Math.ceil(bandH / 8));
    if (!this.reflBuf || this.reflW !== bw || this.reflH !== bh) {
      this.reflBuf = makeCanvas(bw, bh).c;
      this.reflW = bw;
      this.reflH = bh;
    }
    const g = this.reflBuf.getContext('2d');
    if (!g) return;
    const srcH = Math.min(bandH * 1.5, Math.max(0, deckY));
    if (srcH < 6) return;
    g.clearRect(0, 0, bw, bh);
    g.drawImage(ctx.canvas, 0, deckY - srcH, w, srcH, 0, 0, bw, bh);
    // flip + fade in three slices (the cheapest possible vertical falloff)
    const t = this.t;
    const sh = bandH / 3;
    // the band answers the weather too: lightning lifts the mirror (it is the
    // brightest thing in the sky, so the wet deck must answer it)
    const boost = 1 + 1.6 * this.lightningI();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const y0 = deckY + i * sh;
      if (y0 > h) break;
      ctx.globalAlpha = Math.min(0.42, (0.17 - i * 0.055) * boost);
      const dx = Math.sin(t * 2.1 + i * 1.7) * 2.2 * zoom;
      ctx.save();
      ctx.translate(dx, y0);
      ctx.scale(1, -1);
      g.globalAlpha = 1;
      ctx.drawImage(this.reflBuf, 0, bh * (1 - (i + 1) / 3), bw, bh / 3, 0, -sh, w, sh);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // MOON GLITTER — the moon touching the wet roof, two additive blits. The
    // mirror above shows the city; this shows the SKY, and together they are
    // the whole reflection story for two drawImage calls and no readback.
    if (this.night) {
      const wet = 0.55 + 0.45 * Math.min(1, this.storm.intensity * 4);
      this.night.drawGlitter(ctx, this.moonX, deckY, w, h, wet, this.t);
    }
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
    // BROKEN STREETLIGHT — restored foreground practical, one baked blit.
    // The pole's rim light, glow spill and contact AO are all in the sprite;
    // its flipped reflection is baked into the arena tile below.
    ctx.drawImage(this.lampSpr, LAMP_X - 48, -286);
    // STAIRWELL PRACTICAL — warm head-house + breathing pool (additive)
    ctx.drawImage(this.doorSpr, DOOR_X - 100, -226);   // sprite grew 54px upward
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
    // CINEMATIC VIGNETTE — ONE baked plate, ONE blit. Dark corners focus
    // attention on the action; no live gradient, no post-processing engine.
    if (!this.vignette || this.vigW !== this.vw || this.vigH !== this.vh) {
      this.vignette = buildVignettePlate(this.vw, this.vh);
      this.vigW = this.vw; this.vigH = this.vh;
    }
    ctx.drawImage(this.vignette, 0, 0);
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

  /** Same row blit for a reduced-resolution plate: drawn to full layer size. */
  private blitRowScaled(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, m: number, y: number, h: number): void {
    for (let x = -m; x < this.vw; x += TILE) ctx.drawImage(img, x, y, TILE, h);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    // The profile exists before any plate is painted: every bake below reads
    // its axes, so a null here would silently bake the previous night.
    if (!this.profile) {
      this.profile = makeProfile(this.runSeed);
      this.night?.dispose();
      this.night = new NightLayer(this.profile);
      this.mood = this.profile.mood;
    }
    this.skyStrip = buildSkyStrip();
    // MOON: the GPU/CPU baker owns it when a DOM exists (phase, tilt, tint and
    // procedural craters from the profile); the legacy plate is the last-resort
    // fallback so a headless import still produces a drawable sprite.
    this.night?.ensure();
    const bakedMoon = this.night?.moonPlate() ?? null;
    this.moonSpr = bakedMoon ?? buildMoon(this.mood);
    this.moonHalo = buildMoonHalo(this.mood);
    // Emissive discs FIRST: buildDoorStructure/buildLampProp paint baked
    // spill with these, so they must exist before any plate that lights.
    this.glowWarm = buildGlowDisc(this.mood.highlight);
    this.glowCool = buildGlowDisc(this.mood.pop2);
    this.heroDisc = buildGlowDisc(this.mood.pop);
    this.rimWarm = buildRim(this.mood, true);
    this.rimCool = buildRim(this.mood, false);
    this.deckPool = buildDeckPool();
    // Rebuild-safe: a run reseed re-enters ensureBuilt, so reset the array
    // instead of appending a second set of discs forever.
    this.glowSigns.length = 0;
    for (const rgb of ['255,45,149','41,230,210','255,176,46','141,91,255','63,169,255',this.mood.pop,this.mood.pop2]) {
      this.glowSigns.push(buildGlowDisc(rgb));
    }
    this.doorSpr = this.buildDoorStructure();
    this.doorPool = this.buildDoorPool();
    // Rebuild-safe: a run reseed re-enters ensureBuilt, so clear the
    // arrays instead of appending a second set of sprites/discs forever.
    this.glyphSpr.length = 0;
    for (let ci = 0; ci < 5; ci++) this.glyphSpr.push(buildGlyph(ci));
    this.cloudDark = buildCloudTile(false);
    this.fogPlane = buildFogPlane();
    this.auroraTile = buildAuroraTile(this.mood);
    this.lampSpr = this.buildLampProp();
    // STARS: density and warm/cool split come from the profile, so a clear run
    // and an overcast run are visibly different skies (not just different alpha).
    const bakedStars = this.night?.starPlate() ?? null;
    this.starTile = bakedStars && bakedStars.width >= 256
      ? bakedStars
      : this.buildStarTile();
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
    // soft plate is stored at reduced resolution → scale it up here (GPU)
    this.blitRowScaled(ctx, soft, m, by - bandH, bandH);
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
    // MILKY-WAY DUST — structured complexity in the skybox
    bakeMilkyWay(g, rng, this.mood);
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
    const rng = mulberry32(0x33d1e7 ^ this.runSeed);
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
        // palette-tinted isolation: the ONE saturated cue on this ridge
        bakeSpill(g, this.glowSigns[5], x + bw * 0.5, cy0 + 4, bw * 0.72, 0.26);
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
    bakeFilmGrade(g, TILE, DEEP_H, this.mood, 0.4, rng);
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
    const rng = mulberry32(0xc1f3a0 ^ this.runSeed);
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
      // BAKED VOLUME SHADING — key from the upper right: right face lifts,
      // left face falls away (extruded-box read, zero runtime cost)
      g.fillStyle = 'rgba(150,185,215,0.05)';
      g.fillRect(x + bw - 3, FAR_H - bh, 3, bh);
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.fillRect(x, FAR_H - bh, Math.min(4, bw * 0.22), bh);
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
      /* PROCEDURAL ARCHETYPE — silhouette + window personality are chosen
       * per building from this band's seeded RNG. Five shapes, four
       * occupancy patterns, baked emissive spill on every lit cell. */
      const arch = (['slab', 'setback', 'glass', 'warehouse', 'spire'] as const)[(rng() * 5) | 0];
      bakeArchetype(g, {
        x, bw, bh, H: FAR_H, shade, rng, persona: (rng() * 4) | 0,
        warm: this.glowWarm, cool: this.glowCool,
      }, arch);
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
            bakeSpill(g, cool ? this.glowCool : warm ? this.glowWarm : this.glowCool, wx + 1, wy + 1, 9, 0.13);
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
    // GLOBAL KEY WASH — one directional gradient ties every tower to the
    // same moon: bright upper-right → shadowed lower-left (baked 3D read)
    const keyF = g.createLinearGradient(TILE, 0, 0, FAR_H);
    keyF.addColorStop(0, 'rgba(170,200,235,0.07)');
    keyF.addColorStop(0.5, 'rgba(170,200,235,0.015)');
    keyF.addColorStop(1, 'rgba(10,16,26,0.15)');
    g.fillStyle = keyF;
    g.fillRect(0, 0, TILE, FAR_H);
    bakeFilmGrade(g, TILE, FAR_H, this.mood, 0.55, rng);
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
    const rng = mulberry32(0x2b6e5f ^ this.runSeed);
    const shades = ['#0b141c', '#0d1721', '#0e1924', '#101c27'];
    const cands: { bx: number; bw: number; bh: number }[] = [];
    const towers: { x: number; bw: number; bh: number }[] = [];
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
      // BAKED VOLUME SHADING + BASE CONTACT AO — the key light rakes from
      // the upper right: lit right face, shadowed left face, and the foot
      // of every tower darkens into the street it stands on
      g.fillStyle = 'rgba(160,195,225,0.06)';
      g.fillRect(x + bw - 4, MID_H - bh, 4, bh);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x, MID_H - bh, Math.min(5, bw * 0.2), bh);
      const aoB = g.createLinearGradient(0, MID_H - 30, 0, MID_H);
      aoB.addColorStop(0, 'rgba(0,0,0,0)');
      aoB.addColorStop(1, 'rgba(0,0,0,0.32)');
      g.fillStyle = aoB;
      g.fillRect(x, MID_H - 30, bw, 30);
      towers.push({ x, bw, bh });
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
        bakePropShadow(g, tx + tw / 2, MID_H - bh, tw * 0.75, 0.34);
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
        bakePropShadow(g, ax2 + aw / 2, MID_H - bh, aw * 0.7, 0.3);
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
        bakePropShadow(g, dx, MID_H - bh, dr * 0.8, 0.26);
      } else if (roofKind < 0.6 && bw > 90) {              // stair bulkhead
        const sw2 = 20 + rng() * 16, sh2 = 12 + rng() * 8;
        const sx2 = x + 8 + rng() * Math.max(4, bw - sw2 - 16);
        g.fillStyle = shade;
        g.fillRect(sx2, MID_H - bh - sh2, sw2, sh2);
        g.fillStyle = 'rgba(60,82,90,0.2)';
        g.fillRect(sx2, MID_H - bh - sh2, sw2, 1);
        g.fillStyle = 'rgba(20,30,38,0.9)';                // door
        g.fillRect(sx2 + sw2 * 0.55, MID_H - bh - sh2 + 3, 6, sh2 - 3);
        bakePropShadow(g, sx2 + sw2 / 2, MID_H - bh, sw2 * 0.7, 0.32);
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
        bakePropShadow(g, bx0 + bwi / 2, MID_H - bh, bwi * 0.55, 0.3);
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
      /* PROCEDURAL ARCHETYPE — silhouette + window personality are chosen
       * per building from this band's seeded RNG. Five shapes, four
       * occupancy patterns, baked emissive spill on every lit cell. */
      const arch = (['slab', 'setback', 'glass', 'warehouse', 'spire'] as const)[(rng() * 5) | 0];
      bakeArchetype(g, {
        x, bw, bh, H: MID_H, shade, rng, persona: (rng() * 4) | 0,
        warm: this.glowWarm, cool: this.glowCool,
      }, arch);
      // HOLO AD PANEL — isolated saturated novelty on a calm field
      if (rng() < 0.24 && bw > 140 && bh > 190) {
        const hw = Math.min(92, bw - 44), hh = 26 + rng() * 16;
        const hx = x + 12 + rng() * Math.max(4, bw - hw - 24);
        const hy = MID_H - bh + 26 + rng() * Math.max(10, bh * 0.42);
        bakeHoloPanel(g, hx, hy, hw, hh, this.mood, rng, this.heroDisc);
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
              bakeSpill(g, serverFloor || !warm ? this.glowCool : this.glowWarm, wx + 1.5, wy + 2, 13, 0.2);
            }
          }
        }
      }
      if (bw > 130) cands.push({ bx: x, bw, bh });
      x += bw + (rng() < 0.35 ? 12 + rng() * 40 : 0);
    }

    /* SKYBRIDGES — procedural truss spans between neighbouring towers:
     * deck slab, X-braced truss, lit corridor windows, and baked AO where
     * the span bites into each tower face. */
    for (let i = 0; i + 1 < towers.length; i++) {
      const a = towers[i], b = towers[i + 1];
      const gap = b.x - (a.x + a.bw);
      if (gap < 24 || gap > 130) continue;
      const topA = MID_H - a.bh, topB = MID_H - b.bh;
      const y0 = Math.max(topA, topB) + 34 + rng() * 56;   // deck under both roofs
      if (y0 > MID_H - 46) continue;
      const x0 = a.x + a.bw, x1 = b.x, span = x1 - x0;
      g.fillStyle = '#0a1219';                             // deck slab
      g.fillRect(x0, y0, span, 7);
      g.fillStyle = 'rgba(140,175,205,0.18)';              // moonlit deck edge
      g.fillRect(x0, y0, span, 1);
      g.strokeStyle = 'rgba(30,44,54,0.92)';               // truss lattice
      g.lineWidth = 1.5;
      const n = Math.max(2, Math.round(span / 24));
      for (let k = 0; k <= n; k++) {
        const tx = x0 + (k * span) / n;
        g.beginPath();
        g.moveTo(tx, y0 + 7);
        g.lineTo(tx, y0 + 17);
        g.stroke();
        if (k < n) {
          const nx = x0 + ((k + 1) * span) / n;
          g.beginPath();
          g.moveTo(tx, y0 + 17);
          g.lineTo(nx, y0 + 7);
          g.stroke();
        }
      }
      g.fillStyle = '#0a1219';                             // bottom chord
      g.fillRect(x0, y0 + 17, span, 3);
      g.fillStyle = 'rgba(255,196,130,0.5)';               // lit corridor windows
      for (let wx = x0 + 5; wx < x1 - 4; wx += 13) {
        if (rng() < 0.62) g.fillRect(wx, y0 + 2.5, 5, 2.5);
      }
      g.fillStyle = 'rgba(0,0,0,0.42)';                    // AO at both bites
      g.fillRect(x0 - 4, y0 - 3, 6, 26);
      g.fillRect(x1 - 2, y0 - 3, 6, 26);
      bakePropShadow(g, (x0 + x1) / 2, Math.max(topA, topB) + 2, span * 0.4, 0.16);
    }

    /* CONSTRUCTION CRANE — one procedural silhouette per tile, perched on
     * the tallest tower: lattice mast, jib with hook cable, counterweight,
     * red warning light. */
    if (towers.length > 0) {
      let bt = towers[0];
      for (const tw2 of towers) if (tw2.bh > bt.bh) bt = tw2;
      const cxr = bt.x + bt.bw * (0.28 + rng() * 0.4);
      const baseY = MID_H - bt.bh;
      const mastH = Math.min(74 + rng() * 84, Math.max(44, baseY - 26));
      const topY = baseY - mastH;
      g.strokeStyle = 'rgba(24,36,44,0.95)';
      g.lineWidth = 2;
      g.strokeRect(cxr - 6, topY, 12, mastH);              // lattice mast
      g.lineWidth = 1;
      for (let yy = topY + 8; yy < baseY - 4; yy += 12) {
        g.beginPath();
        g.moveTo(cxr - 6, yy);
        g.lineTo(cxr + 6, yy + 8);
        g.stroke();
      }
      const jib = 64 + rng() * 70;
      g.lineWidth = 2.5;
      g.beginPath();                                       // jib + tower head
      g.moveTo(cxr - jib * 0.34, topY + 6);
      g.lineTo(cxr + jib, topY + 2);
      g.stroke();
      g.beginPath();
      g.moveTo(cxr - jib * 0.34, topY + 6);
      g.lineTo(cxr, topY - 18);
      g.stroke();
      g.fillStyle = 'rgba(24,36,44,0.95)';                 // counterweight
      g.fillRect(cxr - jib * 0.34 - 9, topY + 5, 11, 9);
      g.strokeStyle = 'rgba(24,36,44,0.7)';                // hook cable
      g.lineWidth = 1;
      const hx = cxr + jib * 0.62;
      g.beginPath();
      g.moveTo(hx, topY + 3);
      g.lineTo(hx, topY + 34 + rng() * 46);
      g.stroke();
      g.fillStyle = 'rgba(255,80,60,0.65)';                // warning light
      g.fillRect(cxr - 1, topY - 20, 2, 2);
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
        // NEON SPILL — the sign actually lights the wall around it. Baked
        // once with a color-matched radial disc; zero per-frame light cost.
        bakeSpill(g, this.glowSigns[ci], x0 + sw * 0.5, y0 + sh * 0.5, sw * 0.95, 0.42);
        bakeSpill(g, this.glowSigns[ci], x0 + sw * 0.5, y0 + sh + 22, sw * 1.25, 0.16);
      }
    }
    // PROJECTED 3D SHADOWS — each tower throws a skewed volume onto the
    // geometry to its lower-left; source-atop keeps the sky gaps clean.
    bakeCastShadows(g, towers, MID_H, 0.2);
    const gr = g.createLinearGradient(0, MID_H - 70, 0, MID_H);
    gr.addColorStop(0, 'rgba(7,13,18,0)');
    gr.addColorStop(1, 'rgba(7,13,18,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, MID_H - 70, TILE, 70);
    g.globalCompositeOperation = 'source-atop';            // aerial lift (mid)
    g.fillStyle = 'rgba(36,56,80,0.09)';
    g.fillRect(0, 0, TILE, MID_H);
    // GLOBAL KEY WASH — same moon, same law: upper-right lit, lower-left
    // in shadow, applied only where towers exist (source-atop)
    const keyM = g.createLinearGradient(TILE, 0, 0, MID_H);
    keyM.addColorStop(0, 'rgba(175,205,240,0.085)');
    keyM.addColorStop(0.5, 'rgba(175,205,240,0.02)');
    keyM.addColorStop(1, 'rgba(8,14,22,0.18)');
    g.fillStyle = keyM;
    g.fillRect(0, 0, TILE, MID_H);
    bakeFilmGrade(g, TILE, MID_H, this.mood, 0.7, rng);
    g.globalCompositeOperation = 'source-over';
    // ISOLATION HERO — ONE supernormal landmark per tile. A single vivid
    // crown against desaturated towers is the eye's anchor (von Restorff).
    if (towers.length > 0) {
      let ht = towers[0];
      for (const t2 of towers) if (t2.bh > ht.bh) ht = t2;
      bakeIsolationHero(g, ht.x, ht.bw, MID_H - ht.bh, MID_H, this.mood, this.heroDisc);
    }
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
    const rng = mulberry32(0x77d1ee ^ this.runSeed);
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
      // BAKED VOLUME SHADING — key from the upper right (same law as the
      // deeper bands, stronger contrast this close to camera)
      g.fillStyle = 'rgba(170,205,235,0.07)';
      g.fillRect(x + bw - 5, NEAR_H - bh, 5, bh);
      g.fillStyle = 'rgba(0,0,0,0.36)';
      g.fillRect(x, NEAR_H - bh, Math.min(6, bw * 0.18), bh);
      const aoN = g.createLinearGradient(0, NEAR_H - 34, 0, NEAR_H);
      aoN.addColorStop(0, 'rgba(0,0,0,0)');
      aoN.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = aoN;
      g.fillRect(x, NEAR_H - 34, bw, 34);
      const nb = 1 + ((rng() * 3) | 0);                    // rooftop boxes
      for (let i = 0; i < nb; i++) {
        const rw = 18 + rng() * 42, rh = 8 + rng() * 14;
        const rx = x + 6 + rng() * Math.max(1, bw - rw - 12);
        g.fillStyle = '#04080b';
        g.fillRect(rx, NEAR_H - bh - rh, rw, rh);
        g.fillStyle = 'rgba(60,84,94,0.1)';
        g.fillRect(rx, NEAR_H - bh - rh, rw, 1);
        bakePropShadow(g, rx + rw / 2, NEAR_H - bh, rw * 0.6, 0.36);
      }
      const clutter = rng();                               // near-lane roof dressing
      if (clutter < 0.16 && bw > 170) {                    // water tower silhouette
        const tw = 26 + rng() * 16, th = 26 + rng() * 18;
        const tx = x + 14 + rng() * (bw - tw - 28);
        const ty = Math.max(2, NEAR_H - bh - th - 10);
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
        bakePropShadow(g, tx + tw / 2, NEAR_H - bh, tw * 0.8, 0.4);
      } else if (clutter < 0.27 && bw > 150) {             // billboard, seen from behind
        const bwi = Math.min(120, bw - 50), bhei = 40 + rng() * 22;
        const bx0 = x + 24 + rng() * Math.max(4, bw - bwi - 48);
        const by0 = Math.max(2, NEAR_H - bh - bhei - 16);
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
        bakePropShadow(g, bx0 + bwi / 2, NEAR_H - bh, bwi * 0.5, 0.4);
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
        bakePropShadow(g, ax2 + aw / 2, NEAR_H - bh, aw * 0.7, 0.38);
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
      /* PROCEDURAL ARCHETYPE — silhouette + window personality are chosen
       * per building from this band's seeded RNG. Five shapes, four
       * occupancy patterns, baked emissive spill on every lit cell. */
      const arch = (['slab', 'setback', 'glass', 'warehouse', 'spire'] as const)[(rng() * 5) | 0];
      bakeArchetype(g, {
        x, bw, bh, H: NEAR_H, shade, rng, persona: (rng() * 4) | 0,
        warm: this.glowWarm, cool: this.glowCool,
      }, arch);
      // GRAFFITI TAG — teen street appeal on ~1/3 of near facades
      if (rng() < 0.34 && bw > 150 && bh > 190) {
        bakeGraffiti(g, x, NEAR_H - bh, bw, bh, this.mood, rng);
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
              bakeSpill(g, onFloor ? this.glowWarm : this.glowCool, wx + 1, wy + 1, 12, 0.16);
            }
          }
        }
      }
      towers.push({ x, w: bw, h: bh });
      x += bw + 18 + rng() * 60;
    }
    // 3D cast shadows across the near skyline (baked, source-atop clipped)
    bakeCastShadows(g, towers.map((t) => ({ x: t.x, bw: t.w, bh: t.h })), NEAR_H, 0.24);
    /* ENCLOSED GLASS SKYBRIDGES — a second bridge family on the near plane:
     * lit corridor slab, mullioned glazing, baked AO at both junction bites. */
    for (let i = 0; i + 1 < towers.length; i++) {
      const a = towers[i], b = towers[i + 1];
      const gap = b.x - (a.x + a.w);
      if (gap < 20 || gap > 108 || rng() < 0.38) continue;
      const y0 = Math.max(NEAR_H - a.h, NEAR_H - b.h) + 26 + rng() * 42;
      if (y0 > NEAR_H - 44) continue;
      const bx0 = a.x + a.w;
      const span = b.x - bx0;
      g.fillStyle = '#070c11';
      g.fillRect(bx0, y0, span, 18);
      g.fillStyle = 'rgba(150,192,224,0.16)';
      g.fillRect(bx0, y0, span, 1.4);
      g.fillStyle = `rgba(${this.mood.pop},0.3)`;
      g.fillRect(bx0, y0 + 17, span, 1);
      g.fillStyle = 'rgba(255,188,116,0.4)';
      for (let wx2 = bx0 + 4; wx2 < b.x - 3; wx2 += 11) {
        if (rng() < 0.75) g.fillRect(wx2, y0 + 5, 6, 8);
      }
      g.fillStyle = 'rgba(140,184,214,0.08)';
      g.fillRect(bx0, y0 + 4, span, 10);
      g.strokeStyle = 'rgba(18,28,36,0.9)';
      g.lineWidth = 1.4;
      for (let wx2 = bx0 + 8; wx2 < b.x; wx2 += 12) {
        g.beginPath(); g.moveTo(wx2, y0 + 2); g.lineTo(wx2, y0 + 18); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.44)';
      g.fillRect(bx0 - 4, y0 - 3, 6, 24);
      g.fillRect(b.x - 2, y0 - 3, 6, 24);
      bakeSpill(g, this.glowWarm, bx0 + span * 0.5, y0 + 9, span * 0.7, 0.12);
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
    // GLOBAL KEY WASH — strongest of the stack: the near plane carries the
    // clearest directional read (lit right faces, shadowed left + base)
    const keyN = g.createLinearGradient(TILE, 0, 0, NEAR_H);
    keyN.addColorStop(0, 'rgba(180,210,245,0.1)');
    keyN.addColorStop(0.5, 'rgba(180,210,245,0.025)');
    keyN.addColorStop(1, 'rgba(6,10,16,0.22)');
    g.fillStyle = keyN;
    g.fillRect(0, 0, TILE, NEAR_H);
    bakeFilmGrade(g, TILE, NEAR_H, this.mood, 0.85, rng);
    g.globalCompositeOperation = 'source-over';
    // CHROMATIC EDGE FRINGE + rhythmic parapet strips (peak-shift outline
    // energy, grouping/repetition) — applied after the grade so the pops
    // stay saturated against the calm field.
    bakeChromaticEdges(g, towers, NEAR_H, this.mood, rng);
    {
      let nHero = towers[0];
      for (const t2 of towers) if (t2.h > nHero.h) nHero = t2;
      bakeIsolationHero(g, nHero.x, nHero.w, NEAR_H - nHero.h, NEAR_H, this.mood, this.heroDisc);
    }
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
    const smearCols: ReadonlyArray<string> = [this.mood.pop, this.mood.pop2, this.mood.highlight, '141,91,255'];
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

    /* PRE-BAKED WET-DECK REFLECTIONS — the mirror band below the foot
     * line. Every source smears straight down the wet concrete: the
     * streetlamp's cool column, the neon lip colors pulled into long
     * streaks, and a broad specular sheen. Static — zero runtime cost. */
    const lampX2 = LAMP_X - ARENA_X0;
    const lampCol = g.createLinearGradient(0, 14, 0, 128);
    lampCol.addColorStop(0, 'rgba(178,202,232,0.15)');
    lampCol.addColorStop(0.5, 'rgba(178,202,232,0.06)');
    lampCol.addColorStop(1, 'rgba(178,202,232,0)');
    g.fillStyle = lampCol;
    g.fillRect(lampX2 - 36, 14, 72, 114);
    for (let i = 0; i < 7; i++) {                         // neon streaks down the deck
      const col = smearCols[i % smearCols.length];
      const mx = 150 + rng() * (W - 320);
      const mw = 7 + rng() * 16;
      const mh = 36 + rng() * 74;
      const sg2 = g.createLinearGradient(0, 14, 0, 14 + mh);
      sg2.addColorStop(0, `rgba(${col},${(0.1 + rng() * 0.05).toFixed(3)})`);
      sg2.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = sg2;
      g.fillRect(mx, 14, mw, mh);
    }
    const sheen = g.createLinearGradient(0, 16, 0, 104);   // specular sheen band
    sheen.addColorStop(0, 'rgba(172,198,216,0.075)');
    sheen.addColorStop(1, 'rgba(172,198,216,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 16, W, 88);

    /* DUAL-REGISTER PLAY PLANE — a thin rhythmic light rail (grouping +
     * repetition, teen energy) and FOUR isolated saturated sticker decals
     * on the fall wall; the rest of the deck stays calm, dark and filmic. */
    g.fillStyle = `rgba(${this.mood.pop},0.14)`;
    g.fillRect(0, 2, W, 1);
    for (let sx = 0; sx < W; sx += 64) {
      g.fillStyle = `rgba(${this.mood.pop2},0.15)`;
      g.fillRect(sx + 6, 3, 24, 1);
    }
    for (let i = 0; i < 4; i++) {
      const dx = 300 + i * 640 + rng() * 90;
      const dy = 186 + rng() * 46;
      const col = i % 2 ? this.mood.pop : this.mood.pop2;
      g.save();
      g.translate(dx, dy);
      g.rotate(-0.12 + rng() * 0.24);
      g.strokeStyle = `rgba(${col},0.35)`;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(0, 12); g.lineTo(12, 0); g.lineTo(24, 12); g.lineTo(12, 24); g.closePath();
      g.stroke();
      g.fillStyle = `rgba(${col},0.12)`;
      g.fillRect(4, 10, 16, 4);
      g.restore();
      bakeSpill(g, this.heroDisc, dx + 12, dy + 12, 34, 0.1);
    }
    /* STAGE PROPS (designed, baked) — deck hardware flush with the floor
     * and dressing on the fall wall, all clear of the play band. */
    for (const vx of [420, 1180, 2050, 2510]) {            // low floor vents
      g.fillStyle = '#0b1015';
      g.fillRect(vx, 142, 44, 7);
      g.fillStyle = 'rgba(150,175,190,0.16)';
      g.fillRect(vx, 142, 44, 1);
      for (let gi = 1; gi < 4; gi++) {
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(vx + 3, 142 + gi * 1.6, 38, 0.9);
      }
      bakePropShadow(g, vx + 22, 149, 26, 0.34);
    }
    for (const px2 of [640, 1560, 2280]) {                 // fall-wall pipe runs
      g.strokeStyle = 'rgba(40,54,64,0.9)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(px2, 176);
      g.lineTo(px2, 244);
      g.stroke();
      g.strokeStyle = 'rgba(120,146,160,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px2 - 2, 176);
      g.lineTo(px2 - 2, 244);
      g.stroke();
      g.fillStyle = 'rgba(30,42,50,0.95)';                 // pipe collars
      g.fillRect(px2 - 4, 196, 8, 4);
      g.fillRect(px2 - 4, 226, 8, 4);
    }
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

    /* FLIPPED-SPRITE REFLECTIONS — the cheap-on-hardware mirror for every
     * foreground object. Duplicate the sprite, flip it vertically, squash
     * it into the wet deck and bake a vertical alpha fade. No live reflection
     * pass, no render target, no shader: these pixels are part of this tile. */
    bakeFlipReflection(g, this.doorSpr, doorX - 84, LIP_H + 1, 168, 108, 0.45);
    bakeFlipReflection(g, this.lampSpr, lampX - 44, LIP_H + 1, 88, 122, 0.55);
    // warm bounce from the doorway onto the water just below it
    bakeSpill(g, this.glowWarm, doorX, LIP_H + 16, 92, 0.14);
    // wet-concrete micro-ripples chop both mirrors into believable water
    for (let i = 0; i < 22; i++) {
      const ry = LIP_H + 8 + rng() * 108;
      const rx = rng() < 0.5 ? doorX - 90 + rng() * 180 : lampX - 48 + rng() * 96;
      g.fillStyle = `rgba(12,20,28,${(0.1 + rng() * 0.22).toFixed(3)})`;
      g.fillRect(rx, ry, 8 + rng() * 34, 0.8 + rng() * 1.2);
    }
    // specular hairlines: the wet deck catches the two practicals as thin
    // broken highlights straight below their feet
    for (let i = 0; i < 9; i++) {
      const hx = (i % 2 ? lampX : doorX) + (rng() - 0.5) * 70;
      const hy = LIP_H + 6 + i * 11;
      g.fillStyle = i % 2 ? 'rgba(178,210,238,0.16)' : 'rgba(255,178,112,0.16)';
      g.fillRect(hx - 8 - rng() * 12, hy, 16 + rng() * 26, 1);
    }
    /* ================= V3 — SHADOW / LIGHT / REFLECTION LAYER =============
     * Everything below is BAKED into this tile: it costs nothing at runtime
     * and never allocates. Three families:
     *   1. light  — moon shafts across the deck, extra wall practicals, a
     *               specular moon column (the deck catching the key light)
     *   2. shadow — second-generation cast shadows: every piece of hardware
     *               throws a moon-direction rake, plus contact AO
     *   3. mirror — each practical ALSO gets its own flipped reflection plate,
     *               so the wet deck is lit by the whole set, not two props
     * ==================================================================== */

    /* 1a — MOON SHAFTS: the key light leaks between the towers as 3 soft
     * additive bands raking lower-left. Baked, so they are free forever. */
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const sx = 260 + i * 940 + rng() * 220;
      const sw = 120 + rng() * 90;
      g.save();
      g.translate(sx, 70);
      g.rotate(-0.62);
      const sg3 = g.createLinearGradient(0, 0, sw, 0);
      sg3.addColorStop(0, 'rgba(166,198,232,0)');
      sg3.addColorStop(0.45, `rgba(176,206,238,${(0.05 + rng() * 0.025).toFixed(3)})`);
      sg3.addColorStop(1, 'rgba(166,198,232,0)');
      g.fillStyle = sg3;
      g.fillRect(0, -190, sw, 420);
      g.restore();
    }
    g.restore();

    /* 1b — SPECULAR MOON COLUMN on the deck (the wet concrete catching the
     * moon as one long broken column) + its contact pool. */
    {
      const mx0 = 2180;
      const col = g.createLinearGradient(0, LIP_H, 0, 142);
      col.addColorStop(0, 'rgba(196,222,248,0.17)');
      col.addColorStop(0.4, 'rgba(186,214,242,0.085)');
      col.addColorStop(1, 'rgba(178,208,238,0)');
      g.fillStyle = col;
      g.fillRect(mx0 - 52, LIP_H, 104, 128);
      for (let i = 0; i < 16; i++) {                        // broken highlights
        const hx = mx0 - 46 + rng() * 92;
        const hy = LIP_H + 4 + i * 8;
        g.fillStyle = `rgba(214,236,255,${(0.06 + rng() * 0.10).toFixed(3)})`;
        g.fillRect(hx, hy, 6 + rng() * 26, 0.9);
      }
      g.fillStyle = 'rgba(190,220,250,0.06)';
      g.beginPath(); g.ellipse(mx0, 30, 90, 14, 0, 0, TAU); g.fill();
    }

    /* 2 — SECOND-GENERATION CAST SHADOWS. One rake, reused by every piece of
     * hardware: the moon sits upper-right, so shadows fall lower-LEFT with a
     * long diagonal. Drawn before the hardware so the object sits on top. */
    const rake = (cx: number, baseY: number, w: number, len: number, a: number): void => {
      g.fillStyle = `rgba(0,0,0,${a})`;
      g.beginPath();
      g.moveTo(cx - w * 0.5, baseY);
      g.lineTo(cx + w * 0.5, baseY);
      g.lineTo(cx - w * 0.5 - len, baseY - len * 0.34);
      g.lineTo(cx - w * 0.5 - len * 1.12, baseY - len * 0.34);
      g.closePath();
      g.fill();
    };

    /* 3 — DECK HARDWARE (dressing, all BELOW the play band y<0): condenser
     * units, a cable spool, junction boxes. Each one: rake shadow → contact
     * AO → body → moon rim → its own wet reflection strip. */
    const hardware: ReadonlyArray<[number, number]> = [[520, 0], [1310, 1], [1990, 0], [2560, 1]];
    for (let i = 0; i < hardware.length; i++) {
      const hx = hardware[i][0] + 300;
      if (Math.abs(hx - doorX) < 150 || Math.abs(hx - lampX) < 130) continue;
      const bw = 46 + rng() * 18;
      const bh = 26 + rng() * 10;
      const baseY = 148;
      rake(hx, baseY, bw, 42, 0.30);
      bakePropShadow(g, hx, baseY, bw * 0.6, 0.42);
      // body
      const bodyG = g.createLinearGradient(0, baseY - bh, 0, baseY);
      bodyG.addColorStop(0, '#2a343c');
      bodyG.addColorStop(0.5, '#1b242b');
      bodyG.addColorStop(1, '#0e151a');
      g.fillStyle = bodyG;
      g.fillRect(hx - bw * 0.5, baseY - bh, bw, bh);
      // moon rim (upper right edge) + cool top plate
      g.fillStyle = 'rgba(168,198,226,0.30)';
      g.fillRect(hx - bw * 0.5, baseY - bh, bw, 1.4);
      g.fillStyle = 'rgba(168,198,226,0.20)';
      g.fillRect(hx + bw * 0.5 - 1.4, baseY - bh, 1.4, bh);
      // fan grille
      g.strokeStyle = 'rgba(120,146,166,0.28)';
      g.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        g.arc(hx + bw * 0.1, baseY - bh * 0.5, bh * (0.13 + k * 0.07), 0, TAU);
        g.stroke();
      }
      // vent slats + a small status LED lit by the palette
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 3; k++) g.fillRect(hx - bw * 0.42, baseY - bh + 5 + k * 3, bw * 0.22, 1.2);
      g.fillStyle = `rgba(${this.mood.pop2},0.75)`;
      g.fillRect(hx + bw * 0.34, baseY - bh + 4, 2.2, 2.2);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(hx - bw * 0.5, baseY, bw, 2);
      // its own mirror on the wet deck
      const refl = g.createLinearGradient(0, baseY, 0, baseY + 26);
      refl.addColorStop(0, 'rgba(150,180,210,0.13)');
      refl.addColorStop(1, 'rgba(150,180,210,0)');
      g.fillStyle = refl;
      g.fillRect(hx - bw * 0.5, baseY, bw, 26);
    }

    /* 4 — WALL PRACTICALS on the fall wall: two neon strips + 3 lit windows.
     * Each gets a baked spill disc, so the wall is LIT, not painted. */
    for (let i = 0; i < 2; i++) {
      const nx = 700 + i * 1180 + rng() * 160;
      const col = i === 0 ? this.mood.pop : this.mood.pop2;
      const nh = 26 + rng() * 18;
      g.fillStyle = `rgba(${col},0.55)`;
      g.fillRect(nx, 206, 2.6, nh);
      g.fillStyle = `rgba(${col},0.14)`;
      g.fillRect(nx - 2.4, 206, 7.4, nh);
      bakeSpill(g, i === 0 ? this.heroDisc : this.glowCool, nx, 206 + nh * 0.5, 58, 0.16);
      // mirrored strip in the deck below (cheap stand-in for the wall's light)
      const mr = g.createLinearGradient(0, 120, 0, 150);
      mr.addColorStop(0, `rgba(${col},0.10)`);
      mr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = mr;
      g.fillRect(nx - 9, 120, 18, 30);
    }
    for (let i = 0; i < 3; i++) {
      const wx = 380 + i * 840 + rng() * 200;
      const wy = 178 + rng() * 44;
      const ww = 7 + rng() * 12;
      g.fillStyle = `rgba(${this.mood.highlight},${(0.16 + rng() * 0.16).toFixed(3)})`;
      g.fillRect(wx, wy, ww, ww * 0.7);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(wx + ww * 0.46, wy, 0.9, ww * 0.7);
      bakeSpill(g, this.glowWarm, wx + ww * 0.5, wy + ww * 0.35, 26, 0.10);
    }

    /* 5 — PIPES + VENT CONTACT AO: the existing wall runs get a bite line and
     * the deck vents get a rake, so nothing floats on the concrete. */
    for (const px3 of [640, 1560, 2280]) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(px3 + 2.4, 176, 1.4, 68);
    }
    for (const vx2 of [420, 1180, 2050, 2510]) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.moveTo(vx2, 149);
      g.lineTo(vx2 + 44, 149);
      g.lineTo(vx2 + 33, 141);
      g.lineTo(vx2 - 11, 141);
      g.closePath();
      g.fill();
    }

    // film grade LAST so the shade, highlights, grain and split-tone unify
    // the reflections, the props and the concrete into one coherent frame
    bakeFilmGrade(g, W, H, this.mood, 0.42, rng);
    return c;
  }

  /** WET-DECK ROUGHNESS MASK — static world-space plate over the mirror
   *  band. Matte micro-striation + dry islands chop the reflection into
   *  wet-asphalt character; destination-out PUDDLE WINDOWS let the sharp
   *  mirror through, each with a moonlit specular rim on the moon side.
   *  Pre-baked: one blit per frame, zero allocs. */

  /* ---------------------- foreground practical props -------------------- */

  /** BROKEN STREETLIGHT — restored physical prop with baked 3D lighting:
   *  leaning pole, moon rim on the right face, left-face occlusion, a cool
   *  emissive head, a baked glow spill and a contact AO at the deck line.
   *  One canvas, one blit at runtime; its mirror is baked into the arena. */
  private buildLampProp(): HTMLCanvasElement {
    const { c, g } = makeCanvas(96, 300);
    // leaning pole (quad, not a rect — reads as a real extrusion)
    g.fillStyle = '#080d13';
    g.beginPath();
    g.moveTo(44, 26); g.lineTo(53, 26); g.lineTo(57, 300); g.lineTo(40, 300);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(168,204,238,0.16)';            // moon rim, right face
    g.beginPath();
    g.moveTo(53, 26); g.lineTo(57, 300); g.lineTo(54, 300); g.lineTo(51, 26);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.4)';                   // left face occlusion
    g.fillRect(40, 26, 4, 274);
    // bracket arm + lamp head (trapezoid with a lit underside)
    g.fillStyle = '#070c11';
    g.fillRect(53, 18, 30, 5);
    g.beginPath();
    g.moveTo(30, 10); g.lineTo(76, 10); g.lineTo(70, 28); g.lineTo(36, 28);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,198,232,0.22)';
    g.fillRect(30, 10, 46, 1.6);
    g.fillStyle = 'rgba(190,224,250,0.7)';              // lamp glass
    g.fillRect(38, 26, 30, 3);
    g.fillStyle = `rgba(${this.mood.pop2},0.55)`;
    g.fillRect(30, 10, 46, 1.4);
    bakeSpill(g, this.glowCool, 53, 30, 62, 0.5);
    bakeSpill(g, this.glowCool, 53, 30, 26, 0.35);
    // warning band + base collar (baked contact AO)
    g.fillStyle = 'rgba(214,158,52,0.5)';
    g.fillRect(41, 262, 15, 3);
    g.fillRect(41, 270, 15, 3);
    g.fillStyle = '#05090d';
    g.fillRect(36, 292, 24, 8);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath(); g.ellipse(48, 299, 20, 4, 0, 0, TAU); g.fill();
    return c;
  }

  /** STAIRWELL HEAD-HOUSE with the warm practical door — the scene's warm
   *  anchor against the cool moon (reference-image interior light). */
  private buildDoorStructure(): HTMLCanvasElement {
    // 54px antenna zone above the roofline (sprite now 200×240; the draw
    // site shifts up by the same 54 so the box lands at its old world y)
    const { c, g } = makeCanvas(200, 240);
    g.translate(0, 54);
    // roof antenna (baked 3D dressing on the head-house)
    g.strokeStyle = 'rgba(26,38,46,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(154, 4);
    g.lineTo(154, -36);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(154, -22);
    g.lineTo(165, -28);
    g.stroke();
    g.fillStyle = 'rgba(255,80,60,0.65)';
    g.fillRect(153, -38, 2, 2);
    // box
    let gr = g.createLinearGradient(0, 14, 0, 120);
    gr.addColorStop(0, '#0d131a');
    gr.addColorStop(1, '#080c11');
    g.fillStyle = gr;
    g.fillRect(16, 12, 168, 174);
    // baked side shading: shadowed left face + contact AO at the deck line
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(16, 12, 13, 174);
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(16, 179, 168, 7);
    // roof cap + moon rims (cool key from upper right)
    g.fillStyle = '#0a0f15';
    g.fillRect(8, 4, 184, 10);
    g.fillStyle = 'rgba(150,185,220,0.4)';
    g.fillRect(8, 4, 184, 1.5);
    g.fillStyle = 'rgba(150,185,220,0.17)';
    g.fillRect(189, 4, 1.5, 182);
    // palette accent rim — the practical shares the run's colour identity
    g.fillStyle = `rgba(${this.mood.pop},0.28)`;
    g.fillRect(8, 4, 184, 1);
    bakeSpill(g, this.heroDisc, 100, 66, 74, 0.12);
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
