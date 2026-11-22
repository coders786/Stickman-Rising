import { clamp01, smoothstep } from '../core/utils'
import { WET_ROUGHNESS } from './bridge-material'

// Moisture is a film on exposed aggregate; depression depth determines
// where there's enough water for a section reflection. A roof kills both.
// Shared by the Master road, Optimized trace/resolve, and Canvas wash.
const TRACE = [.10, .91] as const
const POOL = [.14, .77] as const
const FILM_LOSS = .32, POOL_LOSS = .19
const DRY_COVER = .85, DAMP_ROUGHNESS = .43, DAMP_BLEND = .65

const ramp = (edges: readonly [number, number], v: number) => smoothstep((v - edges[0]) / (edges[1] - edges[0]))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const diffuse = (film: number, pool: number) => 1 - FILM_LOSS * film - POOL_LOSS * pool
export function bridgeRoadWater(moisture: number, basin: number, stone: number, covered: boolean) {
  const film = covered ? 0 : clamp01(moisture)
  const traceWet = film * ramp(TRACE, basin), pool = ramp(POOL, traceWet)
  const rough = mix(mix(covered ? DRY_COVER : stone, DAMP_ROUGHNESS, DAMP_BLEND * film), WET_ROUGHNESS, pool)
  return { film, traceWet, pool, rough, diffuse: diffuse(film, pool) }
}

// Approximate linear diffuse absorption on the already display-encoded
// Canvas plate. The compact basin path stands in for the smooth GL field.
export function bridgeCanvasRoadAbsorption(wet: number) {
  const film = diffuse(clamp01(wet), 0)
  const inBasin = bridgeRoadWater(wet, .72, .58, false).diffuse
  return { film: 1 - Math.sqrt(film), pool: 1 - Math.sqrt(inBasin / film) }
}

export const ROAD_WATER_GLSL = `
struct RoadWater { float film; float traceWet; float pool; float rough; };
RoadWater roadWater(float moisture,float basin,float stone,bool covered){
  float film=covered?0.:clamp(moisture,0.,1.);
  float traceWet=film*smoothstep(${TRACE[0]},${TRACE[1]},basin);
  float pool=smoothstep(${POOL[0]},${POOL[1]},traceWet);
  float substrate=mix(covered?${DRY_COVER}:stone,${DAMP_ROUGHNESS},${DAMP_BLEND}*film);
  return RoadWater(film,traceWet,pool,mix(substrate,${WET_ROUGHNESS},pool));
}
float roadDiffuse(RoadWater w){return 1.-${FILM_LOSS}*w.film-${POOL_LOSS}*w.pool;}
// The thin film gives a broad grazing sheen. Deep pools exchange that
// sheen for SACR's section-aware trace, not an additional stripe layer.
vec3 roadFilmLight(RoadWater w,float ao,float sky,vec3 practical,float grazing){
  return (w.film*(1.-.76*w.pool)*ao)*(practical*(.024+.078*grazing)
    +uHazeColor*sky*(.017+.069*grazing));
}
`
