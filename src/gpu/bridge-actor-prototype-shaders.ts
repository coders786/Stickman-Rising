import { VIEW } from './bridge-shaders'

/** Isolated capsule prototype, not the authored fighter presentation. Its
 * input is camera-relative world space; it does not consume SACR transport. */
export const ACTOR_PROTOTYPE_VERT = `#version 300 es
precision highp float;
${VIEW}
layout(location=0) in vec4 aEndpoints;
layout(location=1) in vec2 aRadii;
layout(location=2) in vec4 aColor;
out vec2 vLocal;
flat out float vLength;
flat out vec2 vRadii;
flat out vec4 vColor;
void main() {
  vec2 d=aEndpoints.zw-aEndpoints.xy;
  float len=length(d);
  vec2 axis=len>0.001?d/len:vec2(1.,0.);
  vec2 normal=vec2(-axis.y,axis.x);
  float radius=max(aRadii.x,aRadii.y)+1.;
  vec2 corner=vec2(float(gl_VertexID & 1),float((gl_VertexID >> 1) & 1));
  vLocal=vec2(mix(-radius,len+radius,corner.x),mix(-radius,radius,corner.y));
  vec2 p=aEndpoints.xy+axis*vLocal.x+normal*vLocal.y;
  vLength=len; vRadii=aRadii; vColor=aColor;
  gl_Position=vec4(worldUV(p)*2.-1.,0.,1.);
}`

export const ACTOR_PROTOTYPE_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vLength;
flat in vec2 vRadii;
flat in vec4 vColor;
out vec4 outColor;
void main() {
  float t=clamp(vLocal.x/max(vLength,.001),0.,1.);
  float distanceToAxis=length(vLocal-vec2(t*vLength,0.));
  float edge=distanceToAxis-mix(vRadii.x,vRadii.y,t);
  float aa=max(fwidth(edge),.0001);
  float coverage=1.-smoothstep(-aa,aa,edge);
  if(coverage<=0.) discard;
  outColor=vec4(vColor.rgb,vColor.a*coverage);
}`
