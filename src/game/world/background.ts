import type { BridgeStreaming } from '../../graphics/bridge/BridgeStreaming'
import { BridgeAtmosphere } from '../../graphics/bridge/BridgeAtmosphere'
import { bridgeSkyBasis } from '../../graphics/bridge/SkyBasis'
import { bridgePlate } from '../stage/bridge-webp'
import type { BridgeGLTier } from '../../graphics/sacr/BridgeBacking'
import { atmosphereTransmission } from '../stage/bridge-material'
import { RouteScenery, type ShelterPaint } from '../stage/route-art'
import { bridgeBiomeMix, type BridgeRoute } from '../stage/route'
import { RouteWeather } from './route-weather'
import type { ServiceTerminal } from './service'
import { rgba } from '../core/utils'
import { ART_GRADES, artPalette, type SceneArtOptions, type SceneFinish } from './art-grade'
import { lightFacade } from '../lighting/facade'
import { Viaduct } from '../stage/viaduct'
import { bakePractical, materialRamp, paintPlaneTone, type PracticalStamp } from '../stage/baked-finish'
import { ROAD } from '../stage/road-section'
import { FLAT_LANE } from '../stage/flat-lane'
import { BRIDGE_CLIMATE, composeBridgeRun, SHELTER_KINDS, type BridgeRunPlan, type ShelterKind } from '../stage/run-layout'
import { bakeRunShelter, SHELTER_DECK_TOP, type ShelterStamp } from '../stage/run-shelter-art'
import { ENV_TICK, type FrontSample } from './fronts'
import { worldBounds, type WeatherWork } from './exposed-weather'
import { SceneFront } from './scene-front'
import type { WetFixture } from '../stage/sheet-water'
import { paintStationBand, STATION_VOID } from '../stage/station-art'
import { FLOOD } from '../lighting/emitters'
import { RibbonField, newProbe, blockersFor, DECK_W, DECK_H, type Probe } from '../lighting/ribbons'
import {StormEngine} from './storm'
import {FOG} from '../render/look'
import { clipVisibleRows, SkyVaultCache } from '../render/bhst'
import { MOOD_PALETTES, moodForSeed, type MoodPalette } from './mood'
import { makeProfile, type EnvironmentProfile } from './profile'
import { NightLayer } from './night'
import { Rigging } from './rigging'
import { buildCloudBank, bankParams, type BankParams } from './clouds'
import { SurfaceScope, hasPixels } from '../render/ledger'
import { finishPaint } from '../render/paint-slices'
import { WeatherFront, tintAlpha, tintColour } from './weather'
import { keyLightFor, moonCentreX, reflectionGain, rimDirection, type KeyLight } from './light'
import { featuresFor, type Tier } from '../render/graphics'
import type { RaySource } from '../render/post'
import {
  LIGHT_TINT, SIGN_Y, LAMP_Y, PRACTICAL_SIGN_X, PRACTICAL_LAMP_X, BEACON_X, BEACON_Y,
  makeStageLights, type PointLight,
} from './lightfield'
import { animsForBuilding, drawBuildingAnims, orderBuildingAnims, type Band, type BuildingAnim } from './buildings'
import { drawRoofProps, makeRoofProps, type RoofPropSet } from './roofprops'

/** the broken streetlight's world x — the stage's second practical (was
 *  STREET_LIGHT from the deleted lighting engine) */
const LAMP_X = PRACTICAL_LAMP_X
/** stylized moon plate: bake size and on-screen draw size */
const MOON_D = 210
const MOON_HALF = MOON_D * 0.5
const MOON_HALO_D = 402
/* ============================================================================
 * STICKMAN RISING — src/game/world/background.ts
 * Self-contained parallax cyberpunk-city backdrop (night viaduct stage).
 * ----------------------------------------------------------------------------
 * Contract with the caller (everything in CSS pixels — the caller owns any
 * devicePixelRatio scaling of the context):
 *   drawSky(ctx, cam)      screen-space pass, full viewport, drawn first.
 *   drawArena(ctx)         world-space pass — caller ALREADY applied
 *                          translate(w/2,h/2) · scale(zoom) · translate(-cam).
 *   drawWeather(ctx, cam)  screen-space pass drawn after world entities.
 * World conventions: ground plane is y = 0 (entities live at y <= 0), the
 * arena floor spans world x in [-150, 2750], the front girder ends at
 * y = +82, the camera hovers around y = -170 with zoom 0.85..1.3.
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
  rot?: number
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
  dispose?():void
  update(dt:number):void
  /** Fixed active-play weather clock; diagnostic art keeps its own clock. */
  advanceActiveTicks?(ticks: number, interpolation: number): void
  keyWeightAt?(x: number): number
  rainAudioAt?(x: number): number
  weatherWork?(): Readonly<WeatherWork>
  skyBackend?(): string
  runLayout?(): BridgeRunPlan | null
  setRoute?(route: BridgeRoute): void
  supportAt?(x: number): ReturnType<BridgeRoute['platformAt']>
  syncCutaway?(x: number, y: number, dt: number): void
  drawRouteExterior?(ctx: CanvasRenderingContext2D, cam: BgCam, service?: ServiceTerminal, paint?: ShelterPaint): void
  drawNearRain?(ctx: CanvasRenderingContext2D, cam: BgCam, master?: boolean): void
  routeTime?(): number
  routeRainTime?(): number
  routeWindAt?(x: number): number
  routeDrift?(): number
  routeFootfall?(x: number, y: number, strength: number, vx: number, landing?: boolean): void
  bridgeLandings?(out: Float32Array, left: number, right: number): number
  clipWet?(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number): void
  /** Change the draw budget WITHOUT discarding baked art. */
  setQuality(q:Quality):void
  /** OPTIONAL: re-seed the procedural skyline for a fresh run. Invalidates
   *  the baked tiles; the rebuild happens once, before the next frame. */
  setRunSeed?(seed: number, preparedNight?: NightLayer): void
  createNightForSeed?(seed: number): NightLayer | null
  setReducedMotion?(enabled: boolean): void
  useQuietEnemyFinish?(): boolean
  bloomGain?(): number
  /** Optics are painted from emitters, never sampled from the scene. */
  usesBakedOptics?(): boolean
  /** A dry receiver has neither actor nor environment mirrors. */
  hasWetSurface?(): boolean
  actorReflectionGain?(): number
  surfaceWetness?(x: number): number
  lightningI():number
  lightningAz():number
  drawSky(ctx:CanvasRenderingContext2D,cam:BgCam,worldCam?:BgCam, tier?: BridgeGLTier, impulse?: number):void
  titleAssets?(): number
  drawBridgeTitle?(ctx: CanvasRenderingContext2D, cam: BgCam): void
  drawBridgeTitleSteps?(ctx: CanvasRenderingContext2D, cam: BgCam): Generator<void>
  drawBridgeBackdrop?(ctx: CanvasRenderingContext2D, cam: BgCam, atmo: BridgeAtmosphere, impulse: number, sparse?: boolean): void
  drawBridgeBackdropSteps?(ctx: CanvasRenderingContext2D, cam: BgCam, atmo: BridgeAtmosphere, sparse: boolean): Generator<void>
  drawBridgeRoadSteps?(ctx: CanvasRenderingContext2D, cam: BgCam, master: boolean, gpuRoad: boolean): Generator<void>
  railWake?(t: number, x: number): number
  bridgeStream?(): BridgeStreaming | undefined
  drawBridgeWater?(ctx: CanvasRenderingContext2D, cam: BgCam, wet: number): void
  drawArena(ctx:CanvasRenderingContext2D, forward?:boolean, cam?:BgCam, impulse?: number, master?: boolean, gpuRoad?: boolean, provisional?: boolean, deferStream?: boolean):void
  /** OPTIONAL foreground pass — world-space, drawn AFTER the entities so
   *  near-lane dressing occludes fighters. */
  drawFront?(ctx:CanvasRenderingContext2D):void
  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void
  /** V3 reactive layer (optional so lightweight test doubles stay valid) */
  practicalLight?(x: number): { warm: number; cool: number }
  /** Dust motes in the shafts; one path, one fill (ultra). */
  drawMotes?(ctx: CanvasRenderingContext2D, t: number): void
  /** Screen-space positions + weights of the sources the god-ray pass radiates
   *  from (the moon and every lit practical on screen). */
  raySources?(w: number, h: number, cam: BgCam): RaySource[]
  /** The light field's sample at a world point (the renderer reads this). */
  lightAt?(x: number, y?: number, out?: Probe): Probe
  drawReflections?(ctx: CanvasRenderingContext2D, cam: BgCam, quality: Quality, forward?: boolean): void
  /** The run identity (world/profile.ts). Optional so the test doubles and the
   *  HUD-only renderers do not need a night. */
  getProfile?(): EnvironmentProfile | null
  /** Which path baked this run's plates ('gpu' = the WebGL2 baker ran). */
  plateStats?(): ReturnType<NightLayer['stats']> | null
  /** Bake the run's plates now and report the cost in ms (see warm above). */
  warm?(): number
  /** Prepare the attract scene without a synchronous WebGL bake. */
  warmAttract?(): void
  /** Screen x of the moon — the stage's only light direction (contact shadows). */
  moonScreenX?(): number
  /** The key light model (world/light.ts). */
  lightState?(): KeyLight
  /** Live weather, for the debug readout (world/weather.ts). */
  weatherState?(): Readonly<FrontSample> | WeatherReadout | null
}

type WeatherReadout = { kind: string; s: number; rain: number; fog: number; gust: number; changes: number }

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
/** The figure's authored height, for the body-wash scale. Kept here rather than
 *  imported from render/shadows.ts so the world layer does not depend on the
 *  render layer's shadow module just for a number. */


const ARENA_X0 = FLAT_LANE.artLeft;
const ARENA_X1 = FLAT_LANE.artRight;
const SIGN_X = PRACTICAL_SIGN_X;  // amber traffic display, world x
const ARENA_W = ARENA_X1 - ARENA_X0;
// Guard rows keep bilinear filtering from pulling colour between light strips.
const DECK_STRIDE = DECK_H + 2;
const deckLightFloor = (lamp: PointLight) => Math.min(1, lamp.gain * (1 - lamp.flicker));
const STAR_H = 640;
const DEEP_H = 420;           // deepest skyline band (new)
const FAR_H = 480;
const MID_H = 560;
const NEAR_H = 480;

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

