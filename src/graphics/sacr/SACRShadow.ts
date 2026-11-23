import { CARGO_DECK, CATWALK_DECK, TOP_LANE } from '../../game/stage/bridge-deck-face'
import { CAST_DIRECTION_MATCH, CAST_RELATIVE_CUTOFF, CAST_STRENGTH_MAX, MOON_CAST_ENERGY, VECTOR_ATLAS_W, VECTOR_H, VECTOR_TOP } from '../bridge/LightVectorGrid'
import { FACADE_RECEIVER_Z } from './SACRLocalLight'
import { SACR_ACTOR_Z } from './SACRMath'
import { SACR_PX_PER_METER, SACR_SHADOW_GUARD, SACR_SOLID_ID } from './SACRPacker'

// GLSL ES 3.00. Only the array element may have a dynamic index. Vector
// lanes use explicit swizzles on implementations with strict UBO lowering.
export const SACR_DISTANCE = `
uint wordLane(uvec4 q,int i){return i==0?q.x:i==1?q.y:i==2?q.z:q.w;}
vec2 capsuleSection(vec2 p,vec2 a,vec2 b,float ra,float rb){
  vec2 v=b-a;
  float k=clamp(dot(p-a,v)/max(dot(v,v),.00000001),0.,1.);
  return vec2(length(p-a-v*k),mix(ra,rb,k));
}
float capsuleDistance(vec2 p,vec2 a,vec2 b,float ra,float rb){
  vec2 s=capsuleSection(p,a,b,ra,rb);
  return s.x-s.y;
}
`
export const SACR_SHADOW = SACR_DISTANCE + `
uniform sampler2D u_LightVectorGrid;
// u_SacrView is declared beside the SACR block in LIGHTS so every UBO
// consumer (road, facades, actors, weather) shares one section address.
uniform int u_CasterCount;
struct DirectLoss { float moon; float practical; float combat; int combatId; };
float combatVisibility(DirectLoss loss,int source){return source==loss.combatId?1.-loss.combat*.82:1.;}
vec4 unpackLightVector(uint w) {
  vec2 v=vec2(float(w&31u),float((w>>5u)&31u))*(2./31.)-1.;
  float z=1.-abs(v.x)-abs(v.y), t=max(-z,0.);
  v+=vec2(v.x<0.?t:-t,v.y<0.?t:-t);
  float e=float(w>>10u)/63.;
  return vec4(normalize(vec3(v,z)),e*e*${CAST_STRENGTH_MAX});
}
void admitLight(vec4 light,int id,inout vec4 a,inout vec4 b,inout int ia,inout int ib,inout float rejected){
  if(light.w>a.w){rejected=max(rejected,b.w);b=a;ib=ia;a=light;ia=id;}
  else if(light.w>b.w){rejected=max(rejected,b.w);b=light;ib=id;}
  else rejected=max(rejected,light.w);
}
// Two cell-center taps along the section. Never interpolate packed bytes
// or assume the brightest lane still belongs to the same fixture next door.
void vectorCell(int x,int y,out vec4 a,out vec4 b){
  uvec4 v=uvec4(round(texelFetch(u_LightVectorGrid,ivec2(x,y),0)*255.));
  a=unpackLightVector(v.x|(v.y<<8u)); b=unpackLightVector(v.z|(v.w<<8u));
}
float directionMatch(vec4 x,vec4 y){
  if(x.w==0.||y.w==0.||x.z*y.z<=0.)return 0.;
  // Score by angular separation, not rank or energy. A pair of good
  // matches outweighs one; close fixtures can cross in the energy order.
  float d=dot(x.xyz,y.xyz);
  return d>=${CAST_DIRECTION_MATCH}?d:0.;
}
vec4 blendDirections(vec4 x,inout vec4 y,float t,float match){
  if(match==0.)return vec4(x.xyz,x.w*(1.-t));
  vec4 r=vec4(normalize(mix(x.xyz,y.xyz,t)),mix(x.w,y.w,t));
  y.w=0.;
  return r;
}
void practicalDirections(float u,int row,out vec4 a,out vec4 b,out vec4 c,out vec4 d){
  float s=clamp(u*${VECTOR_ATLAS_W}.-.5,0.,${VECTOR_ATLAS_W-1}.);
  int x=int(s);float t=s-float(x);
  vectorCell(x,row,a,b);
  vectorCell(min(x+1,${VECTOR_ATLAS_W-1}),row,c,d);
  float ac=directionMatch(a,c),bd=directionMatch(b,d);
  float ad=directionMatch(a,d),bc=directionMatch(b,c);
  if(ad+bc>ac+bd){vec4 tmp=c;c=d;d=tmp;ac=ad;bd=bc;}
  a=blendDirections(a,c,t,ac);b=blendDirections(b,d,t,bd);
  // Unmatched sources crossfade radiance, not angle. They retain separate
  // cast directions and go through the same bounded two-register admission.
  c.w*=t;d.w*=t;
}
float soleAO(vec3 p) {
  float a=1.;
  for(int i=0;i<16;i++) {
    vec4 f=u_FootAO[i];
    if(f.z<=0.)break;
    if((f.w<0.)!=(p.y>.5)||abs(p.x-f.x)>f.z*4.8)continue;
    float lift=max(0.,f.w<0.?-1.-f.w:f.w), spread=1.+min(.82,lift*.46);
    float d=length((p.xz-f.xy)*vec2(1.,2.25))/(f.z*spread);
    float inner=.71*(1.-smoothstep(.055,.47,lift))*(1.-smoothstep(.52,1.21,d));
    float outer=.32*exp(-lift*1.85-d*d*.695)*(1.-smoothstep(1.81,2.44,d));
    a=min(a,1.-max(inner,outer));
  }
  return a;
}
float signSafe(float a){return (a<0.?-1.:1.)*max(abs(a),.12);}
// Approximate finite-source integration across the projected capsule's
// thickness. A very thin/distant limb loses its umbra instead of leaving a
// sharp, half-dark streak. The culling guard includes the entire kernel.
float shadowSpread(float separation,float angularRadius){
  return min(${(SACR_SHADOW_GUARD - .04).toFixed(2)},.018+separation*angularRadius);
}
float capsuleCoverage(vec2 section,float spread){
  float r=section.y,d=section.x;
  return smoothstep(-spread,spread,r-d)-smoothstep(-spread,spread,-r-d);
}
float traceProjectedCapsules(vec3 P,vec3 L,float aperture){
  float gap=${SACR_ACTOR_Z.toFixed(3)}-P.z;
  float t=gap/signSafe(L.z);
  if(t<0.)return 0.;
  vec2 bend=L.xy*t,s=P.xy+bend;
  if(s.y<P.y-.06||s.y>12.5)return 0.;
  float width=max(.01,u_SacrView.y);
  // The rolled view packs some offscreen detail. Use the edge column for
  // that guard instead of slicing a projected silhouette at its border.
  float edge=1.-smoothstep(0.,${SACR_SHADOW_GUARD},max(-s.x,s.x-width));
  if(edge<=0.)return 0.;
  int col=clamp(int(s.x*80./width),0,79);
  float ink=0.;
  float spread=shadowSpread(length(vec3(bend,gap)),aperture);
  for(int slot=0;slot<SACR_K;slot++){
    int word=col*2+slot/4;
    uint bits=wordLane(u_ShadowBins[word/4],word%4);
    uint id=(bits>>uint((slot%4)*8))&255u;
    if(id==0u||id>64u)break;
    uvec4 a=u_PrimPool[int(id)-1];
    uint m=a.w;
    vec2 rz=unpackHalf2x16(a.z);
    // The static depth strip already accounts for slabs. HDR arcs and blades
    // are never opaque; even a corrupt bin cannot turn one into a caster.
    if(rz.x<0.||((m>>21u)&31u)!=0u||(m>>26u)==${SACR_SOLID_ID}u)continue;
    vec2 shape=capsuleSection(s,unpackHalf2x16(a.x),unpackHalf2x16(a.y),rz.x,float(m&63u)*.02);
    ink=max(ink,capsuleCoverage(shape,spread));
    if(ink>=.997)break;
  }
  return ink*edge;
}
DirectLoss receiverShadows(vec3 P,vec2 q,vec2 traceP,vec4 env,vec3 practical){
  DirectLoss outLoss=DirectLoss(0.,0.,0.,-1);
  if(u_CasterCount==0||env.b<.048)return outLoss;
  const vec3 lum=vec3(.2126,.7152,.0722);
  vec4 a=vec4(0.),b=vec4(0.); int ia=-3,ib=-3;
  float rejected=0.;
  float steady=dot(practical,lum);
  float u=(q.x-uEnvWindow.x)*uEnvWindow.y;
  // Empty texels or a stale tile window are never interpreted as illumination.
  if(uEnvReady>.5&&u>=0.&&u<1.&&steady>.006){
    int row=int(clamp(round((min(0.,-P.y*${SACR_PX_PER_METER}.)-(${VECTOR_TOP}.))/${-VECTOR_TOP}. * ${VECTOR_H-1}.),0.,${VECTOR_H-1}.));
    vec4 p0,p1,p2,p3;
    practicalDirections(u,row,p0,p1,p2,p3);
    // Interpolation cannot create energy through a jamb: the fine baked
    // irradiance supplies an upper bound and zero remains zero.
    float gate=min(1.,steady/max(.001,p0.w+p1.w+p2.w+p3.w))*env.b;
    p0.w*=gate;p1.w*=gate;p2.w*=gate;p3.w*=gate;
    admitLight(p0,-1,a,b,ia,ib,rejected);admitLight(p1,-1,a,b,ia,ib,rejected);
    admitLight(p2,-1,a,b,ia,ib,rejected);admitLight(p3,-1,a,b,ia,ib,rejected);
  }
  admitLight(vec4(vec3(LUNAR_KEY.x,-LUNAR_KEY.y,LUNAR_KEY.z),${MOON_CAST_ENERGY}*env.r*env.b*uAtmo.x*uWeather.w),-2,a,b,ia,ib,rejected);
  // At most one combat candidate joins the two baked candidates and moon.
  vec4 strike=vec4(0.);int source=-1;
#if BRIDGE_MASTER_ENV
  float strikeAperture=.047;
#endif
  float gap=${SACR_ACTOR_Z}-P.z;
  int first=SACR_K==4?max(0,uFlashIDs.x):0;
  int last=SACR_K==4?uFlashIDs.x+1:uCount;
  if(inLightBox(traceP,uDirectBounds))for(int j=0;j<MAX_L;j++){
    int i=j+first;if(i>=last)break;
    vec4 light=uLights[i];
    if(light.w!=3.)continue;
    vec3 incident;
    float e=receivedLight(q,traceP,light,uShape[i],(P.z-${SACR_ACTOR_Z})*${SACR_PX_PER_METER}.,incident)*dot(uEnergy[i].rgb,lum)*uEnergy[i].w*.68;
    if(e<=strike.w)continue;
    // Use the incident vector of the light this term actually subtracts.
    // A near-side spark cannot cast on a receiver between it and the eye.
    vec2 src=sectionEmitter(traceP,light,uShape[i]);
    float distance=length(lightVector(src-traceP,(P.z-${SACR_ACTOR_Z})*${SACR_PX_PER_METER}.));
    if(gap*incident.z<=0.||abs(gap)>=abs(incident.z)*distance/${SACR_PX_PER_METER}.)continue;
    strike=vec4(incident.x,-incident.y,incident.z,e);source=i;
#if BRIDGE_MASTER_ENV
    strikeAperture=clamp(uShape[i].z/max(1.,distance),.024,.17);
#endif
  }
  admitLight(strike,source,a,b,ia,ib,rejected);
  if(a.w<.004)return outLoss;
  // Cross the admission boundary without an abrupt pivot at equality.
  // Only compete with the strongest *excluded* source; the two live
  // Master directions can cross freely while both retain their radiance.
  float rival=SHADOW_K==1?b.w:rejected;
  for(int k=0;k<SHADOW_K;k++){
    vec4 light=k==0?a:b;int id=k==0?ia:ib;
    float w=light.w/a.w;
    if(w<${CAST_RELATIVE_CUTOFF})break;
    float handoff=smoothstep(0.,.065,(light.w-rival)/a.w);
    if(handoff<.001)continue;
#if BRIDGE_MASTER_ENV
    // The baked directions don't carry emitter sizes. Use an effective
    // aperture for a cloud-softened lunar key and a broader practical lens.
    float aperture=id==-2?.028:id>=0?strikeAperture:.092;
#else
    float aperture=id==-2?.075:id>=0?.047:.09;
#endif
    float oc=traceProjectedCapsules(P,light.xyz,aperture)*handoff*smoothstep(${CAST_RELATIVE_CUTOFF},.27,w);
    if(id==-2)outLoss.moon=oc;
    else if(id==-1)outLoss.practical+=oc*light.w/max(.006,steady*env.b);
    else if(id>=0){outLoss.combat=oc;outLoss.combatId=id;}
  }
  outLoss.practical=min(1.,outLoss.practical);
  return outLoss;
}
// Invert the painted return, not a rectangle on the vertical fascia.
// The section's X address remains q.x, including on the diagonal edge.
bool raisedPoint(vec2 q,out vec3 P){
  P=vec3(0.);
  if(q.y>${CARGO_DECK.y}.||q.y<${CATWALK_DECK.y + CATWALK_DECK.returnY}.)return false;
  float x=q.x/${SACR_PX_PER_METER}.+u_SacrView.x;
  for(int i=0;i<8;i++){
    vec4 a=u_Supports[i];if(a.y<=a.x)break;
    float floor=-a.z*${SACR_PX_PER_METER}.;
    bool cat=a.w>${(CATWALK_DECK.near + CARGO_DECK.near) / 2};
    float v=(q.y-floor)/(cat?${CATWALK_DECK.returnY}.:${CARGO_DECK.returnY}.);
    if(v<0.||v>1.)continue;
    float shift=v*(cat?${CATWALK_DECK.returnX}.:${CARGO_DECK.returnX}.)/${SACR_PX_PER_METER}.;
    if(x<a.x+shift||x>=a.y+shift)continue;
    P=vec3(x,a.z,${SACR_ACTOR_Z}+a.w*(v/${TOP_LANE}-1.));
    return true;
  }
  return false;
}
DirectLoss receiverFace(vec2 q,vec4 env,vec3 steady,out float contact,out float depth,out vec2 traceP,out bool raised){
  contact=1.;depth=${FACADE_RECEIVER_Z}.;traceP=q;
  vec3 P;
  raised=raisedPoint(q,P);
  if(!raised)return DirectLoss(0.,0.,0.,-1);
  depth=(P.z-${SACR_ACTOR_Z})*${SACR_PX_PER_METER}.;
  traceP.y=-P.y*${SACR_PX_PER_METER}.;
  contact=soleAO(P);
  return receiverShadows(P,q,traceP,env,steady);
}
vec3 shadowedCombat(vec2 q,vec2 p,float ao,DirectLoss loss,float depth,vec3 N){
  if(!inLightBox(p,uDirectBounds))return vec3(0.);
  vec3 c=vec3(0.);
  for(int i=0;i<MAX_L;i++){
    if(i>=uCount)break;
    vec4 s=uLights[i],e=uEnergy[i];
    if(s.w==1.||s.w==2.)continue;
    vec3 L;
    float v=receivedLight(q,p,s,uShape[i],depth,L);
    c+=e.rgb*(e.w*v*faceLight(N,L)*(s.w==3.?.68:.48)*combatVisibility(loss,i));
  }
  return c*ao;
}
`
