/**
 * MOUNTAIN-GL — TypeScript port of mountain.html's graphics systems.
 *
 * The reference scene ("Shirogane Horizon") renders its physically based
 * layers in GLSL: a SAT-style occluder shadow pass (SH_DIRECTIONAL /
 * SH_POINT), a light-quad transport (SH_LIGHT_QUAD) and a wet-floor water
 * pass (WATER_FS). This module ports those systems — the exact falloff
 * law, the exact light-space occluder interval test, the exact wave
 * trains — into the game as the MANDATORY deck compositor.
 *
 * The deck's baked plate (planks/AO/lip — the composition's own bake)
 * is uploaded as a texture; everything that must move (light, shadow,
 * waves) evaluates per pixel here, every frame, per the bake law in
 * render/rules.ts.
 */

/* ------------------------------------------------------------------ */
/* shaders                                                             */
/* ------------------------------------------------------------------ */

/** fullscreen quad (normalized 0..1 corners); vScreen = device px */
export const DECK_VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uRes;
out vec2 vScreen;
void main() {
  vScreen = aPos * uRes;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}
`

/**
 * DECK FRAG — the fused deck compositor.
 *  · base fill + baked deck plate (the planks/AO/lip) in the line frame
 *  · puddle reflections masked by the wet plate, displaced by WATER_FS's
 *    wave trains (sin trains scaled to world units)
 *  · SH_LIGHT_QUAD transport: intensity·(1−d/range)^2 point pools + the
 *    key's depth gradient
 *  · SH_DIRECTIONAL occluder shadows: the light-space interval test
 *    (the reference's exact geometry) darkens the key's contribution
 */
export const DECK_FRAG = `#version 300 es
precision highp float;
in vec2 vScreen;
out vec4 outColor;

uniform vec2 uCenter;      // device px (screen anchor of cam)
uniform float uZoom;       // device-px zoom
uniform float uCos, uSin;  // cam rotation
uniform vec2 uCam;         // world cam pos (renderer frame)
uniform float uLineY;      // world y of the contact line (renderer frame)
uniform sampler2D uDeck;   // baked deck plate (row0 = the line)
uniform sampler2D uRefl;   // structure reflection plate
uniform sampler2D uWet;    // wet roughness plate (row0 = line+8)
uniform vec4 uDeckRect;    // originX, originY(line frame), w, h
uniform float uReflRect;   // reflection plate height (line frame)
uniform float uWetTop;     // line-frame y of the wet plate's row0
uniform float uTime;
uniform vec4 uDoor;        // xy world(line frame), z range, w intensity
uniform vec3 uDoorCol;
uniform vec4 uStreet;
uniform vec3 uStreetCol;
uniform vec3 uKeyDir;      // toward the light: (x, depth, height)
uniform float uKeyI;
uniform vec3 uKeyCol;
uniform int uOccN;
uniform vec4 uOcc[40];     // cx, cy, hw, hh (line frame)
uniform float uOccZ[40];   // caster height

vec2 toWorld(vec2 s) {
  vec2 d = s - uCenter;
  return vec2(d.x * uCos + d.y * uSin, -d.x * uSin + d.y * uCos) / uZoom + uCam;
}

/* SH_DIRECTIONAL occluder test — the reference's light-space interval
 * walk: the ray from the deck point toward the light must pass through
 * the box footprint [c±r] while below the caster's height. */
float keyOccluded(vec2 p, vec4 box, float top) {
  vec2 l = uKeyDir.xy;                 // horizontal (x, depth) walk
  float lz = max(uKeyDir.z, 1e-4);     // height component (cot(elev) emerges)
  float t0 = 0.0;
  float t1 = top / lz;
  if (abs(l.x) > 1e-5) {
    float a = (box.x - box.z - p.x) / l.x;
    float b = (box.x + box.z - p.x) / l.x;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  } else if (abs(p.x - box.x) > box.z) return 0.0;
  if (abs(l.y) > 1e-5) {
    float a = (box.y - box.w - p.y) / l.y;
    float b = (box.y + box.w - p.y) / l.y;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  } else if (abs(p.y - box.y) > box.w) return 0.0;
  return t1 > t0 ? 1.0 : 0.0;
}

/* SH_LIGHT_QUAD falloff — intensity·(1−d/range)^2 (rules.light) */
float falloff(vec2 p, vec4 L) {
  float d = length(p - L.xy) / max(L.z, 1.0);
  float f = 1.0 - clamp(d, 0.0, 1.0);
  return L.w * f * f;
}

/* WATER_FS wave trains (rules.water): displacement grows downstage */
float waveX(float wy) {
  float t = uTime;
  return (sin(wy * 0.148 + t * 1.9)
        + sin(wy * 0.205 - t * 2.6) * 0.7
        + sin(wy * 0.511 - t * 1.1) * 0.4) * (1.0 + wy * 0.05);
}

void main() {
  vec2 w = toWorld(vScreen);
  float wy = w.y - uLineY;              // line frame: 0 = the contact line
  if (wy < -1.0) { outColor = vec4(0.0); return; }  // sky: the 2D pass owns it

  /* --- deck plate (baked planks/AO/lip); clamped past the plate end --- */
  vec3 col = vec3(0.051, 0.078, 0.106);  // deckDark base (rules.palette)
  float du = (w.x - uDeckRect.x) / uDeckRect.z;
  if (du >= 0.0 && du <= 1.0) {
    float dv = clamp(wy, 0.0, uDeckRect.w - 1.0) / max(uDeckRect.w - 1.0, 1.0);
    col = texture(uDeck, vec2(du, dv)).rgb;
  }

  /* --- puddle: the structure mirror, wet-masked, waved --- */
  if (wy >= 0.0 && wy <= uReflRect) {
    float wet = wy >= uWetTop ? texture(uWet, vec2(du, (wy - uWetTop) / 170.0)).a : 1.0;
    float amp = (0.55 + wet * 0.85);
    float ru = du + waveX(wy) * amp / uDeckRect.z;
    vec4 refl = texture(uRefl, vec2(ru, wy / uReflRect));
    col = mix(col, col * 0.72 + refl.rgb * 1.35, refl.a * (0.35 + wet * 0.65));
  }

  /* --- light transport (SH_LIGHT_QUAD) --- */
  vec3 light = vec3(0.0);
  light += uDoorCol * falloff(vec2(w.x, wy), uDoor);
  light += uStreetCol * falloff(vec2(w.x, wy), uStreet);
  float depth = 1.0 - clamp(wy / 240.0, 0.0, 1.0);
  light += uKeyCol * (uKeyI * depth * depth * 1.2);

  /* --- SH_DIRECTIONAL shadows: the key's contribution is occluded ---
   * (the ambient plate stays; the shadow reads as missing light — the
   * reference's behaviour) */
  float shadow = 1.0;
  for (int i = 0; i < uOccN; i++) {
    if (keyOccluded(vec2(w.x, wy), uOcc[i], uOccZ[i]) > 0.5) { shadow = 0.18; break; }
  }
  light *= mix(0.2, 1.0, shadow);

  col += light * 0.5;
  outColor = vec4(col, 1.0);
}
`
