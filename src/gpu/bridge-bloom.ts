/** Optics run on small linear-HDR targets. These divisors are *per axis*.
 * The fourth allocation is a composition target at the output's 1/4 size;
 * it combines all three scales so the film pass needs one bilinear fetch. */
export const BLOOM_DIVISORS = [4, 8, 16] as const
export const BLOOM_TARGET_DIVISORS = [4, 8, 16, 4] as const
export const BLOOM_GAIN = .34
export const BLOOM_SKIRTS = [.42, .18] as const

export function bloomSize(width: number, height: number, divisor: number): [number, number] {
  return [Math.max(1, Math.ceil(width / divisor)), Math.max(1, Math.ceil(height / divisor))]
}

export const BLOOM_FILTER = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uInput, uWide, uTight;
uniform vec2 uTexel;
uniform int uPass; // 0 prefilter, 1 blur/downsample, 2 combine all three scales
vec3 take(vec2 uv) {
  vec3 c = texture(uInput,uv).rgb;
  if (uPass == 0) {
    // Gate each bilinear footprint before averaging. Keep ordinary LDR
    // paint out, admit saturated HDR edges, and cap fireflies, not the scene.
    float y = max(dot(c,vec3(.2126,.7152,.0722)), .86*max(c.r,max(c.g,c.b)));
    float knee = clamp(y-1.,0.,.60);
    c *= min(2.75,max(y-1.22,1.15*knee*knee))/max(1.,y);
  }
  return c;
}
void main() {
  if (uPass == 2) {
    // Input is the mid skirt; tight remains distinct, so we never sample an
    // attached texture or silently drop the narrow/high-energy highlight.
    outColor = vec4(texture(uTight,vUV).rgb+texture(uInput,vUV).rgb*${BLOOM_SKIRTS[0]}+
      texture(uWide,vUV).rgb*${BLOOM_SKIRTS[1]},0.);
    return;
  }
  // Four bilinear footprints cover a 4x4 area at the first reduction.
  // Later reductions reuse the same symmetric kernel on the smaller image.
  vec2 k = uTexel*(uPass == 0 ? 1. : .86);
  vec3 c = take(vUV+k)+take(vUV-k)+take(vUV+vec2(-k.x,k.y))+take(vUV+vec2(k.x,-k.y));
  outColor = vec4(c*.25,0.);
}`
