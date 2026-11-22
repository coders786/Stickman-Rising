import type { DeckFinish, MaterialFace, PlaneTone, PracticalOptics } from '../stage/baked-finish'
import type { Band } from './buildings'
import type { MoodPalette } from './mood'

/** Bake-time art directions. Values don't touch HUD or combat cue colors. */
export const ART_GRADES = {
  'cold-steel': {
    palette: { name: 'COLD STEEL', shadow: '36,62,83', highlight: '235,174,109', pop: '82,166,198', pop2: '113,169,184', sky: '67,102,131' },
    sky: ['#091420', '#203747', '#3b5061'], asphalt: [0.75, 0.92, 1.13], cloth: '#192734', facade: 0.48,
  },
  'deep-noir': {
    palette: { name: 'DEEP NOIR', shadow: '30,43,61', highlight: '255,169,92', pop: '178,105,80', pop2: '83,133,146', sky: '43,53,77' },
    sky: ['#070d18', '#17263a', '#354252'], asphalt: [0.79, 0.885, 1.018], cloth: '#1b232d', facade: 0.32,
  },
  'station-noir': {
    palette: { name: 'NIGHT STATION', shadow: '23,40,49', highlight: '222,180,120', pop: '136,110,71', pop2: '95,160,158', sky: '39,70,75' },
    sky: ['#141d27', '#263b43', '#364a50'], asphalt: [0.85, 0.91, 1.01], cloth: '#20282c', facade: 0.32,
  },
  'neon-night': {
    palette: { name: 'NEON NIGHT', shadow: '43,38,79', highlight: '243,156,128', pop: '247,54,157', pop2: '43,225,229', sky: '94,42,133' },
    sky: ['#110b23', '#272341', '#4b3558'], asphalt: [0.89, 0.89, 1.10], cloth: '#222339', facade: 0.71,
  },
} as const
export type ArtGrade = keyof typeof ART_GRADES

/** Author these into the existing plates, not a tier or an extra pass. */
export interface SceneFinish {
  readonly depth: Readonly<Record<Band, PlaneTone>>
  readonly deck: DeckFinish
  readonly enamel: MaterialFace
  readonly practicals: Readonly<{ lamp: PracticalOptics; sign: PracticalOptics }>
  readonly beaconGain: number
  /** Secondary architecture never gets as loud as the play-plane cues. */
  readonly facadeGain: number
  readonly signGain: number
}

export interface SceneArtOptions {
  grade?: ArtGrade
  clean?: boolean
  /** Interior art recipe; shares the flat contact plane and fixture anchors. */
  architecture?: 'station'
  amberSpecimen?: boolean
  sharpRain?: boolean
  finish?: SceneFinish
  /** Existing sky plates can sit lower in the exposure without changing the key light. */
  moonExposure?: Readonly<{ disc: number; corona: number }>
  /** Hue of the air between the city and the play plane. */
  airlight?: Readonly<{ color: string; opacity: number }>
}
export function artPalette(base: MoodPalette, grade?: ArtGrade): MoodPalette {
  return grade ? ART_GRADES[grade].palette : base
}

/** Art is a scene choice, not a quality-tier choice. A governor shed must
 * never rebake the skyline or change the color of a gameplay cue. */
const BRIDGE_FINISH: SceneFinish = {
  depth: {
    deep: { air: '51,68,96', crown: .55, base: .62 },
    far: { air: '37,59,81', crown: .38, base: .54 },
    mid: { air: '26,43,60', crown: .19, base: .66, fadeFrom: .32 },
    near: { air: '26,43,60', crown: .09, base: .71, fadeFrom: .24 },
  },
  deck: {
    metal: { light: '#8aa9b8', body: '#304253', shade: '#101c29', falloff: .20 },
    masonry: { light: '#4b5861', body: '#303e49', shade: '#1e2834', falloff: .72 },
    surface: 'wet-asphalt',
    district: { air: '17,26,43', crown: .42, base: .56, fadeFrom: .22 },
  },
  enamel: { light: '#79858b', body: '#37444d', shade: '#141b22', falloff: .19 },
  practicals: {
    lamp: { spreadX: 77, spreadY: 59, glassX: 44, glassY: 18, core: .91, skirt: .39,
      beam: { length: 192, mouth: 16, end: 61, aim: .26, gain: .44 } },
    sign: { spreadX: 87, spreadY: 40, glassX: 64, glassY: 21, core: .66, skirt: .30,
      beam: { length: 58, mouth: 47, end: 59, aim: 0, gain: .22 } },
  },
  beaconGain: .69,
  facadeGain: .49,
  signGain: .29,
}

export const BRIDGE_ART: Readonly<SceneArtOptions> = Object.freeze({
  grade: 'deep-noir', amberSpecimen: true, sharpRain: true, finish: BRIDGE_FINISH,
  moonExposure: { disc: .62, corona: .56 },
  airlight: { color: '#e5a06d', opacity: .28 },
})

/** Matte receiver material shared by run shelters and the isolated art proof. */
export const DRY_PLATFORM: Extract<DeckFinish, { surface: 'dry-platform' }> = {
  surface: 'dry-platform',
  district: { air: '19,32,41', crown: .46, base: .28, fadeFrom: .23 },
  metal: { light: '#82949a', body: '#3e4b54', shade: '#1c282e', falloff: .19 },
  masonry: { light: '#526268', body: '#3c4b4f', shade: '#1c2b33', falloff: .75 },
  tile: { light: '#69776e', body: '#455853', shade: '#293c42', falloff: .54 },
}

/** Isolated art proof for diagnostics, not an application route. */
export const STATION_ART: Readonly<SceneArtOptions> = Object.freeze<SceneArtOptions>({
  grade: 'station-noir', architecture: 'station', clean: true, amberSpecimen: true,
  finish: {
    depth: {
      deep: { air: '26,44,52', crown: .22, base: .31 },
      far: { air: '34,52,60', crown: .40, base: .45 },
      mid: { air: '36,55,60', crown: .19, base: .48 },
      near: { air: '29,49,54', crown: .06, base: .43 },
    },
    deck: DRY_PLATFORM,
    enamel: { light: '#899b9b', body: '#364d51', shade: '#19262b', falloff: .22 },
    practicals: {
      lamp: { spreadX: 79, spreadY: 52, glassX: 46, glassY: 14, core: .80, skirt: .28,
        beam: { length: 169, mouth: 20, end: 50, aim: .26, gain: .26 } },
      sign: { spreadX: 84, spreadY: 43, glassX: 62, glassY: 21, core: .59, skirt: .27,
        beam: { length: 54, mouth: 46, end: 55, aim: 0, gain: .17 } },
    },
    beaconGain: .46,
    facadeGain: 0,
    signGain: 0,
  },
})
