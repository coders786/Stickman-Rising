import { BASE_FRAG, EMISSION_FRAG, FULLSCREEN, GRADE_FRAG, GRADE_VERT, MOBILE_ACTORS_FRAG, MOBILE_BASE_FRAG,
  MOBILE_GRADE_FRAG, SKY_CACHE_MASTER, SKY_CACHE_MOBILE, RECEIVER_FRAG, RECEIVER_VERT, TRAIL_FRAG, TRAIL_VERT, WEATHER_FRAG, WEATHER_VERT } from './bridge-shaders'
import { ACTOR_PROTOTYPE_FRAG, ACTOR_PROTOTYPE_VERT } from './bridge-actor-prototype-shaders'
import { BLOOM_FILTER } from './bridge-bloom'
import { SACR_MOBILE_FRAG, SACR_MOBILE_RESOLVE_FRAG, SACR_ROAD_FRAG } from '../graphics/sacr/SACRShaders'

/** Single source of truth for runtime, offline GLSL validation, and browser
 * probes. These strings are already assembled, including shared snippets. */
export const BRIDGE_PROGRAMS = {
  masterSky: [FULLSCREEN, SKY_CACHE_MASTER],
  mobileSky: [FULLSCREEN, SKY_CACHE_MOBILE],
  masterBase: [FULLSCREEN, BASE_FRAG],
  mobileBase: [FULLSCREEN, MOBILE_BASE_FRAG],
  receiver: [RECEIVER_VERT, RECEIVER_FRAG],
  masterRoad: [FULLSCREEN, SACR_ROAD_FRAG],
  mobileRoad: [FULLSCREEN, SACR_MOBILE_FRAG],
  mobileResolve: [FULLSCREEN, SACR_MOBILE_RESOLVE_FRAG],
  masterActors: [FULLSCREEN, EMISSION_FRAG],
  mobileActors: [FULLSCREEN, MOBILE_ACTORS_FRAG],
  trail: [TRAIL_VERT, TRAIL_FRAG],
  actorPrototype: [ACTOR_PROTOTYPE_VERT, ACTOR_PROTOTYPE_FRAG],
  weather: [WEATHER_VERT, WEATHER_FRAG],
  bloom: [FULLSCREEN, BLOOM_FILTER],
  masterGrade: [GRADE_VERT, GRADE_FRAG],
  mobileGrade: [GRADE_VERT, MOBILE_GRADE_FRAG],
} as const