type MakeCanvas = (w: number, h: number) => { c: HTMLCanvasElement; g: CanvasRenderingContext2D };

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
function buildGlowDisc(makeCanvas: MakeCanvas, rgb: string): HTMLCanvasElement {
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

/** VOLUMETRIC SHAFT — a cone of light hanging in the air under a practical.
 *
 *  A lamp that only brightens the surface under it reads as a decal. A lamp with
 *  a faint cone reads as a source *in air*: dust, drizzle, smoke. This is the
 *  cheapest honest volumetric cue there is — one baked canvas, one additive blit,
 *  no per-pixel work — and it is the single most "expensive looking" thing in the
 *  whole scene per unit of cost.
 *
 *  Drawn as a trapezoid from the source downward, brightest at the mouth, with a
 *  soft vertical fade so the cone has no visible end. */
function buildShaft(makeCanvas: MakeCanvas, rgb: string, topW: number, botW: number, h: number): HTMLCanvasElement {
  const w = Math.ceil(Math.max(topW, botW)) + 24;
  const { c, g } = makeCanvas(w, h);
  // Evaluate the penumbra across each row, not against the maximum width.
  // A constant-width mask leaves a razor-sharp triangle near the luminaire.
  const image=g.createImageData(w,h),color=rgb.split(',').map(Number)
  for(let j=0;j<h;j++){
    const v=(j+.5)/h,radius=(topW+(botW-topW)*v)*.5
    for(let i=0;i<w;i++){
      const u=Math.min(1,Math.abs(i+.5-w*.5)/radius),k=(j*w+i)*4
      const penumbra=1-u*u*(3-2*u)
      image.data[k]=color[0];image.data[k+1]=color[1];image.data[k+2]=color[2]
      image.data[k+3]=Math.round(180*penumbra*(1-v)**1.4)
    }
  }
  g.putImageData(image,0,0)
  return c;
}

function drawShaft(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement,
  x: number, y: number, gain: number, layers: 1 | 2): void {
  const core = layers === 2;
  ctx.globalAlpha = gain * (core ? .65 : 1);
  ctx.drawImage(sprite, x - sprite.width / 2, y);
  if (core) {
    // Redistribute the same light into a tighter core, not a brighter room.
    // .65 + .875 × .4 = 1. Uses the same pinned plate as the outer cone.
    const width = sprite.width * .4;
    ctx.globalAlpha = gain * .875;
    ctx.drawImage(sprite, x - width / 2, y, width, sprite.height);
  }
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
function buildAuroraTile(makeCanvas: MakeCanvas, pal: MoodPalette, hue = 0.2): HTMLCanvasElement {
  const { c, g } = makeCanvas(512, 190);
  const rng = mulberry32(0xa0c17e);
  // AURORA HUE (profile axis): 0 = a cold ribbon (cool pop2 / shadow),
  // 1 = a warm one (pop / highlight). The two middle colours are mixed by the
  // axis so the ribbon is one continuous identity, not a random palette pick.
  const cold = hue < 0.5;
  const a0 = cold ? pal.pop2 : pal.pop;
  const a1 = cold ? pal.pop : pal.highlight;
  const cols = [a0, pal.shadow, a1, cold ? pal.pop : pal.pop2];
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
  grade?: { temperature: number; contrast: number; saturation: number; grain: number },
): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  // FOUR PROFILE AXES, all bake-time:
  //  · contrast scales the split-tone strength and the black point;
  //  · temperature biases which side gets the warm stop (a warm run pushes
  //    the highlight further into the frame, a cool run pulls it back);
  //  · saturation is applied LAST as a desaturating pass below 1 (canvas has
  //    no saturation boost that is not a lie, so above 1 we warm instead);
  //  · grain scales both the count and the amplitude of the film noise.
  const contrast = grade ? Math.max(0.7, Math.min(1.4, grade.contrast)) : 1;
  const temp = grade ? Math.max(-1, Math.min(1, grade.temperature)) : 0;
  const grainAmt = grade ? Math.max(0, Math.min(1, grade.grain)) : 0.6;
  strength *= contrast;
  if (temp !== 0) {
    const warmSide = temp > 0 ? w : w * 0.3;
    const warm = g.createLinearGradient(warmSide, 0, 0, h);
    warm.addColorStop(0, `rgba(${pal.highlight},${(Math.abs(temp) * 0.05).toFixed(3)})`);
    warm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = warm;
    g.fillRect(0, 0, w, h);
  }
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
  const n = Math.min(9000, Math.round(((w * h) / 900) * (0.4 + grainAmt * 1.1)));
  for (let i = 0; i < n; i++) {
    const a = ((0.012 + rng() * 0.022) * (0.55 + grainAmt * 0.8)).toFixed(3);
    g.fillStyle = rng() < 0.5 ? `rgba(226,238,250,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(rng() * w, rng() * h, 1, 1);
  }
  // SATURATION below 1: a neutral veil in 'saturation' mode replaces the
  // backdrop's saturation with grey's, which is exactly a desaturating pass.
  if (grade && grade.saturation < 0.999) {
    const k = Math.max(0, Math.min(1, 1 - grade.saturation));
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = `rgba(128,128,128,${(k * 0.9).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}

/** SCREEN VIGNETTE — one baked plate, one blit in the existing weather pass.
 *  Dark corners guide the eye to the centre (visual hierarchy) without any
 *  live radial gradient or full-screen post engine. */
function paintVignette(g: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const rg = g.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  // Seeded strength changes corner density without moving scene geometry.
  const v = Math.max(0.3, Math.min(1.4, strength));
  rg.addColorStop(0.6, `rgba(4,8,14,${(0.055 * v).toFixed(3)})`);
  rg.addColorStop(1, `rgba(2,4,9,${Math.min(0.72, 0.5 * v).toFixed(3)})`);
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);
  const wg = g.createLinearGradient(0, h * 0.74, 0, h);
  wg.addColorStop(0, 'rgba(255,150,80,0)');
  wg.addColorStop(1, 'rgba(255,150,80,0.03)');
  g.fillStyle = wg;
  g.fillRect(0, h * 0.74, w, h * 0.26);
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

interface LayerDef { f: number; vf: number; lift: number }

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
 * through one `drawCityBand()` path (tile blit and lower district).
 */
/** deepest silhouette ridge, just above the far mega-city */
const LAY_DEEP: LayerDef = { f: 0.032, vf: 0.978, lift: -4 };
/** far mega-city — parallax 0.065 */
const LAY_FAR: LayerDef = { f: 0.065, vf: 0.9675, lift: -10 };
/** mid city with neon signs — parallax 0.14 */
const LAY_MID: LayerDef = { f: 0.14, vf: 0.901, lift: -26 };
/** near-mid foreground towers — parallax 0.30 */
const LAY_NEAR: LayerDef = { f: 0.3, vf: 0.805, lift: -46 };

const RUN_FAR: LayerDef = { ...LAY_FAR, f: .10 };
const RUN_MID: LayerDef = { ...LAY_MID, f: .21 };
const RUN_NEAR: LayerDef = { ...LAY_NEAR, f: .32 };

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
function buildFogPlane(makeCanvas: MakeCanvas): HTMLCanvasElement {
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
function buildSkyStrip(makeCanvas: MakeCanvas, art?: typeof ART_GRADES[keyof typeof ART_GRADES]): HTMLCanvasElement {
  const { c, g } = makeCanvas(8, 600);
  const gr = g.createLinearGradient(0, 0, 0, 600);
  if (art) {
    gr.addColorStop(0, art.sky[0]); gr.addColorStop(.58, art.sky[1]); gr.addColorStop(.86, art.sky[2]);
  } else {
    gr.addColorStop(0, '#04060f');       // deep space navy
    gr.addColorStop(0.28, '#071022');    // upper atmosphere blue
    gr.addColorStop(0.5, '#0a1626');
    gr.addColorStop(0.66, '#0f1d31');    // city glow begins to climb
    gr.addColorStop(0.8, '#172741');     // horizon glow
    gr.addColorStop(0.885, '#223352');   // bright light-pollution band
    gr.addColorStop(0.93, '#2b2f3f');    // warm smog layer over the glow
    gr.addColorStop(0.965, '#1a2130');
  }
  gr.addColorStop(1, SKY_BELOW);
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 600);
  return c;
}

/** CITY GLOW — the light a rooftop sits in that has no single source.
 *
 *  Drawn as an additive plate along the back edge of the deck, anchored to the
 *  world. Two things make it a GLOW and not a stripe:
 *
 *   · the vertical profile is sampled from a smooth curve (a stack of linear
 *     stops), so the alpha reaches exactly 0 at the top of the plate instead of
 *     ending on a visible line;
 *   · the bright pockets are placed low and kept small enough that they never
 *     touch the top edge — a radial gradient clipped by a canvas edge leaves a
 *     hard line, which is the giveaway that a "glow" is a rectangle.
 */
function buildCityGlow(makeCanvas: MakeCanvas, pal: MoodPalette): HTMLCanvasElement {
  const W = 1024
  const H = 220
  const { c, g } = makeCanvas(W, H)
  g.globalCompositeOperation = 'lighter'
  // The rise: city light is a column that fades with height, roughly as
  // (1 - y/H)^1.8. Ten stops of that curve, warm at the base.
  const gr = g.createLinearGradient(0, H, 0, 0)
  for (let i = 0; i <= 10; i++) {
    const u = i / 10                     // 0 at the deck line, 1 at the top
    const a = 0.24 * Math.pow(1 - u, 1.8)
    gr.addColorStop(u, `rgba(${pal.highlight},${a.toFixed(4)})`)
  }
  g.fillStyle = gr
  g.fillRect(0, 0, W, H)
  // a cooler upper layer — haze scatters blue, so the top of the rise is cooler
  const gc = g.createLinearGradient(0, H, 0, 0)
  for (let i = 0; i <= 6; i++) {
    const u = i / 6
    gc.addColorStop(u, `rgba(${pal.pop2},${(0.07 * Math.pow(1 - u, 2.4)).toFixed(4)})`)
  }
  g.fillStyle = gc
  g.fillRect(0, 0, W, H)
  // Three pockets — a street, a sign, a shop front. Low, small, wrap-aware so
  // the plate tiles without a seam.
  const pockets: ReadonlyArray<readonly [string, number, number, number]> = [
    [`rgba(${pal.pop},0.15)`, 0.18, 26, 104],
    [`rgba(${pal.pop2},0.12)`, 0.52, 18, 86],
    [`rgba(${pal.highlight},0.16)`, 0.81, 30, 120],
  ]
  for (const [col, px, py, rad] of pockets) {
    for (const ox of [-W, 0, W]) {
      const rg = g.createRadialGradient(px * W + ox, H - py, 2, px * W + ox, H - py, rad)
      rg.addColorStop(0, col)
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = rg
      g.fillRect(px * W + ox - rad, H - py - rad, rad * 2, rad * 2)
    }
  }
  // The old brightest row sat at the bitmap cut. Feather the receiver end
  // after all pockets are painted so neither the field nor a pocket can leak.
  g.globalCompositeOperation = 'destination-in'
  const edge = g.createLinearGradient(0, 0, 0, H)
  edge.addColorStop(0, '#000')
  edge.addColorStop(.73, '#000')
  edge.addColorStop(.88, 'rgba(0,0,0,.44)')
  edge.addColorStop((H - 1) / H, 'transparent')
  edge.addColorStop(1, 'transparent')
  g.fillStyle = edge
  g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = 'source-over'
  return c
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
function buildMoon(makeCanvas: MakeCanvas, pal: MoodPalette): HTMLCanvasElement {
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
function buildMoonHalo(makeCanvas: MakeCanvas, pal: MoodPalette): HTMLCanvasElement {
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

/* ======================== storm sprite pre-renders ======================= */

/** seamless drifting cloud bank — two flavours built from one layout:
 *  DARK (source-over, the night silhouette) and LIT (additive, re-blitted
 *  while lightning scatters through the deck). Horizontally periodic. */
function buildCloudTile(makeCanvas: MakeCanvas, lit: boolean, texture = 0.5): HTMLCanvasElement {
  const { c, g } = makeCanvas(TILE, 300);
  const rng = mulberry32(0x3c19d2);
  // CLOUD TEXTURE (profile axis): at 0 the deck is a soft sheet of few, wide
  // blobs; at 1 it is torn into many small ones with harder cores. Blob count
  // and core alpha are the two handles — both are bake-time, so the frame cost
  // is identical either way.
  const count = Math.round(10 + texture * 18);
  const coreA = 0.13 + texture * 0.2;
  for (let i = 0; i < count; i++) {
    const cx = rng() * TILE;
    const cy = 60 + rng() * 170;
    const rx = (130 + rng() * 220) * (1 - texture * 0.45);
    const ry = (26 + rng() * 58) * (1 - texture * 0.35);
    const a = (lit ? 0.1 + rng() * 0.12 : coreA + rng() * 0.16) * (0.85 + texture * 0.4);
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
function blurTile(makeCanvas: MakeCanvas, src: HTMLCanvasElement, down: number): HTMLCanvasElement {
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
  // Dissolve the baked base into the air rather than cutting the plate off
  // at a full-width baseline. Leave transparent texels at the upscaled edge.
  const fade = small.g.createLinearGradient(0, Math.max(0, sh - 72 / down), 0, sh - 1);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, '#000');
  small.g.globalCompositeOperation = 'destination-out';
  small.g.fillStyle = fade;
  small.g.fillRect(0, 0, sw, sh);
  small.g.globalCompositeOperation = 'source-over';
  return small.c;
}

/** humid horizon haze band (transparent → soft → transparent, vertical) */
function buildHazeStrip(makeCanvas: MakeCanvas, air?: SceneArtOptions['airlight']): HTMLCanvasElement {
  const { c, g } = makeCanvas(8, 150);
  const gr = g.createLinearGradient(0, 0, 0, 150);
  if (air) {
    gr.addColorStop(0, rgba(air.color, 0));
    gr.addColorStop(.23, rgba(air.color, .12 * air.opacity));
    gr.addColorStop(.60, rgba(air.color, air.opacity));
    gr.addColorStop(.83, rgba(air.color, .62 * air.opacity));
    gr.addColorStop(1, rgba(air.color, 0));
  } else {
    gr.addColorStop(0, 'rgba(150,180,200,0)');
    gr.addColorStop(0.5, 'rgba(150,180,200,0.14)');
    gr.addColorStop(1, 'rgba(150,180,200,0)');
  }
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
function buildGlyph(makeCanvas: MakeCanvas, ci: number): HTMLCanvasElement {
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
  /** Narrow, palette-owned vertical pollution ramp stretched across the viewport. */
  private pollPlate: HTMLCanvasElement | null = null;
  private starTile!: HTMLCanvasElement;
  private moonSpr!: HTMLCanvasElement;
  private moonHalo!: HTMLCanvasElement;   // 4-ring additive scattering bake
  private nearTile!: HTMLCanvasElement;
  private deepTileBlur!: HTMLCanvasElement;
  private fogPlane!: HTMLCanvasElement;   // parallax haze sheet (procedural puffs)
  private auroraTile!: HTMLCanvasElement; // 6th parallax plane: aurora ribbons
  private glowWarm!: HTMLCanvasElement;   // baked emissive light discs
  private lampHalo!: HTMLCanvasElement;
  private signHalo!: HTMLCanvasElement;
  private glowCool!: HTMLCanvasElement;
  private glowSigns: HTMLCanvasElement[] = [];
  private fixtures: PracticalStamp[] = [];
  private wetFixtures: WetFixture[] = [];
  private street!: Viaduct;
  private cloudDark!: HTMLCanvasElement;   // drifting night cloud deck
  private shaftWarm!: HTMLCanvasElement;  // volumetric cone under the display
  private shaftCool!: HTMLCanvasElement;  // ... and under the streetlight
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
  /** Rooftop rigging: cables + pennants on the shared wind (world/rigging.ts). */
  private rig: Rigging | null = null;
  /* THE LIGHT FIELD (world/lightfield.ts) — the two authored practicals plus
   * whatever this run's rooftop props generate. Rebuilt on every run seed; every
   * consumer that asks "how lit is this spot" reads this and nothing else. */
  private field: RibbonField | null = null
  private deckAtlas: HTMLCanvasElement | null = null
  private deckAnimated: number[] = []
  private sample = newProbe()
  /** One seeded layout for the visible props, light blockers and bulb.
   *  Only the surface finish changes with quality. */
  private roof: RoofPropSet = { props: [], lights: [] }
  /** City animation records, per band (world/buildings.ts). Emitted at bake. */
  private bandAnims: Record<Band, BuildingAnim[]> = { deep: [], far: [], mid: [], near: [] }
  /** city light pollution rising over the parapet (one baked plate) */
  private cityGlow: HTMLCanvasElement | null = null
  /** The cumulus bank (world/clouds.ts) — null on a clear run. */
  private bank: HTMLCanvasElement | null = null;
  /** Its derived parameters, resolved ONCE (the draw path must not allocate). */
  private bankP: BankParams | null = null;
  /* ---------------- the weather front (world/weather.ts) ---------------- */
  /** The run's own weather, and the front that moves within it. */
  private wx: WeatherFront | null = null
  /** The run's rain axis, clamped exactly as the storm clamps it. */
  private wxRainBase = 1
  /** Live multipliers, cached per update so the draw path is arithmetic only. */
  private wxFog = 1
  private reducedMotion = false
  private wxWet = 1
  private wxGust = 1
  /** THE KEY LIGHT — one model, every consumer (world/light.ts). */
  private light: KeyLight = { type:'directional', azimuth: 0, elevation: 0.78, warmth: 0.45 }
  /** Last few run seeds, so a new run cannot be a near-copy of the last one
   *  (profile.ts §LAW 3). Bounded: three is enough for the metric to work. */
  private seedHistory: number[] = [];
  private heroDisc!: HTMLCanvasElement;
  private readonly surfaces = new SurfaceScope('background');
  private readonly bakes = this.surfaces.generation('bake');
  private readonly practicalScratch = this.surfaces.generation('practical-work');
  private readonly cityScratch = this.surfaces.generation('city-work');
  private readonly makeCanvas: MakeCanvas = (w, h) => this.bakes.next(w, h, 'bake');
  private readonly stageBakes = this.surfaces.generation('stage');
  private readonly makeStageCanvas: MakeCanvas = (w, h) => this.stageBakes.next(w, h, 'stage-bake');
  private stageKitBuilt = false;
  private dryRecess: HTMLCanvasElement | undefined;
  private layout: BridgeRunPlan | null = null;
  private shelters: Partial<Record<ShelterKind, ShelterStamp>> = {};
  private vignette: HTMLCanvasElement | null = null;
  private vigStrength = NaN;
  private vigFailed = false;
  /* A retained, prefiltered reflection buffer. Its size depends on the
   * viewport and tier, not the per-frame camera zoom or roll. */
  private reflBuf: HTMLCanvasElement | null = null;
  private vigW = 0;
  private vigH = 0;
  private pollMood: MoodPalette | null = null;
  private skyVault = new SkyVaultCache();
  private lastCam: BgCam = { x: 1300, y: NOMINAL_Y, zoom: 1 };
  private readonly station: SceneFinish | undefined;
  private readonly front?: SceneFront;
  private scenery?: RouteScenery;
  private routeWeather?: RouteWeather;
  private get activeFront() { return this.routeWeather?.clock ?? this.front?.clock }
  private routeVignette?: HTMLCanvasElement;
  private lastBakedSky = false;
  private bridgeCloudRim?: HTMLCanvasElement;
  private readonly frontView = { left: 0, right: 0, top: 0, bottom: 0 };
  readonly advanceActiveTicks?: BackgroundRenderer['advanceActiveTicks'];
  readonly keyWeightAt?: BackgroundRenderer['keyWeightAt'];
  readonly rainAudioAt?: BackgroundRenderer['rainAudioAt'];
  readonly weatherWork?: BackgroundRenderer['weatherWork'];
  readonly skyBackend?: BackgroundRenderer['skyBackend'];

  get onThunder(){return this.storm.onThunder}
  set onThunder(cb:(()=>void)|null){this.storm.onThunder=cb}
  constructor(quality:Quality,storm=new StormEngine(quality), private readonly art: SceneArtOptions = {},
    mode?: 'combined-run' | 'continuous-run') {
    this.q=quality;this.storm=storm;
    this.station = art.architecture === 'station' ? art.finish : undefined;
    this.storm.setSharpRain(Boolean(art.sharpRain));
    if (this.station || mode) this.storm.setRainScale(0);
    if (mode === 'continuous-run') {
      this.advanceActiveTicks = (ticks, alpha) => {
        this.routeWeather?.advance(ticks, alpha);
        this.t = this.activeFront?.time ?? 0;
      };
      this.keyWeightAt = x => this.routeWeather?.keyWeightAt(x) ?? 1;
      this.rainAudioAt = x => this.routeWeather?.rainAudioAt(x) ?? 0;
      this.weatherWork = () => this.routeWeather!.work;
      this.skyBackend = () => this.bank ? 'city-bank' : 'city-decks';
    }
    if (mode === 'combined-run') {
      this.layout = composeBridgeRun(this.runSeed);
      const front = this.front = new SceneFront(BRIDGE_CLIMATE, this.layout.exposure, this.runSeed);
      this.advanceActiveTicks = (ticks, alpha) => {
        front.advance(ticks, alpha);
        this.t = front.clock.time;
        this.rig?.windState.setExternal(front.clock.sample.windX);
        if (!this.reducedMotion && ticks) this.rig?.update(ticks * ENV_TICK);
      };
      this.keyWeightAt = x => front.keyWeightAt(x);
      this.rainAudioAt = x => front.rainAudioAt(x);
      this.weatherWork = () => front.weather.stats;
      this.skyBackend = () => this.bank ? 'city-bank' : 'city-decks';
    }
    this.mood = artPalette(moodForSeed(0x51a2c9), this.art.grade);
  }

  setRoute(route: BridgeRoute): void {
    if (this.scenery) this.scenery.reset(route);
    else this.scenery = new RouteScenery(route);
    this.routeWeather = new RouteWeather(route);
    this.t = 0;
    this.skyVault.invalidate();
  }
  railWake(t: number, x: number) { return this.scenery?.railWake(t, x) ?? 0 }
  bridgeStream() { return this.scenery?.stream }
  routeCache() { return this.scenery?.stats() ?? null }
  supportAt(x: number) { return this.scenery?.route.platformAt(x) ?? null }
  syncCutaway(x: number, y: number, dt: number): void { this.scenery?.updateCutaway(x, y, dt); }
  drawRouteExterior(ctx: CanvasRenderingContext2D, cam: BgCam, service?: ServiceTerminal, paint?: ShelterPaint): void {
    if (this.scenery) this.scenery.drawExterior(ctx, worldBounds(this.frontView, this.vw, this.vh, cam), service, paint);
  }
  routeTime(): number { return this.routeWeather?.clock.time ?? 0 }
  routeRainTime(): number { return this.routeWeather?.rainTime ?? 0 }
  routeWindAt(x: number): number { return this.routeWeather?.gustAt(x, this.reducedMotion) ?? 0 }
  routeDrift(): number { return this.activeFront?.driftX ?? 0 }
  routeFootfall(x: number, y: number, strength: number, vx: number, landing?: boolean): void { this.routeWeather?.footfall(x, y, strength, vx, landing) }
  bridgeLandings(out: Float32Array, left: number, right: number): number { return this.routeWeather?.bridgeLandings(out, left, right) ?? 0 }
  drawBridgeWater(ctx: CanvasRenderingContext2D, cam: BgCam, wet: number): void {
    if (!this.scenery || !this.routeWeather || wet < .005) return;
    const view = worldBounds(this.frontView, this.vw, this.vh, cam);
    if (view.bottom <= ROAD.rear || view.top >= ROAD.front) return;
    ctx.save();
    const open = this.routeWeather.clip(ctx, view.left - 2, view.right + 2, ROAD.rear, ROAD.front);
    if (open) this.scenery.drawRoadWater(ctx, view, wet, this.reducedMotion ? 0 : this.routeTime(), this.q !== 'low');
    ctx.restore();
  }

  drawNearRain(ctx: CanvasRenderingContext2D, cam: BgCam, master = false): void {
    this.routeWeather?.draw(ctx, worldBounds(this.frontView, this.vw, this.vh, cam), cam.x, this.q, true, this.reducedMotion, master);
  }
  clipWet(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number): void {
    if (this.routeWeather) this.routeWeather.clip(ctx, left, right, top, bottom);
    else { ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip(); }
  }

  /** Tier change is a DRAW BUDGET change, never a re-bake. Every tile is
   *  built from a fixed seed in resolution-independent layer space, so the
   *  art is identical at every tier — only how much of it we draw differs. */
  setQuality(q:Quality):void{
    this.q=q;
    // Tiers are DRAW budgets: the rig keeps its physics and loses cables.
    this.rig?.setTier(q);
  }

  /** Compute the same history-dependent profile as a synchronous reseed,
   * without touching the active sky, weather, or novelty history. */
  createNightForSeed(seed: number): NightLayer | null {
    if (this.station || this.scenery) return null;
    const s = seed >>> 0;
    if (s === this.runSeed && this.built) return null;
    const profile = s === this.runSeed && this.profile ? this.profile : makeProfile(s, this.activeFront ? [] : this.seedHistory);
    return new NightLayer(profile, !this.art.finish);
  }

  /** RE-SEED THE SKYLINE — the whole point of procedural generation: every
   *  run gets a different set of building archetypes, silhouettes, window
   *  personalities, bridges and neon. Baked once on the next draw. */
  setRunSeed(seed: number, preparedNight?: NightLayer): void {
    const s = seed >>> 0;
    if (s === this.runSeed && !preparedNight) {
      if (this.front) {
        if (this.profile) this.rig = new Rigging(this.profile, this.q);
        this.resetCanonicalFront(s);
      }
      return;
    }
    const changed = s !== this.runSeed;
    this.runSeed = s;
    if (changed && this.front) this.layout = composeBridgeRun(s);
    // The profile is the run's identity: mood, moon, stars, clouds, aurora,
    // fog, grade, practicals and prop density, all from one seed. `seedHistory`
    // keeps a new run from being a near-copy of the previous one.
    this.profile = preparedNight?.profile ?? makeProfile(s, this.activeFront ? [] : this.seedHistory);
    if (changed && !this.activeFront) this.seedHistory = [s, ...this.seedHistory].slice(0, 3);
    this.mood = artPalette(this.profile.mood, this.art.grade);   // coherent colour identity + per-run novelty
    // Release the old plates BEFORE building the new ones: two nights resident
    // at once is exactly the doubling the ledger exists to prevent.
    this.night?.dispose();
    this.night = this.station || this.scenery ? null : preparedNight ?? new NightLayer(this.profile, !this.art.finish);
    // The rigging is part of the settlement, not of the sky: it is rebuilt per
    // run because the span, sag and pennant count are run identity.
    this.rig = this.station || this.scenery ? null : new Rigging(this.profile, this.q);
    // Weather is a profile axis cluster: rarity, density and cadence of storms.
    this.storm.applyProfile?.(this.profile.weather);
    // The key light is derived from the profile ONCE per run, and every lit
    // thing in the frame (moon, shadows, rims, cable rim, glitter) reads it.
    this.light = this.keyLightForScene(this.profile)
    /* THE LIGHT FIELD, REBUILT PER RUN. The two practicals are the stage; the
     * rooftop props can add one more (a bulb on a stand), and because it is a
     * real source in the field, the player's proximity lighting, the deck pool
     * and the second cast shadow all follow it without knowing it exists.
     * Layout and light blockers stay fixed through live quality changes. */
    this.resetLighting()
    this.wxRainBase = Math.max(0.35, Math.min(1, this.profile.weather.rain));
    // THE FRONT — the run's weather is a climate, not a constant: inside a run
    // the sky is allowed to change its mind, slowly (world/weather.ts).
    const bias = this.profile.weather.stormBias;
    if (this.scenery) { this.storm.setRainScale(0); this.t = 0; }
    else if (this.front) this.resetCanonicalFront(s);
    else if (this.station) this.storm.setRainScale(0);
    else {
      if (this.wx) this.wx.reset(this.profile.seed, bias, this.profile.weather.rain);
      else this.wx = new WeatherFront(this.profile.seed, bias, this.profile.weather.rain);
      this.applyWeather();
    }
    this.vigFailed = false;       // retry an optional mask at the next run boundary
    this.surfaces.release('bridge-cloud-rim'); this.bridgeCloudRim = undefined;
    this.built=false;
    this.skyVault.invalidate();   // force one composite with the NEW skyline
  }

  private resetCanonicalFront(seed: number): void {
    if (this.front && this.layout) {
      this.front.reset(seed, this.layout.exposure);
      this.rig?.windState.setExternal(this.front.clock.sample.windX);
    }
    this.storm.setRainScale(0);
    this.t = 0;
    this.skyVault.invalidate();
  }

  dispose(): void {
    this.scenery?.dispose();
    this.routeVignette = undefined;
    this.skyVault.dispose();
    this.night?.dispose();
    this.surfaces.releaseAll();
    this.built = this.stageKitBuilt = false;
    this.dryRecess = undefined;
    this.shelters = {};
    this.fixtures = [];
    this.wetFixtures = [];
    this.reflBuf = null;
    this.pollPlate = null;
    this.vignette = null;
    this.vigFailed = false;
  }

  /** The current run identity, for the debug overlay and the bench. */
  getProfile(): EnvironmentProfile | null { return this.profile; }

  runLayout(): BridgeRunPlan | null { return this.layout; }

  /** Finish the seeded city synchronously; the UI path supplies a prepared
   * night so this no longer waits for WebGL readback. Standalone callers can
   * still bake the whole scene at once. */
  warm(): number {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.ensureBuilt()
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  }

  warmAttract(): void { this.ensureBuilt(true); }

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

  /** Push the front's current sample to rain, fog, wind and wet optics. */
  private applyWeather(): void {
    const wx = this.wx
    if (!wx) return
    const s = wx.sample
    this.storm.setRainScale(this.wxRainBase * s.rain)
    this.wxFog = s.fog
    this.wxWet = s.wet
    this.wxGust = s.gust
    this.rig?.windState.setGust(s.gust)
  }

  /** The key light, for anything that draws a lit edge (render/renderer.ts). */
  lightState(): KeyLight { return this.light; }

  private keyLightForScene(profile: EnvironmentProfile): KeyLight {
    return this.station ? { type: 'directional', azimuth: .28, elevation: .85, warmth: .32 } : keyLightFor(profile)
  }

  /** For the debug overlay / bench: what the sky is doing right now. */
  weatherState(): Readonly<FrontSample> | WeatherReadout | null {
    if (this.activeFront) return this.activeFront.sample;
    const wx = this.wx
    if (!wx) return null
    const s = wx.sample
    return { kind: s.kind, s: s.s, rain: s.rain, fog: s.fog, gust: s.gust, changes: wx.changes }
  }

  /** Screen x of the moon's centre — the only light direction the stage has.
   *  The contact shadows and the rim both key from it (see renderer.ground). */
  moonScreenX(): number { return this.moonX; }

  /** Advance the shared ambient clock; city light modulation is a continuous
   * function of this clock, not a new per-frame random sample. */
  update(dt: number): void {
    if (this.art.clean || this.activeFront) return;
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.t += d;
    // The front is driven by the real clock and by the storm's own flash: it
    // will not turn the weather over while the sky is already strobing.
    this.wx?.update(d, this.storm.intensity);
    this.applyWeather();
    // Rigging physics runs on the fixed sub-step inside SpringChain, so a slow
    // frame bows the cables the same distance a fast one does.
    this.rig?.update(d);
  }

  setReducedMotion(enabled: boolean): void {
    if (this.activeFront && enabled !== this.reducedMotion) this.skyVault.invalidate();
    this.reducedMotion = enabled;
  }
  useQuietEnemyFinish(): boolean { return this.art.grade === 'deep-noir' || Boolean(this.station) }
  bloomGain(): number { return this.art.grade ? .52 : 1 }
  usesBakedOptics(): boolean { return this.art.finish !== undefined }
  hasWetSurface(): boolean { return this.art.finish?.deck.surface !== 'dry-platform' }
  actorReflectionGain(): number { return this.art.amberSpecimen ? .58 : 1 }
  private lampTint(): string { return LIGHT_TINT[this.art.amberSpecimen ? 'warm' : 'cool'].join(',') }
  surfaceWetness(x: number): number {
    if (this.routeWeather) return this.routeWeather.wetnessAt(x);
    if (this.front) return this.front.wetnessAt(x);
    return this.hasWetSurface() ? Math.min(1.2, this.wxWet) * (0.33 + 0.67 * this.street.wetness(x, .65)) : 0;
  }

  lightningI():number{return this.routeWeather?.flash() ?? (this.activeFront ? 0 : this.storm.intensity)}
  lightningAz():number{return this.storm.azimuthValue}

  /* ------------------------ screen-space sky pass ------------------------ */

  private lastBridgeAtmosphere: BridgeAtmosphere | null = null;
  private readonly canvasAtmosphere = new BridgeAtmosphere();

  /** Same authored horizon on the complete Canvas route and sparse GL
   * world source. Train/rail are between the city and the live lane. */
  drawBridgeBackdrop(ctx: CanvasRenderingContext2D, cam: BgCam, atmo: BridgeAtmosphere, _impulse: number, sparse = true): void {
    this.setBridgeAtmosphere(cam, atmo);
    this.scenery?.drawBackdrop(ctx, this.vw, this.vh, cam, atmo, this.reducedMotion, sparse);
  }

  *drawBridgeBackdropSteps(ctx: CanvasRenderingContext2D, cam: BgCam, atmo: BridgeAtmosphere, sparse: boolean): Generator<void> {
    this.setBridgeAtmosphere(cam, atmo);
    if (this.scenery) yield* this.scenery.drawBackdropSteps(ctx, this.vw, this.vh, cam, atmo, this.reducedMotion, sparse, true);
  }

  private setBridgeAtmosphere(cam: BgCam, atmo: BridgeAtmosphere): void {
    this.lastCam = cam;
    this.moonX = atmo.moonX; this.moonY = atmo.moonY; this.moonCover = 1 - atmo.moonTransmission;
    this.lastBridgeAtmosphere = atmo;
  }

  titleAssets(): number {
    return +!!bridgeSkyBasis() | (+!!bridgePlate('l1') << 1) | (+!!bridgePlate('l2') << 2);
  }

  drawBridgeTitle(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.drawRouteSky(ctx, cam, 0, true);
  }

  *drawBridgeTitleSteps(ctx: CanvasRenderingContext2D, cam: BgCam): Generator<void> {
    if (!this.scenery) return;
    this.updateRouteSkyPose(cam, this.scenery.route);
    yield* this.scenery.drawTitleSteps(ctx, this.vw, this.vh, this.canvasAtmosphere, true);
  }

  private updateRouteSkyPose(cam: BgCam, route: BridgeRoute): void {
    const w = this.activeFront?.sample, t = this.reducedMotion ? 0 : this.routeTime();
    this.canvasAtmosphere.update(bridgeSkyBasis(), cam, this.vw, this.vh, this.runSeed, bridgeBiomeMix(cam.x, route.seed), {
      time: t, drift: this.reducedMotion ? 0 : this.routeDrift(), cover: w?.cloud ?? .47, haze: w?.fog ?? .27,
      flash: this.reducedMotion ? 0 : this.lightningI(),
    });
  }

  private drawRouteSky(ctx: CanvasRenderingContext2D, cam: BgCam, impulse: number, title = false): boolean {
    if (!this.scenery) return false;
    this.updateRouteSkyPose(cam, this.scenery.route);
    if (title) this.scenery.drawTitle(ctx, this.vw, this.vh, this.canvasAtmosphere);
    else this.drawBridgeBackdrop(ctx, cam, this.canvasAtmosphere, impulse, false);
    return true;
  }

  drawSky(outerCtx: CanvasRenderingContext2D, cam: BgCam, worldCam?: BgCam, tier?: BridgeGLTier, impulse = 0): void {
    if (this.drawRouteSky(outerCtx, cam, impulse)) return;
    this.ensureBuilt();
    this.lastCam = cam;
    // light-pollution glow plate (perf): vertical gradient, no-lightning case
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y;
    const cz = Number.isFinite(cam.zoom) ? cam.zoom : 1;
    const w = this.vw, h = this.vh, t = this.t;
    const live = this.activeFront;
    const mobile = this.scenery && tier === 'mobile';
    const A = mobile ? bridgePlate('stratum-a') : null, L1 = mobile ? bridgePlate('l1') : null, L2 = mobile ? bridgePlate('l2') : null;
    const bakedSky = !!(A && L1 && L2);
    if (this.lastBakedSky !== bakedSky) { this.skyVault.invalidate(); this.lastBakedSky = bakedSky; }
    const far = this.scenery ? RUN_FAR : LAY_FAR, mid = this.scenery ? RUN_MID : LAY_MID, near = this.scenery ? RUN_NEAR : LAY_NEAR;
    const wx = live?.sample;
    const windDrift = live && !this.reducedMotion ? -live.driftX * 12 : 0;
    const hy = h / 2 - cy * cz; // screen y of world y=0
    const baseOfSky = bakedSky ? mid : near;
    const nearY = h * .5 + (baseOfSky.lift - cy * baseOfSky.vf) * cz;
    const cover = worldCam && !this.scenery ? this.street.opaqueRows(w, h, worldCam) : null;
    // At nearY the district is solid across the screen. Include two extra
    // rows for interpolation at the parallax seam. Keep the cache itself
    // uncropped: it can outlive this particular camera/roll.
    const skyEnd = worldCam && this.art.finish ? Math.max(0, Math.min(h, Math.ceil(nearY) + 2)) : h;
    outerCtx.save();
    if (cover || skyEnd < h) clipVisibleRows(outerCtx, w, skyEnd, cover);

    // Publish the position only when repainting the sky plate. On a cache hit
    // the displayed moon did not move; rays and glitter must keep its centre.
    this.skyVault.draw(outerCtx, w, h, cx, cy, cz, t, 0, false, this.q, (ctx) => {
    if (this.station) {
      ctx.fillStyle = STATION_VOID;
      ctx.fillRect(0, 0, w, h);
      this.drawCityBand(ctx, LAY_DEEP, h, cx, cy, cz, this.deepTileBlur, DEEP_H);
      this.drawCityBand(ctx, far, h, cx, cy, cz, this.farTileBlur, FAR_H);
      return;
    }
    ctx.save();

    /* 1 — sky gradient anchored to the world ground line */
    const skyH = hy > 1 ? (hy < h ? hy : h) : 1;
    // Opaque backing: fractional horizon coordinates cannot expose a clear row.
    ctx.fillStyle = SKY_BELOW;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bakedSky ? A! : this.skyStrip, 0, 0, w, skyH);
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


    /* 1.5 — city glow is a vertical ramp. Identical columns need not live
     * in a viewport-wide backing store; resize just stretches this strip. */
    {
      if (!hasPixels(this.pollPlate) || this.pollMood !== this.mood) {
        const pc = this.surfaces.acquire('pollution', 8, 216, 'poll');
        const pg2 = pc.getContext('2d');
        if (pg2) {
          pg2.clearRect(0, 0, 8, 216);
          const lg = pg2.createLinearGradient(0, 0, 0, 216);
          lg.addColorStop(0, `rgba(${this.mood.shadow},0)`);
          lg.addColorStop(0.55, `rgba(${this.mood.shadow},0.09)`);
          lg.addColorStop(0.84, `rgba(${this.mood.pop},0.075)`);
          lg.addColorStop(1, `rgba(${this.mood.highlight},0.14)`);
          pg2.fillStyle = lg;
          pg2.fillRect(0, 0, 8, 216);
          this.pollPlate = pc;
        }
        this.pollMood = this.mood;
      }
      ctx.globalCompositeOperation = 'lighter';
      // The megapolis' glow is a profile axis: a bright-city run breathes more
      // light up into the cloud deck than a blackout run.
      const pollA = (this.profile ? this.profile.atmosphere.pollution : 1);
      ctx.globalAlpha = Math.min(1, pollA);
      if (hasPixels(this.pollPlate)) ctx.drawImage(this.pollPlate, 0, hy - 210, w, 216);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 2 — stars + moon (celestial parallax) */
    const starBase = hy - 70 > h * 0.25 ? hy - 70 : h * 0.25;
    const ms = mod(cx * 0.015 * cz, TILE);
    // The tile may be a half-resolution bake (GPU/CPU star field); blitRowScaled
    // handles both cases and is one drawImage per wrap either way.
    if (wx) ctx.globalAlpha = 1 - wx.cloud * .87;
    if (this.starTile.width === TILE) this.blitRow(ctx, this.starTile, ms, starBase - STAR_H);
    else this.blitRowScaled(ctx, this.starTile, ms, starBase - STAR_H, STAR_H);
    if (wx) ctx.globalAlpha = 1;
    /* 2.5 — DRIFTING CLOUD DECKS: three parallax sheets (high slow thin /
     * main bank / low fast wisps). While lightning scatters through them the
     * LIT twin re-blits additively on the lower two decks. Behind skyline. */
    if (!bakedSky) {
      const C = this.profile ? this.profile.clouds : null;
      const cfgCover = C ? C.coverage : 0.6;
      const cov = wx ? wx.cloud * .84 + cfgCover * .16 : cfgCover;
      const spd = C ? C.speed : 1;
      const alt = C ? C.altitude : 1;
      const cloudY = hy * 0.16 - 40 - (cy - NOMINAL_Y) * 0.06 * cz + (alt - 1) * 54;
      const offA = mod((live ? windDrift * .55 : -t * 3.2 * spd) - cx * 0.013 * cz, TILE);
      const offB = mod((live ? windDrift : -t * 5 * spd) - cx * 0.02 * cz, TILE);
      const offC = mod((live ? windDrift * 1.55 : -t * 8.4 * spd) - cx * (this.scenery ? .015 : .03) * cz, TILE);
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

    /* 2.55 — THE CUMULUS BANK: the only cloud surface with a silhouette.
     * One blit when the profile says the night has one; skipped entirely on a
     * clear run. Sits between the soft decks and the aurora, so the ribbons
     * pass behind the mass the way high aurora does. */
    // A canvas whose store was freed still exists as an object with width 0.
    // Checking the SIZE (not just the reference) is what stops that from
    // reaching drawImage; every cached plate blit in this file does the same.
    const bank = this.bank;
    if (!bakedSky && hasPixels(bank)) {
      const B = this.bankP;
      const oldDrift = -t * 1.6 * (this.profile ? this.profile.clouds.speed : 1) * this.wxGust;
      const bOff = mod((live ? windDrift * .38 : oldDrift) - cx * 0.026 * cz, TILE);
      const bY = hy - 210 + (B ? B.lift : 0);
      ctx.globalAlpha = wx ? .12 + wx.cloud * .62 : B ? B.opacity : 0.6;
      if (live) this.blitRowScaled(ctx, bank, bOff, bY, 210);
      else for (let bx = -bOff; bx < w; bx += TILE) ctx.drawImage(bank, bx, bY);
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
      const presence = live ? 0 : A ? A.presence : 1;
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
      const lunarTime = live && this.reducedMotion ? 0 : t;
      this.moonX = moonCentreX(this.light, w, cx * .03 * cz, lunarTime, drift);
      const moonX = this.moonX - half;
      const moonY = h * 0.13 - (cy - NOMINAL_Y) * 0.02 * cz - half + Math.cos(lunarTime * 0.014 * drift) * 16;
      this.moonY = moonY + half;
      // same rule as the contact shadows: the rims follow the moon, they do not
      // assume it is on the right because it usually is
      if (live) this.rig?.setRimSide(this.light.azimuth < 0 ? -1 : 1);
      else this.rig?.setRimSide(rimDirection(this.moonX, this.vw));
      const exposure = this.art.moonExposure;
      const transmit = wx ? .24 + .76 * wx.key : 1;
      ctx.globalAlpha = (exposure?.disc ?? 1) * transmit;
      ctx.drawImage(this.moonSpr, moonX, moonY, D, D);
      ctx.globalCompositeOperation = 'lighter';
      const haloD = MOON_HALO_D * sizeMul;
      ctx.globalAlpha = 0.82 * (exposure?.corona ?? 1) * (M ? Math.min(1.2, M.corona) : 1) * transmit;
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
      if (!live && k < 0.7) {
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

    /* 3 — DEEP + FAR skylines: pre-blurred plates with feathered bases. */
    if (bakedSky) this.drawCityBand(ctx, far, h, cx, cy, cz, L1!, FAR_H);
    else {
      this.drawCityBand(ctx, LAY_DEEP, h, cx, cy, cz, this.deepTileBlur, DEEP_H);
      this.drawBandAnims(ctx, 'deep', LAY_DEEP, h, cx, cy, cz, DEEP_H);
      this.drawCityBand(ctx, far, h, cx, cy, cz, this.farTileBlur, FAR_H);
      this.drawBandAnims(ctx, 'far', far, h, cx, cy, cz, FAR_H);
    }

    /* 3.5 — PARALLAX FOG PLANE: a procedural haze sheet at its own factor
     * (0.098 — between far and mid) drifting slowly with time, so the mist
     * moves WITH depth instead of sticking to the screen. */
    {
      const byF2 = h * 0.5 + (LAY_FAR.lift - cy * LAY_FAR.vf) * cz;
      const fpM = mod(cx * 0.098 * cz + (live ? windDrift * .60 : t * 2.4), 512);
      // Fog is a profile axis and it is the cheapest depth cue in the sky: a
      // heavy-fog run separates the four parallax bands without new geometry.
      const A2 = this.profile ? this.profile.atmosphere : null;
      const fogA = Math.min(1.4, (A2 ? A2.fog : 1) * (wx ? .56 + 1.12 * wx.fog : this.wxFog));
      const fogY = byF2 - 216 * (A2 ? A2.fogHeight : 1);
      ctx.globalAlpha = fogA;
      for (let fx = -fpM; fx < w; fx += 512) {
        ctx.drawImage(this.fogPlane, fx, fogY);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    });

    if (tier === 'master' && live && !this.reducedMotion) {
      const flash = this.lightningI();
      if (flash > .02) {
        if (!hasPixels(this.bridgeCloudRim)) {
          const c = this.surfaces.tryAcquire('bridge-cloud-rim', 512, 75, 'bridge-cloud-rim');
          const g = c?.getContext('2d');
          if (c && g) {
            g.setTransform(.25, 0, 0, .25, 0, 0);
            this.bridgeCloudRim = buildCloudTile(() => ({ c, g }), true, this.profile?.clouds.texture);
          }
        }
        if (hasPixels(this.bridgeCloudRim)) {
          const slide = mod(windDrift - cx * .020 * cz, TILE);
          outerCtx.save(); outerCtx.globalCompositeOperation = 'lighter'; outerCtx.globalAlpha *= flash * .62;
          this.blitRowScaled(outerCtx, this.bridgeCloudRim, slide, hy * .16 - 52, 300);
          outerCtx.restore();
        }
      }
    }
    // Keep the baked mid and near bands live. The slow sky cache can hold
    // clouds safely, but used to move nearer signs several pixels at once
    // and hold their intensity between cache refreshes.
    const ctx = outerCtx;
    ctx.save();
    this.drawCityBand(ctx, mid, h, cx, cy, cz, bakedSky ? L2! : this.midTileBlur, MID_H);
    if (!bakedSky) this.drawBandAnims(ctx, 'mid', mid, h, cx, cy, cz, MID_H);

    const air = this.art.airlight;
    if (!air && hasPixels(this.hazeSpr)) {
      ctx.globalAlpha = 0.65;
      ctx.drawImage(this.hazeSpr, 0, hy - 96, w, 150);
      ctx.globalAlpha = 1;
    }

    /* 5 — near towers (no DOF blur — the action plane stays crisp) */
    if (!bakedSky) this.drawCityBand(ctx, near, h, cx, cy, cz, this.nearTile, NEAR_H);
    ctx.restore(); // mid/near pass
    outerCtx.restore(); // sky end

    ctx.save();
    if (cover) clipVisibleRows(ctx, w, h, cover);
    this.street.drawDistrict(ctx, w, h, mod(cx * near.f * cz, TILE), nearY);
    if (!bakedSky) this.drawBandAnims(ctx, 'near', near, h, cx, cy, cz, NEAR_H);
    // Warm into the horizon; leave the upper towers and sky cool. The strip
    // follows the road projection, not the edge of the screen.
    if (air && hasPixels(this.hazeSpr)) {
      ctx.drawImage(this.hazeSpr, 0, hy - 225 * cz, w, 246 * cz);
    } else if (!this.art.finish) {
      const tint = this.art.clean ? 0 : this.wx?.sample.tint ?? 0;
      const opacity = tintAlpha(tint);
      if (opacity > 0) {
        ctx.globalAlpha = opacity;
        ctx.fillStyle = tintColour(tint);
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore();
  }


  private resetLighting(): void {
    if (this.scenery) return;
    this.roof = makeRoofProps(this.runSeed, { count: 22, x0: ARENA_X0 + 80, x1: ARENA_X1 - 80, deckY: 0,
      reserved: this.layout?.shelters })
    this.field = null
    this.deckAtlas = null
  }

  private lighting(): RibbonField {
    if (!this.field) {
      // A quality governor can drop optional passes, not move solid blockers
      // or switch off an emitter under a stationary actor.
      const props = this.roof.props, bulbs = this.roof.lights
      const lights = makeStageLights(this.profile, this.runSeed, this.art.amberSpecimen).concat(bulbs)
      if (this.layout) for (const roof of this.layout.shelters) lights.push(roof.source)
      const finish = this.art.finish
      if (finish) {
        const beacon = lights.find(light => light.id === 'stage:beacon')
        if (beacon) beacon.gain *= finish.beaconGain
      }
      const blocks = blockersFor(props)
      this.field = new RibbonField(this.station ? lights.filter(lamp => lamp.kind !== 'city') : lights, blocks, 10)
    }
    this.field.tick(this.t)
    return this.field
  }

  practicalLight(x: number): {warm:number;cool:number} {
    const {warm,cool} = this.lightAt(x)
    return {warm,cool}
  }
  lightAt(x:number, y=0, out=this.sample):Probe {
    return this.scenery?.lightAt(x, y, out) ?? this.lighting().sample(x,y,out)
  }

  /** Each real emitter keeps its own glint and a fixed share of the eight ray
   * taps. A second lamp entering the view cannot cancel the first one's light. */
  raySources(w: number, h: number, cam: BgCam): RaySource[] {
    const out: RaySource[] = []
    const co = Math.cos(cam.rot ?? 0), si = Math.sin(cam.rot ?? 0)
    const add = (x: number, y: number, gain: number, taps: number) => {
      const edge = Math.max(0, Math.min(1, (x + 40) / 100, (w + 40 - x) / 100, (y + 40) / 100, (h + 40 - y) / 100))
      const weight = Math.min(1, gain) * edge * edge * (3 - 2 * edge)
      if (weight > 0) out.push([x, y, weight, taps])
    }
    if (!this.station) add(this.moonX, this.moonY, 0.85, 2) // drawSky already projected it
    for (const { lamp, gain } of this.lighting().ribbons) {
      if (lamp.kind === 'city') continue
      const dx = lamp.x - cam.x, dy = lamp.y + ROAD.fixtureOffset - cam.y
      const x = w / 2 + (dx * co - dy * si) * cam.zoom
      const y = h / 2 + (dx * si + dy * co) * cam.zoom
      add(x, y, gain, lamp.kind === 'bulb' || lamp.id === 'stage:beacon' ? 1 : 2)
    }
    return out
  }

  /** How many sources the field has right now (debug overlay + tests). */
  lightCount(): number { if (this.scenery) return 0; return this.lighting().ribbons.length }

  /** AMBIENT MOTES — a handful of dust specks drifting through the practicals'
   *  cones. One path and one fill for the whole field (ultra only): it is the
   *  detail that says the air is real, and it is the cheapest possible way to
   *  sell a volumetric light. Positions are derived from the clock and the
   *  profile seed, never stored. */
  drawMotes(ctx: CanvasRenderingContext2D, t: number): void {
    const K = this.profile
    if (!K || this.station || this.activeFront) return
    const n = 22
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.16
    ctx.fillStyle = `rgb(${this.mood.highlight})`
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      // Two incommensurate rates per axis so no mote ever repeats its path.
      const ph = (i * 0.6180339887) % 1
      const src = i % 2 === 0 ? SIGN_X : LAMP_X
      const fall = 40 + ((i * 37) % 260)                       // px below the source
      const sway = Math.sin(t * (0.24 + ph * 0.5) + i * 1.7) * (16 + ph * 34)
      const rise = ((t * (6 + ph * 10) + i * 47) % 420)         // drifts down the cone
      const x = src + sway * (0.4 + fall / 300)
      const y = ROAD.fixtureOffset-fall - rise * 0.55
      const r = 0.7 + ph * 1.3
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.restore()
  }

  /** Bake every fixture's steady floor into the span once per run. A quality
   * step can drop a little modulation, not switch off a sign's pool. */
  private bakeRoadLighting(): void {
    const ribbons = this.lighting().ribbons;
    if (this.art.finish) {
      // No retained optical receiver or per-frame remainder on authored art.
      // Reuse one tiny transfer tile for every practical in this span bake.
      try {
        const { c, g } = this.practicalScratch.next(DECK_W, DECK_H, 'practical-work');
        const image = g.createImageData(DECK_W, DECK_H);
        this.street.bakeLighting(target => {
          for (const ribbon of ribbons) {
            const { left, lamp } = ribbon;
            ribbon.bakeDeck(image.data, 0, this.street.wetness, this.hasWetSurface());
            g.putImageData(image, 0, 0);
            target.globalAlpha = Math.min(1, lamp.gain * (1 - .5 * lamp.flicker));
            target.drawImage(c, left, ROAD.rear, 2 * lamp.radius, ROAD.front - ROAD.rear);
          }
        });
      } finally { this.practicalScratch.begin(); }
      return;
    }
    const { c: atlas, g } = this.makeCanvas(DECK_W, DECK_STRIDE * ribbons.length);
    const image = g.createImageData(atlas.width, atlas.height);
    const reflective = this.hasWetSurface();
    ribbons.forEach((r, i) => r.bakeDeck(image.data, (i * DECK_STRIDE + 1) * DECK_W * 4, this.street.wetness, reflective));
    g.putImageData(image, 0, 0);
    this.deckAtlas = atlas;
    this.deckAnimated = ribbons.map((_, i) => i)
      .filter(i => Math.min(1, ribbons[i].lamp.gain) > deckLightFloor(ribbons[i].lamp))
      .sort((i, j) => ribbons[j].lamp.flicker * ribbons[j].lamp.gain - ribbons[i].lamp.flicker * ribbons[i].lamp.gain);
    this.street.bakeLighting(target => {
      ribbons.forEach(({ left, lamp }, i) => {
        target.globalAlpha = deckLightFloor(lamp);
        target.drawImage(atlas, 0, i * DECK_STRIDE + 1, DECK_W, DECK_H, left, ROAD.rear, 2 * lamp.radius, ROAD.front - ROAD.rear);
      });
    });
  }

  /** Only the time-varying remainder needs live blits, in fixed source order. */
  drawLightPools(ctx: CanvasRenderingContext2D, cam=this.lastCam): void {
    const atlas = this.deckAtlas;
    const budget = Math.min(featuresFor(this.q).poolModulations, this.deckAnimated.length);
    if (budget <= 0 || !hasPixels(atlas)) return;
    const ribbons = this.lighting().ribbons;
    const roll = cam.rot ?? 0;
    const half = (this.vw * Math.abs(Math.cos(roll)) + this.vh * Math.abs(Math.sin(roll))) / (2 * cam.zoom);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let n = 0; n < budget; n++) {
      const i = this.deckAnimated[n], { left, lamp, gain } = ribbons[i];
      if (Math.abs(lamp.x - cam.x) > half + lamp.radius) continue;
      const alpha = Math.min(1, gain) - deckLightFloor(lamp);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.drawImage(atlas, 0, i * DECK_STRIDE + 1, DECK_W, DECK_H, left, ROAD.rear, 2 * lamp.radius, ROAD.front - ROAD.rear);
    }
    ctx.restore();
  }

  /** Mirror a fixed world-depth slice. A viewport edge can hide source pixels,
   * but must never stretch the remaining pixels to fill the receiver. */
  drawReflections(ctx: CanvasRenderingContext2D, cam: BgCam, quality: Quality, forward?: boolean): void {
    if (this.usesBakedOptics()) return;
    const F = featuresFor(quality);
    const capture = !forward && F.reflection > 0;
    if (!this.hasWetSurface() || typeof document === 'undefined' || (!capture && !F.glitter)) return;
    this.ensureBuilt();
    const w = this.vw, h = this.vh, zoom = cam.zoom, roll = cam.rot ?? 0;
    const deckY = h / 2 - cam.y * zoom;
    const bandH = ROAD.front * zoom;
    const co = Math.abs(Math.cos(roll)), si = Math.abs(Math.sin(roll));
    const halfH = (w * si + h * co) / 2;
    if (deckY + bandH <= h / 2 - halfH || deckY + ROAD.rear * zoom >= h / 2 + halfH) return;
    const roadL = w / 2 + (this.street.left - cam.x) * zoom;
    const roadW = (this.street.right - this.street.left) * zoom;
    const halfW = (w * co + h * si) / 2;
    if (roadL + roadW <= w / 2 - halfW || roadL >= w / 2 + halfW) return;

    // Stable overscan covers the inverse-rolled viewport, even in portrait.
    // One transform handles all angles and maps the actual backing store to CSS
    // pixels before unrolling, so there is no different sampler at roll=0.
    const srcH = bandH * 1.5;
    let mirror: HTMLCanvasElement | null = null;
    let captureW = 0, captureL = 0;
    if (capture && deckY > h / 2 - halfH && deckY - srcH < h / 2 + halfH) {
      captureW = Math.ceil(Math.hypot(w, h));
      captureL = (w - captureW) / 2;
      const bw = Math.max(24, Math.ceil(captureW / F.reflection));
      const bh = Math.max(6, Math.ceil(ROAD.front / F.reflection));
      if (!hasPixels(this.reflBuf) || this.reflBuf.width !== bw || this.reflBuf.height !== bh) {
        this.reflBuf = this.surfaces.acquire('reflection', bw, bh, 'refl');
      }
      const g = this.reflBuf.getContext('2d');
      if (g) {
        g.clearRect(0, 0, bw, bh);
        // Default bilinear resampling can miss a thin emitter entirely when
        // minifying by 3–8x (more at high DPR). Prefilter before masking.
        g.imageSmoothingQuality = 'medium';
        g.save();
        g.scale(bw / captureW, bh / srcH);
        g.translate(w / 2 - captureL, h / 2 - deckY + srcH);
        g.rotate(-roll);
        g.drawImage(ctx.canvas, -w / 2, -h / 2, w, h);
        g.restore();
        this.street.maskReflection(g, (roadL - captureL) * bw / captureW, roadW * bw / captureW, bh);
        mirror = this.reflBuf;
      }
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(roll);
    ctx.translate(-w / 2, -h / 2);
    ctx.beginPath();
    ctx.rect(roadL, deckY + ROAD.rear * zoom, roadW, bandH - ROAD.rear * zoom);
    ctx.clip();
    if (mirror) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // The divisor changes resolution, not the receiver's exposure.
      ctx.globalAlpha = .35 * this.actorReflectionGain() * Math.min(1.2, this.wxWet);
      ctx.translate(0, deckY);
      ctx.scale(1, -1);
      ctx.drawImage(mirror, captureL, -bandH, captureW, bandH);
      ctx.restore();
    }
    if (this.night && F.glitter) {
      const wet = Math.min(1.75, .85 * this.wxWet * reflectionGain(this.light));
      this.night.drawGlitter(ctx, this.moonX, deckY, w, zoom, wet, this.t);
    }
    ctx.restore();
  }

  /* ----------------------- world-space arena pass ------------------------ */

  *drawBridgeRoadSteps(ctx: CanvasRenderingContext2D, cam: BgCam, master: boolean, gpuRoad: boolean,
    provisional = false, deferStream = true, cold = true): Generator<void> {
    const scenery = this.scenery, weather = this.routeWeather;
    if (!scenery || !weather) return;
    const view = worldBounds(this.frontView, this.vw, this.vh, cam);
    weather.wake = this.lastBridgeAtmosphere?.wake ?? 0;
    scenery.drawCables(ctx, view, weather.clock.time, weather.wind, this.reducedMotion);
    if (cold) yield;
    if (cold) yield* scenery.drawSteps(ctx, view, cam.x, !gpuRoad, !gpuRoad && !provisional, !deferStream, true);
    else scenery.draw(ctx, view, cam.x, !gpuRoad, !gpuRoad && !provisional, !deferStream);
    scenery.drawMotion(ctx, view, weather.clock.time, this.reducedMotion);
    if (!gpuRoad && !this.reducedMotion && this.lastBridgeAtmosphere)
      scenery.drawStormEdges(ctx, view, cam, this.vw, this.lastBridgeAtmosphere);
    if (cold) yield;
    weather.draw(ctx, view, cam.x, this.q, false, this.reducedMotion, master);
  }

  drawArena(ctx: CanvasRenderingContext2D, forward=false, cam=this.lastCam, impulse=0, master=false, gpuRoad=master, provisional=false, deferStream=false): void {
    this.ensureBuilt();
    if (this.scenery && this.routeWeather) {
      finishPaint(this.drawBridgeRoadSteps(ctx, cam, master, gpuRoad, provisional, deferStream, false));
      return;
    }

    const roll = cam.rot ?? 0;
    const co = Math.abs(Math.cos(roll)), si = Math.abs(Math.sin(roll));
    const halfW = (this.vw * co + this.vh * si) / (2 * cam.zoom) + 32;
    const viewL = cam.x - halfW, viewR = cam.x + halfW;
    const halfH = (this.vw * si + this.vh * co) / (2 * cam.zoom);
    const authored = this.usesBakedOptics();
    const F = featuresFor(this.q)
    /* Grounded city bounce: world-anchored tiles behind the opaque bridge.
     * This is base lighting, not a light-pool or depth-of-field budget. */
    if (hasPixels(this.cityGlow)) {
      const glow = this.cityGlow
      const step = glow.width
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.85
      for (let gx = Math.floor(viewL / step) * step; gx < viewR; gx += step) {
        ctx.drawImage(glow, gx, ROAD.sidewalk - glow.height + 28)
      }
      ctx.restore()
    }
    this.street.drawRoad(ctx, viewL, viewR)
    if (!authored) this.drawLightPools(ctx, cam)
    if (!authored && F.wetGlints && this.hasWetSurface()) {
      if (cam.y + halfH >= ROAD.rear && cam.y - halfH <= ROAD.front) {
        this.street.drawWetGlints(ctx, viewL, viewR, F.wetGlints, this.wxWet,
          this.reducedMotion ? 0 : this.t)
      }
    }
    if (this.front) this.front.draw(ctx, worldBounds(this.frontView, this.vw, this.vh, cam), this.q, this.reducedMotion)
    else if (!this.art.clean) this.storm.drawSplashes(ctx, this.street.left, this.street.right, this.street.wetness)
    // Rear-sidewalk fixtures share a projected depth; simulation heights
    // remain true perpendicular distances above the asphalt.
    ctx.save();ctx.translate(0, ROAD.fixtureOffset)
    this.rig?.draw(ctx)
    const field=this.lighting()
    drawRoofProps(ctx, this.roof.props, viewL, viewR, F.roofFinish,
      field.ribbons.find(r=>r.lamp.kind==='bulb')?.gain ?? 0, rimDirection(this.moonX, this.vw))
    // The authored lens, air and body share a padded world sprite. Cull the
    // whole visible support, not the emitter centre (including camera roll).
    const y = cam.y - ROAD.fixtureOffset;
    for (const { sprite, x, y: top } of this.fixtures) {
      if (x + sprite.width >= viewL && x <= viewR && top + sprite.height >= y - halfH && top <= y + halfH) {
        ctx.drawImage(sprite, x, top);
      }
    }
    if (authored) {
      ctx.restore();
      this.drawShelters(ctx, viewL, viewR, cam.y - halfH, cam.y + halfH);
      return;
    }
    // Ungraded diagnostic scenes still exercise the dynamic optics stack.
    const [sign, lamp] = field.ribbons;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha=Math.min(.9,(this.art.amberSpecimen ? .38 : .7)*lamp.gain)
    ctx.drawImage(this.lampHalo,lamp.lamp.x-62,lamp.lamp.y-62,124,124)
    if (F.shaftLayers) {
      if (Math.abs(sign.lamp.x - cam.x) <= halfW + this.shaftWarm.width / 2) {
        drawShaft(ctx, this.shaftWarm, sign.lamp.x, sign.lamp.y + 14,
          Math.min(.4, .22 * sign.gain), F.shaftLayers);
      }
      const lampReach = this.shaftCool.width / 2 + this.shaftCool.height * Math.abs(FLOOD.aimX);
      if (Math.abs(lamp.lamp.x - cam.x) <= halfW + lampReach) {
        ctx.save();
        ctx.transform(1, 0, FLOOD.aimX, 1, lamp.lamp.x, lamp.lamp.y);
        drawShaft(ctx, this.shaftCool, 0, 0,
          Math.min(.75, (this.art.amberSpecimen ? .32 : .58) * lamp.gain), F.shaftLayers);
        ctx.restore();
      }
    }
    // Kept for ungraded/legacy diagnostic scenes only.
    if (forward && F.bloom) {
      if (Math.abs(SIGN_X - cam.x) <= halfW + 62) {
        ctx.globalAlpha = Math.min(.14, sign.gain * .10);
        ctx.drawImage(this.signHalo, SIGN_X - 62, SIGN_Y - 11, 124, 22);
      }
      if (Math.abs(LAMP_X - cam.x) <= halfW + 90) {
        ctx.globalAlpha = Math.min(.4, lamp.gain * .3);
        ctx.drawImage(this.lampHalo, LAMP_X - 90, LAMP_Y - 4, 180, 8);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore()
  }

  /** The matte insert is already in the span. Only the part above the
   * shoulder needs a live blit; it sits between the skyline and fighters. */
  private drawShelters(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number): void {
    if (!this.layout || top >= SHELTER_DECK_TOP) return;
    for (const zone of this.layout.shelters) {
      if (zone.right <= left || zone.left >= right) continue;
      const stamp = this.shelters[zone.kind];
      if (!stamp || stamp.y >= bottom) continue;
      const w = zone.right - zone.left, h = SHELTER_DECK_TOP - stamp.y;
      ctx.drawImage(stamp.sprite, 0, 0, w, h, zone.left, stamp.y, w, h);
    }
  }

  /* ---------------------- screen-space weather pass ---------------------- */

  drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam):void{
    if (this.scenery) {
      if (!hasPixels(this.routeVignette)) {
        const c = this.routeVignette = this.surfaces.acquire('route-vignette', 96, 96, 'route-vignette');
        const g = c.getContext('2d')!;
        const shade = g.createRadialGradient(48, 46, 24, 48, 46, 67);
        shade.addColorStop(0, 'rgba(5,6,8,0)'); shade.addColorStop(.55, 'rgba(5,6,8,.05)'); shade.addColorStop(1, 'rgba(5,6,8,.21)');
        g.fillStyle = shade; g.fillRect(0, 0, 96, 96);
      }
      ctx.drawImage(this.routeVignette!, 0, 0, this.vw, this.vh);
      return;
    }
    if (this.front) return; // diagnostic bridge uses a single rear field
    this.ensureBuilt();
    this.storm.setView(cam);
    if (!this.art.clean) {
      const lamp = this.art.sharpRain && this.art.amberSpecimen ? this.lighting().ribbons[1] : undefined;
      this.storm.drawRain(ctx, lamp && { x: lamp.lamp.x, y: lamp.lamp.y + ROAD.fixtureOffset, color: this.lampTint(), gain: lamp.gain });
    }
    // lightning flash — one tinted overlay instead of the bolt path art,
    // the glow blit and every gated deck effect
    const li = this.lightningI();
    if (!this.art.clean && !this.reducedMotion && li > 0.02) {
      ctx.fillStyle = 'rgba(178,206,244,1)';
      ctx.globalAlpha = Math.min(0.13, li * 0.13);
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
    // Authored depth/receiver grades already set the contrast. No darkening
    // pass over actors, wet highlights or the rest of the viewport.
    if (this.usesBakedOptics()) return;
    // Ungraded diagnostic vignette.
    const strength = this.profile?.grade.vignette ?? 1;
    if (this.vigW !== this.vw || this.vigH !== this.vh || this.vigStrength !== strength ||
        (!this.vigFailed && !hasPixels(this.vignette))) {
      this.refreshVignette(strength);
    }
    if (hasPixels(this.vignette)) ctx.drawImage(this.vignette, 0, 0);
  }

  /* --------------------------- private helpers --------------------------- */

  private refreshVignette(strength: number): void {
    const w = this.vw, h = this.vh;
    // This slot belongs to the viewport, not the seed's bake generation.
    // Same-size retries repaint if the recipe changed; resizing reuses the slot.
    this.vigW = w; this.vigH = h; this.vigStrength = strength;
    this.vigFailed = false;
    try {
      const plate = this.surfaces.acquire('vignette', Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)), 'vignette');
      const g = plate.getContext('2d');
      if (!g || g.isContextLost?.()) throw new Error('Vignette context unavailable');
      paintVignette(g, w, h, strength);
      this.vignette = plate;
    } catch (error) {
      this.surfaces.release('vignette');
      this.vignette = null;
      this.vigFailed = true; // retry on a viewport or recipe boundary, not every frame
      console.warn('Skipping cinematic vignette for this viewport:', error);
    }
  }

  private blitRow(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, m: number, y: number): void {
    for (let x = -m; x < this.vw; x += TILE) ctx.drawImage(img, x, y);
  }

  /** Same row blit for a reduced-resolution plate: drawn to full layer size. */
  private blitRowScaled(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement | HTMLImageElement, m: number, y: number, h: number): void {
    for (let x = -m; x < this.vw; x += TILE) ctx.drawImage(img, x, y, TILE, h);
  }

  private ensureBuilt(canvasSky = false): void {
    if (this.built) return;
    // Release only this background's old generation. Viewport slots survive
    // a reseed; another mounted scene keeps all of its own art.
    const hadStageKit = this.stageKitBuilt;
    this.bakes.begin();
    try {
      this.bakeScene(canvasSky);
      this.built = true;
    } catch (error) {
      this.bakes.begin();
      this.surfaces.release('front-bank');
      this.bank = null;
      this.bankP = null;
      if (!hadStageKit) {
        this.stageBakes.begin();
        this.stageKitBuilt = false;
        this.dryRecess = undefined;
        this.shelters = {};
        this.fixtures = [];
        this.wetFixtures = [];
      }
      this.night?.dispose();
      throw error;
    }
  }

  private warmRoute(): boolean {
    if (!this.scenery) return false;
    bridgeSkyBasis(); bridgePlate('l1'); bridgePlate('l2'); bridgePlate('metro-street');
    return true;
  }

  private bakeScene(canvasSky: boolean): void {
    // The profile exists before any plate is painted: every bake below reads
    // its axes, so a null here would silently bake the previous night.
    if (!this.profile) {
      this.profile = makeProfile(this.runSeed);
      this.light=this.keyLightForScene(this.profile)
      this.resetLighting()
      this.night?.dispose();
      if (!this.station && !this.scenery) this.night = new NightLayer(this.profile, !this.art.finish);
      this.mood = artPalette(this.profile.mood, this.art.grade);
      if (this.front) {
        this.rig = new Rigging(this.profile, this.q);
        this.rig.windState.setExternal(this.front.clock.sample.windX);
      }
    }
    this.bandAnims = { deep: [], far: [], mid: [], near: [] };
    if (this.warmRoute()) return;
    if (this.art.finish) this.ensureStageKit();
    if (this.station) {
      // Only the span and its run-dependent light/blocker transfer are new.
      this.bakeSection();
      return;
    }
    this.skyStrip = buildSkyStrip(this.makeCanvas, this.art.grade ? ART_GRADES[this.art.grade] : undefined);
    // MOON: the GPU/CPU baker owns it when a DOM exists (phase, tilt, tint and
    // procedural craters from the profile); the legacy plate is the last-resort
    // fallback so a headless import still produces a drawable sprite.
    this.night?.ensure(undefined, undefined, canvasSky);
    const bakedMoon = this.night?.moonPlate() ?? null;
    this.moonSpr = bakedMoon ?? buildMoon(this.makeCanvas, this.mood);
    this.moonHalo = buildMoonHalo(this.makeCanvas, this.mood);
    // Seeded city plates use these tinted discs in their material bakes.
    this.glowWarm = buildGlowDisc(this.makeCanvas, this.mood.highlight);
    this.glowCool = buildGlowDisc(this.makeCanvas, this.mood.pop2);
    this.heroDisc = buildGlowDisc(this.makeCanvas, this.mood.pop);
    if (!this.art.finish) this.cityGlow = buildCityGlow(this.makeCanvas, this.mood);
    if (!this.art.finish) this.bakePracticals(this.makeCanvas);
    // Rebuild-safe: a run reseed re-enters ensureBuilt, so reset the array
    // instead of appending a second set of discs forever.
    this.glowSigns.length = 0;
    for (const rgb of ['255,45,149','41,230,210','255,176,46','141,91,255','63,169,255',this.mood.pop,this.mood.pop2]) {
      this.glowSigns.push(buildGlowDisc(this.makeCanvas, rgb));
    }
    // Rebuild-safe: a run reseed re-enters ensureBuilt, so clear the
    // arrays instead of appending a second set of sprites/discs forever.
    this.glyphSpr.length = 0;
    for (let ci = 0; ci < 5; ci++) this.glyphSpr.push(buildGlyph(this.makeCanvas, ci));
    const profForBake = this.profile ?? makeProfile(this.runSeed);
    this.cloudDark = buildCloudTile(this.makeCanvas, false, profForBake.clouds.texture);
    this.fogPlane = buildFogPlane(this.makeCanvas);
    if (!this.activeFront) this.auroraTile = buildAuroraTile(this.makeCanvas, this.mood, profForBake.aurora.hue);
    // A clear night needs no bank. Keep the actual bank in this generation,
    // pinned for the run, but don't allocate a surface to discover it's absent.
    const bankProfile = this.activeFront ? { ...profForBake, clouds: { ...profForBake.clouds, coverage: .73 } } : profForBake;
    const params = bankParams(bankProfile);
    this.bank = null;
    this.bankP = null;
    if (params.present && typeof document !== 'undefined') {
      if (this.activeFront) {
        // Existing cloud decks still show the front if the optional sculpted
        // plate is denied. The smaller slot replaces, not stacks on, the bank.
        try {
          const c = this.surfaces.tryAcquire('front-bank', 1024, 120, 'environment-optional-bank');
          if (c) {
            const g = c.getContext('2d');
            if (!g || g.isContextLost?.()) throw new Error('Bank context unavailable');
            g.clearRect(0, 0, c.width, c.height);
            this.bank = buildCloudBank(bankProfile, c.width, c.height, c);
          }
        } catch {
          this.surfaces.release('front-bank');
        }
      } else {
        const { c } = this.bakes.next(TILE, 210, 'cloudbank');
        this.bank = buildCloudBank(profForBake, TILE, 210, c);
      }
      if (this.bank) this.bankP = params;
    }
    // STARS: density and warm/cool split come from the profile, so a clear run
    // and an overcast run are visibly different skies (not just different alpha).
    const bakedStars = this.night?.starPlate() ?? null;
    this.starTile = bakedStars && bakedStars.width >= 256
      ? bakedStars
      : this.buildStarTile();
    this.deepTileBlur = this.bakeSoftBand(DEEP_H, 3, 8, g => this.paintDeep(g));
    this.farTileBlur = this.bakeSoftBand(FAR_H, 2, 6, g => this.paintFar(g));
    this.midTileBlur = this.bakeSoftBand(MID_H, 1.1, 3, g => this.paintMid(g));
    this.nearTile = this.buildNear();
    for (const anims of Object.values(this.bandAnims)) orderBuildingAnims(anims, this.runSeed);
    this.bakeSection();
    if (!this.art.finish) this.hazeSpr = buildHazeStrip(this.makeCanvas, this.art.airlight);
  }

  private bakeSection(): void {
    this.street = new Viaduct(this.runSeed, ARENA_X0 - FLAT_LANE.artOverhang, ARENA_W + 2 * FLAT_LANE.artOverhang, this.mood, this.makeCanvas,
      this.art.grade ? ART_GRADES[this.art.grade].asphalt : undefined, this.art.finish?.deck, this.dryRecess, this.wetFixtures,
      this.layout?.exposure);
    this.bakeRoadLighting();
    if (this.layout) for (const zone of this.layout.shelters) {
      const stamp = this.shelters[zone.kind]!;
      this.street.bakeReceiver(zone.left, zone.right, SHELTER_DECK_TOP, stamp.sprite, SHELTER_DECK_TOP - stamp.y);
    }
  }

  /** Invariant art belongs to this mounted stage, not to every Retry seed. */
  private ensureStageKit(): void {
    if (this.stageKitBuilt) return;
    const make = this.makeStageCanvas;
    this.bakePracticals(make);
    if (this.layout) {
      try {
        const scratch: MakeCanvas = (w, h) => this.practicalScratch.next(w, h, 'practical-work');
        for (const kind of SHELTER_KINDS) this.shelters[kind] = bakeRunShelter(kind, make, scratch);
      } finally { this.practicalScratch.begin(); }
    }
    if (this.station) {
      const { depth, deck } = this.station;
      this.deepTileBlur = this.bakeSoftBand(DEEP_H, 3, 8, g => paintStationBand(g, TILE, DEEP_H, 'deep', depth.deep), make);
      this.farTileBlur = this.bakeSoftBand(FAR_H, 2, 6, g => paintStationBand(g, TILE, FAR_H, 'far', depth.far), make);
      this.midTileBlur = this.bakeSoftBand(MID_H, 1.1, 3, g => paintStationBand(g, TILE, MID_H, 'mid', depth.mid), make);
      const { c, g } = make(TILE, NEAR_H);
      paintStationBand(g, TILE, NEAR_H, 'near', depth.near);
      this.nearTile = c;
      this.dryRecess = Viaduct.bakeDryRecess(make, deck.district);
    }
    this.stageKitBuilt = true;
  }

  /** The same fixture origins drive baked bodies, light field and pools. */
  private bakePracticals(make: MakeCanvas): void {
    const warm = LIGHT_TINT.warm.join(','), lamp = this.lampTint();
    const finish = this.art.finish;
    const body = (factory: MakeCanvas): [PracticalStamp, PracticalStamp] => [
      { sprite: this.buildLampProp(factory), x: LAMP_X - 53, y: LAMP_Y - 30 },
      { sprite: this.buildTrafficSign(factory), x: SIGN_X - 72, y: SIGN_Y - 18 },
    ];
    const beacon = { sprite: this.buildBeacon(make), x: BEACON_X - 56, y: BEACON_Y - 42 };
    if (!finish) {
      this.lampHalo = buildGlowDisc(make, lamp);
      this.signHalo = buildGlowDisc(make, warm);
      this.shaftWarm = buildShaft(make, warm, 108, 148, -SIGN_Y - 14);
      this.shaftCool = buildShaft(make, lamp, 12, 2 * 250 * Math.tan(Math.acos(FLOOD.outerCos)), 250);
      this.fixtures = [beacon, ...body(make)];
      return;
    }
    try {
      const [head, sign] = body((w, h) => this.practicalScratch.next(w, h, 'practical-work'));
      // Sample only the small body art at build time. Air isn't reflected by
      // the asphalt and the gameplay canvas is never an optical source.
      if (finish.deck.surface === 'wet-asphalt') this.wetFixtures = [beacon, head, sign].map(({ sprite, x }) => ({
        left: x, image: sprite.getContext('2d')!.getImageData(0, 0, sprite.width, sprite.height),
      }));
      const { practicals } = finish;
      this.fixtures = [beacon,
        bakePractical(make, head, LAMP_X, LAMP_Y - 1, lamp, practicals.lamp),
        bakePractical(make, sign, SIGN_X, SIGN_Y - 2, warm, practicals.sign),
      ];
    } finally { this.practicalScratch.begin(); }
  }

  /* ------------------- city life (world/buildings.ts) -------------------- */

  /** Cap on collected records per band. The draw pass culls and budgets them;
   *  this only bounds the array so a 400-building tile cannot grow it. */
  private static readonly ANIM_CAP = 48

  /** Emit a building's animation records at bake time. Called from each band's
   *  builder with the building's TILE-LOCAL rect: the bake knows where the
   *  building is, and this is the only moment it is known. */
  private collectAnims(band: Band, tx: number, ty: number, w: number, h: number): void {
    const list = this.bandAnims[band]
    if (list.length >= CyberBackground.ANIM_CAP) return
    animsForBuilding(band, this.runSeed, { tx, ty, w, h }, list)
  }

  /** Draw one band's live records. The band's scroll and baseline are computed
   *  EXACTLY as `drawCityBand` computes them, from the same `LayerDef` — if the
   *  two ever disagreed, the live windows would slide off their baked ones. */
  private drawBandAnims(
    ctx: CanvasRenderingContext2D, band: Band, lay: LayerDef,
    h: number, cx: number, cy: number, cz: number, bandH: number,
  ): void {
    const F = featuresFor(this.q as Tier)
    if (F.buildingAnims <= 0) return
    const list = this.bandAnims[band]
    if (list.length === 0) return
    const by = h * 0.5 + (lay.lift - cy * lay.vf) * cz
    const m = mod(cx * lay.f * cz, TILE)
    drawBuildingAnims(ctx, list, this.t, m, by - bandH, TILE, 0, this.vw, F.buildingAnims)
  }

  private drawCityBand(
    ctx: CanvasRenderingContext2D,
    lay: LayerDef,
    h: number,
    cx: number,
    cy: number,
    cz: number,
    soft: HTMLCanvasElement | HTMLImageElement,
    bandH: number,
  ): void {
    const by = h * 0.5 + (lay.lift - cy * lay.vf) * cz;
    const m = mod(cx * lay.f * cz, TILE);
    // soft plate is stored at reduced resolution → scale it up here (GPU)
    const alpha = ctx.globalAlpha;
    if (this.routeWeather) {
      const fog = this.routeWeather.clock.sample.fog;
      ctx.globalAlpha *= atmosphereTransmission(Math.max(0, 1.15 - lay.f) * 3.1, .12 + fog * .20);
    }
    this.blitRowScaled(ctx, soft, m, by - bandH, bandH);
    ctx.globalAlpha = alpha;
  }

  /* ------------------------- layer tile builders ------------------------- */

  private bakeSoftBand(height: number, sigma: number, down: number, paint: (g: CanvasRenderingContext2D) => void,
    make: MakeCanvas = this.makeCanvas): HTMLCanvasElement {
    try {
      const source = this.cityScratch.next(TILE, height, 'city-scratch');
      paint(source.g);
      const wrapped = this.cityScratch.next(TILE, height, 'city-scratch');
      wrapped.g.filter = `blur(${sigma}px)`;
      // Neighbour copies supply the filter's edge pixels before downsampling.
      for (const x of [-TILE, 0, TILE]) wrapped.g.drawImage(source.c, x, 0);
      wrapped.g.filter = 'none';
      return blurTile(make, wrapped.c, down);
    } finally {
      // Only the small feathered output survives. No painter retains either
      // scratch canvas, including when baking a band fails halfway through.
      this.cityScratch.begin();
    }
  }

  private buildStarTile(): HTMLCanvasElement {
    const { c, g } = this.makeCanvas(TILE, STAR_H);
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
  private paintDeep(g: CanvasRenderingContext2D): void {
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
      // City life: a window, a beacon or a vent for this building (bake time is
      // the only time its rect is known — world/buildings.ts).
      this.collectAnims('deep', x, DEEP_H - bh, bw, bh);
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
    paintPlaneTone(g, TILE, DEEP_H, this.art.finish?.depth.deep ?? 'rgba(46,70,104,0.34)');
    bakeFilmGrade(g, TILE, DEEP_H, this.mood, 0.4, rng);
    g.globalCompositeOperation = 'source-over';
  }

  private paintFar(g: CanvasRenderingContext2D): void {
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
      this.collectAnims('far', x, FAR_H - bh, bw, bh);
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
    paintPlaneTone(g, TILE, FAR_H, this.art.finish?.depth.far ?? FOG.farLift);
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
  }

  private paintMid(g: CanvasRenderingContext2D): void {
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
      this.collectAnims('mid', x, MID_H - bh, bw, bh);
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
      const signGain = this.art.finish?.signGain ?? (this.art.grade === 'deep-noir' ? .56 : 1);
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
        g.globalAlpha = 0.6 * signGain;
        g.strokeStyle = SIGN_BORDER[ci];
        g.stroke();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.3 * signGain;
        g.drawImage(this.glyphSpr[ci], x0 + 5 - (sw - 10) * 0.38, y0 + 5 - (sh - 10) * 0.45, (sw - 10) * 1.76, (sh - 10) * 1.9);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.85 * signGain;
        g.drawImage(this.glyphSpr[ci], x0 + 5, y0 + 5, sw - 10, sh - 10);
        // NEON SPILL — the sign actually lights the wall around it. Baked
        // once with a color-matched radial disc; zero per-frame light cost.
        bakeSpill(g, this.glowSigns[ci], x0 + sw * 0.5, y0 + sh * 0.5, sw * 0.95, 0.42 * signGain);
        bakeSpill(g, this.glowSigns[ci], x0 + sw * 0.5, y0 + sh + 22, sw * 1.25, 0.16 * signGain);
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
    paintPlaneTone(g, TILE, MID_H, this.art.finish?.depth.mid ?? 'rgba(36,56,80,0.09)');
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
  }

  private buildNear(): HTMLCanvasElement {
    const { c, g } = this.makeCanvas(TILE, NEAR_H);
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
      this.collectAnims('near', x, NEAR_H - bh, bw, bh);
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
      // A few clearly different roof silhouettes, drawn without consuming the
      // skyline RNG so older seeds retain their building positions and scale.
      if (this.art.grade && bw > 190) {
        const crown = towers.length % 4, top = NEAR_H - bh;
        g.fillStyle = shade;
        if (crown === 0) {
          g.fillRect(x + bw * .18, top - 19, bw * .62, 19);
          g.fillRect(x + bw * .4, top - 36, bw * .33, 17);
        } else if (crown === 2) {
          g.fillRect(x + bw * .6, top - 23, bw * .21, 23);
          g.fillRect(x + bw * .69, top - 45, 2, 22);
        }
      }
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
    if (!this.art.finish) paintPlaneTone(g, TILE, NEAR_H, 'rgba(30,48,70,0.035)');
    // GLOBAL KEY WASH — strongest of the stack: the near plane carries the
    // clearest directional read (lit right faces, shadowed left + base)
    const keyN = g.createLinearGradient(TILE, 0, 0, NEAR_H);
    keyN.addColorStop(0, 'rgba(180,210,245,0.1)');
    keyN.addColorStop(0.5, 'rgba(180,210,245,0.025)');
    keyN.addColorStop(1, 'rgba(6,10,16,0.22)');
    g.fillStyle = keyN;
    g.fillRect(0, 0, TILE, NEAR_H);
    bakeFilmGrade(g, TILE, NEAR_H, this.mood, 0.85, rng, this.profile?.grade);
    g.globalCompositeOperation = 'source-over';
    // CHROMATIC EDGE FRINGE + rhythmic parapet strips (peak-shift outline
    // energy, grouping/repetition) — applied after the grade so the pops
    // stay saturated against the calm field.
    bakeChromaticEdges(g, towers, NEAR_H, this.mood, rng);
    const facade = (this.art.grade ? ART_GRADES[this.art.grade].facade : 1) * (this.art.finish?.facadeGain ?? 1);
    for(const [i,tower] of towers.entries()){
      lightFacade(g,tower.x,NEAR_H,tower.w,tower.h,i,facade)
    }
    {
      let nHero = towers[0];
      for (const t2 of towers) if (t2.h > nHero.h) nHero = t2;
      bakeIsolationHero(g, nHero.x, nHero.w, NEAR_H - nHero.h, NEAR_H, this.mood, this.heroDisc);
    }
    // Air sits in front of the facade lights too. Feather the windows toward
    // a quiet tonal mass near the deck, without drawing over the fighters.
    if (this.art.finish) {
      paintPlaneTone(g, TILE, NEAR_H, this.art.finish.depth.near);
      const air = this.art.airlight;
      if (air) {
        g.save(); g.globalCompositeOperation = 'source-atop';
        const haze = g.createLinearGradient(0, NEAR_H - 154, 0, NEAR_H);
        haze.addColorStop(0, rgba(air.color, 0));
        haze.addColorStop(.48, rgba(air.color, air.opacity * .22));
        haze.addColorStop(.84, rgba(air.color, air.opacity));
        haze.addColorStop(1, rgba(air.color, air.opacity * .88));
        g.fillStyle = haze; g.fillRect(0, NEAR_H - 154, TILE, 154);
        g.restore();
      }
    }
    return c;
  }

  /* ------------------------ arena tile (world 1:1) ----------------------- */

  /* ---------------------- foreground practical props -------------------- */

  /** Baked streetlight body and lens; its light on the road is baked from
   *  the same emitter used by the halo, cone and actor probes. */
  private buildBeacon(make: MakeCanvas): HTMLCanvasElement {
    const {c,g}=make(112,108), x=56,y=42
    g.fillStyle='#111724';g.fillRect(x-3,y,6,64);g.fillRect(x-10,y+60,20,5)
    g.fillStyle='#7547a8';g.fillRect(x+1,y+8,1,54)
    g.fillStyle='#182034';g.fillRect(x-10,y-6,20,17)
    const quiet = this.art.finish !== undefined;
    const halo=g.createRadialGradient(x,y,1,x,y,quiet ? 26 : 42)
    halo.addColorStop(0,quiet ? 'rgba(193,90,255,.47)' : 'rgba(193,90,255,.74)');halo.addColorStop(.25,quiet ? 'rgba(168,60,255,.17)' : 'rgba(168,60,255,.32)');halo.addColorStop(1,'rgba(156,52,255,0)')
    g.fillStyle=halo;g.fillRect(x-42,y-42,84,84)
    g.fillStyle='#edc6ff';g.fillRect(x-7,y-3,14,5);g.fillStyle='#ba7dea';g.fillRect(x-9,y+6,18,1)
    return c
  }
  private buildLampProp(make: MakeCanvas): HTMLCanvasElement {
    const { c, g } = make(96, 300);
    if (this.station) {
      const enamel = this.station.enamel;
      // Platform service column, bolted to the same sidewalk as the sign.
      // A parallax arch must not be the support for a world-space lamp.
      g.fillStyle = materialRamp(g, 87, 0, 74, 0, enamel);
      g.fillRect(74, 4, 13, 291);
      g.fillStyle = '#16252d'; g.fillRect(68, 289, 25, 6);
      g.fillRect(43, 13, 39, 7);
      g.fillStyle = '#778b8c'; g.fillRect(78, 10, 4, 2); g.fillRect(78, 32, 4, 2);
      g.fillStyle = materialRamp(g, 0, 15, 0, 31, enamel);
      g.beginPath();
      g.moveTo(19, 17); g.lineTo(83, 17); g.lineTo(75, 31); g.lineTo(29, 31);
      g.closePath(); g.fill();
      g.fillStyle = `rgba(${this.lampTint()},.86)`; g.fillRect(30, 27, 44, 4);
      g.fillStyle = '#fff0ce'; g.fillRect(33, 29, 38, 1.4);
      g.fillStyle = '#edb778'; g.fillRect(31, 31, 40, 1);
      return c;
    }
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
    const enamel = this.art.finish?.enamel;
    g.fillStyle = '#070c11';
    g.fillRect(53, 18, 30, 5);
    if (enamel) g.fillStyle = materialRamp(g, 0, 10, 0, 28, enamel);
    g.beginPath();
    g.moveTo(30, 10); g.lineTo(76, 10); g.lineTo(70, 28); g.lineTo(36, 28);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,198,232,0.22)';
    g.fillRect(30, 10, 46, 1.6);
    g.fillStyle = this.art.amberSpecimen ? `rgba(${this.lampTint()},.83)` : 'rgba(190,224,250,0.7)';              // lamp glass
    g.fillRect(38, 26, 30, 3);
    if (enamel) {
      g.fillStyle = '#da8c47'; g.fillRect(38, 28, 30, 2);
      g.fillStyle = '#fff2d3'; g.fillRect(40, 27, 26, 2);
      g.fillStyle = '#ffd187'; g.fillRect(41, 29, 24, 1);
    }
    g.fillStyle = `rgba(${enamel ? '105,150,168' : this.mood.pop2},0.55)`;
    g.fillRect(30, 10, 46, 1.4);
    if (enamel) {
      g.fillStyle = '#121c24'; g.fillRect(38, 22, 30, 3);
      g.fillStyle = '#77838a'; g.fillRect(39, 22, 2, 1); g.fillRect(65, 22, 2, 1);
      // A tight reflected edge and a dark mounting collar, on the same pole.
      g.fillRect(48, 83, 1, 135);
    }

    // warning band + base collar (baked contact AO)
    g.fillStyle = 'rgba(214,158,52,0.5)';
    g.fillRect(41, 262, 15, 3);
    g.fillRect(41, 270, 15, 3);
    g.fillStyle = enamel ? materialRamp(g, 0, 292, 0, 300, enamel) : '#05090d';
    g.fillRect(36, 292, 24, 8);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath(); g.ellipse(48, 299, 20, 4, 0, 0, TAU); g.fill();
    return c;
  }

  /** Open under the display: only the two posts meet the rear sidewalk. */
  private buildTrafficSign(make: MakeCanvas): HTMLCanvasElement {
    const {c,g}=make(144,18-SIGN_Y),cx=72
    for(const x of [cx-43,cx+43]) {
      g.fillStyle='#202b35';g.fillRect(x-2,20,5,c.height-20)
      g.fillStyle='#70808d';g.fillRect(x-2,20,1,c.height-20)
      g.fillStyle='#35424c';g.fillRect(x-6,c.height-3,13,3)
    }
    const enamel = this.art.finish?.enamel
    g.fillStyle=enamel ? materialRamp(g, 0, 1, 0, 35, enamel) : '#27343f';g.fillRect(12,1,120,34)
    g.fillStyle='#7d8991';g.fillRect(12,1,120,1)
    g.fillStyle='#161a1e';g.fillRect(16,4,112,28)
    if (enamel) {
      g.fillStyle = '#0b1015'; g.fillRect(16, 30, 112, 2)
      g.fillStyle = 'rgba(174,196,207,.16)'; g.fillRect(17, 5, 110, 1)
      g.fillStyle = '#8a9397'
      for (const x of [14, 129]) for (const y of [5, 29]) g.fillRect(x, y, 1.2, 1.2)
      g.fillStyle = '#080d12'
      for (const x of [cx - 43, cx + 43]) g.fillRect(x - 8, c.height - 2, 17, 2)
    }
    if (enamel) {
      const litGlass = g.createLinearGradient(0, 5, 0, 31);
      litGlass.addColorStop(0, 'rgba(230,157,80,.18)');
      litGlass.addColorStop(.45, 'rgba(203,118,47,.075)');
      litGlass.addColorStop(1, 'rgba(203,118,47,0)');
      g.fillStyle = litGlass; g.fillRect(17, 6, 110, 24);
      g.fillStyle = '#b37b43';
      for (const x of [23, 119]) g.fillRect(x, 12, 2, 4);
      g.fillStyle = '#563823'; g.fillRect(22, 30, 100, 1);
    }
    g.fillStyle=this.station ? '#ffedcc' : enamel ? '#ffe0a4' : '#dd9b4f';g.font='bold 14px monospace';g.textAlign='center'
    g.fillText(this.station ? 'NIGHT LINE' : 'WET ROAD',cx,18)
    g.fillStyle='#ae8050';g.font='bold 8px monospace';g.fillText(this.station ? 'PLATFORM  02' : 'SLOW   /   40',cx,28)
    if (this.station) {
      g.fillStyle = '#825734'; g.fillRect(37, 32, 70, 3);
      g.fillStyle = '#eab276'; g.fillRect(40, 34, 64, 1);
    }
    return c
  }
}

export default CyberBackground;
