import type { MoodPalette } from './mood'

/** Bake-time art directions. Values don't touch HUD or combat cue colors. */
export const ART_GRADES = {
  'cold-steel': {
    palette: { name: 'COLD STEEL', shadow: '36,62,83', highlight: '235,174,109', pop: '82,166,198', pop2: '113,169,184', sky: '67,102,131' },
    sky: ['#091420', '#203747', '#3b5061'], asphalt: [0.75, 0.92, 1.13], cloth: '#192734', facade: 0.48,
  },
  'deep-noir': {
    palette: { name: 'DEEP NOIR', shadow: '30,43,61', highlight: '255,169,92', pop: '178,105,80', pop2: '83,133,146', sky: '43,53,77' },
    sky: ['#080d17', '#182437', '#353b46'], asphalt: [0.85, 0.91, 1.01], cloth: '#1b232d', facade: 0.32,
  },
  'neon-night': {
    palette: { name: 'NEON NIGHT', shadow: '43,38,79', highlight: '243,156,128', pop: '247,54,157', pop2: '43,225,229', sky: '94,42,133' },
    sky: ['#110b23', '#272341', '#4b3558'], asphalt: [0.89, 0.89, 1.10], cloth: '#222339', facade: 0.71,
  },
} as const
export type ArtGrade = keyof typeof ART_GRADES
export interface SceneArtOptions { grade?: ArtGrade; clean?: boolean; amberSpecimen?: boolean; sharpRain?: boolean }
export function artPalette(base: MoodPalette, grade?: ArtGrade): MoodPalette {
  return grade ? ART_GRADES[grade].palette : base
}

/** Art is a scene choice, not a quality-tier choice. A governor shed must
 * never rebake the skyline or change the color of a gameplay cue. */
export const BRIDGE_ART: Readonly<SceneArtOptions> = Object.freeze({
  grade: 'deep-noir', amberSpecimen: true, sharpRain: true,
})
