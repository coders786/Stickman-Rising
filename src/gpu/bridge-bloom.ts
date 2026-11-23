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

/** Dual-filter Kawase on the same four targets as the previous box chain:
 * passes 0/1 run the 13-tap bilinear downsample (hardware bilinear makes each
 * tap a 2x2 average, so the kernel covers 4x4 at the first reduction), pass 3
 * runs the 4-tap tent upsample with the re-injection gain, and pass 2 composes
 * the upsampled core with the raw deep mip as the broad skirt. Every offset is
 * a literal, so no dynamic lane indexing exists on strict UBO/ALU drivers. */
export const BLOOM_FILTER = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uInput, uWide, uTight;
uniform vec2 uTexel;
uniform int uPass; // 0 prefilter+down, 1 down, 3 up, 2 compose
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
// 13-tap Kawase downsample: center*4, diagonals*1, orthogonal 2-texels*2.
vec3 down13(vec2 uv) {
  vec2 t = uTexel;
  vec3 c = take(uv) * 4.
    + take(uv + t*vec2(-1.,-1.)) + take(uv + t*vec2(1.,-1.))
    + take(uv + t*vec2(-1.,1.)) + take(uv + t*vec2(1.,1.))
    + (take(uv + t*vec2(-2.,0.)) + take(uv + t*vec2(2.,0.))
    + take(uv + t*vec2(0.,-2.)) + take(uv + t*vec2(0.,2.))) * 2.;
  return c * 0.0625;
}
void main() {
  if (uPass == 2) {
    // The up pyramid already folds the mid scale back into the core; the raw
    // deep mip still contributes the broad skirt as a separate fetch.
    outColor = vec4(texture(uTight,vUV).rgb + texture(uWide,vUV).rgb*${BLOOM_SKIRTS[0]},0.);
    return;
  }
  if (uPass == 3) {
    // Tent upsample. The destination still holds this mip's downsampled
    // content; the pipeline composes with an additive blend, so the smaller
    // mip is re-injected by the blend itself, never by a feedback fetch.
    vec2 t = uTexel * .5;
    vec3 c = texture(uInput, vUV + t*vec2(-1.,-1.)).rgb
      + texture(uInput, vUV + t*vec2(1.,-1.)).rgb
      + texture(uInput, vUV + t*vec2(-1.,1.)).rgb
      + texture(uInput, vUV + t*vec2(1.,1.)).rgb;
    outColor = vec4(c * .25, 0.);
    return;
  }
  outColor = vec4(down13(vUV), 0.);
}`
