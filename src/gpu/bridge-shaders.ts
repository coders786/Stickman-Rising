import { SACR_LOCAL_GEOMETRY } from '../graphics/sacr/SACRLocalLight'
import { SACR_BLOCK } from '../graphics/sacr/SACRBlock'
import { SACR_MASTER_K, SACR_MOBILE_K, SACR_PX_PER_METER, SACR_SOLID_ID } from '../graphics/sacr/SACRPacker'
import { SACR_ACTOR_Z } from '../graphics/sacr/SACRMath'
import { SACR_SHADOW } from '../graphics/sacr/SACRShadow'
import { BLOCKER_LIMIT } from '../graphics/bridge/NoirGeometry'
import { GLASS_EXTINCTION, GLASS_IOR, GLASS_RADIANCE_RANGE, GLASS_THICKNESS_M, SHOP_FRONT_LIMIT } from '../graphics/bridge/ShopGlassOptics'
import { CITY_AIR, CITY_DISTANCE } from '../graphics/bridge/SkyOptics'
import { ATMOSPHERE, ENVIRONMENT, MOBILE_SURFACE_FLASH, SKY_CACHE_BODY, SKY_DISC_DETAIL, SKY_EVALUATION, SKY_SAMPLE } from './bridge-lighting-shaders'
import { BRIDGE_COVER_BUDGET, BRIDGE_LIGHT_BUDGET } from '../game/render/bridge-frame'
import { MATERIAL_TILE } from '../game/stage/bridge-material'
import { BLOOM_GAIN } from './bridge-bloom'
import { ROAD } from '../game/stage/road-section'
import { BRIDGE_VENT_BUDGET, RAIN_CELL, RAIN_GUST, RAIN_HEIGHT, RAIN_PLANES } from "../game/stage/bridge-weather-data"

export const FULLSCREEN = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
export const VIEW = `
uniform vec2 uView;    // CSS width/height
uniform vec4 uCam;     // world y, zoom, cos(roll), sin(roll)
vec2 worldUV(vec2 p) {
  vec2 d = p - vec2(0., uCam.x);
  vec2 s = vec2(d.x*uCam.z-d.y*uCam.w, d.x*uCam.w+d.y*uCam.z);
  return .5 + vec2(s.x,-s.y)*uCam.y/uView;
}
vec2 uvWorld(vec2 uv) {
  vec2 s = (uv-.5)*vec2(uView.x,-uView.y)/uCam.y;
  return vec2(s.x*uCam.z+s.y*uCam.w, -s.x*uCam.w+s.y*uCam.z+uCam.x);
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(vec3(.04045), c));
}
`
export const RECEIVER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aWorld;
layout(location=1) in vec3 aMaterial;
out vec2 vWorld;
flat out vec3 vMaterial;
${VIEW}
void main() {
  vWorld=aWorld; vMaterial=aMaterial;
  gl_Position=vec4(worldUV(aWorld)*2.-1.,0.,1.);
}`

export const LIGHTS = SACR_BLOCK + SACR_LOCAL_GEOMETRY + `
#define MAX_L ${BRIDGE_LIGHT_BUDGET}
#define MAX_C ${BRIDGE_COVER_BUDGET}
uniform int uCount, uRoofs;
uniform vec4 uLights[MAX_L], uEnergy[MAX_L], uShape[MAX_L];
uniform vec4 uCover[MAX_C];
uniform int uBlockerCount;
uniform ivec2 uFlashIDs; // only .x is admitted on Mobile
uniform vec4 uWeather; // time, wet, fog, key
uniform vec4 uMood;    // keyX, storm rim, tex origin, puddle origin
uniform vec4 uDirectBounds, uEmissionBounds, uWeatherBounds;
uniform vec2 u_SacrView; // camera-centre X offset (m), column window width (m)
uint sacrWordLane(uvec4 q,int i){return i==0?q.x:i==1?q.y:i==2?q.z:q.w;}
int sacrColumn(float x){
  return clamp(int(floor((x*(1./${SACR_PX_PER_METER}.)+u_SacrView.x)*80./max(.001,u_SacrView.y))),0,79);
}
bool inLightBox(vec2 p,vec4 box){
  // Manual shader probes can omit the optional broad phase.
  return (all(greaterThanEqual(p,box.xy))&&all(lessThanEqual(p,box.zw)))||all(equal(box,vec4(0.)));
}

int cover(vec2 p) {
  for (int i=0;i<MAX_C;i++) {
    if (i>=uRoofs) break;
    vec2 r=uCover[i].xy;
    if(p.x>=r.x && p.x<r.y) return i;
  }
  return -1;
}
float spanDist(vec2 q, vec2 a, vec2 b) {
  vec2 v=b-a;
  return length(q-a-v*clamp(dot(q-a,v)/max(dot(v,v),.001),0.,1.));
}
float cookie(vec2 q, vec4 a, vec4 s) {
  if(q.y<a.y) return 0.;
  vec2 d=normalize(s.xy-a.xy+vec2(.00001)), v=normalize(q-a.xy+vec2(.00001));
  float con=smoothstep(1.-s.w*.58,1.-s.w*.14,dot(d,v));
  return con * (.90+.10*cos((q.x-a.x)*.05+(q.y-a.y)*.021));
}
float transmits(vec2 from,vec2 source) {
  vec2 lo=min(from,source),hi=max(from,source),d=source-from;
  vec2 inv=1./vec2(abs(d.x)<.0001?.0001:d.x,abs(d.y)<.0001?.0001:d.y);
  for(int i=0;i<${BLOCKER_LIMIT};i++){
    if(i>=uBlockerCount)break;
    vec4 b=u_DynamicBlockers[i];
    if(any(lessThan(hi,b.xy))||any(greaterThan(lo,b.zw)))continue;
    // A point on the local near face can receive light; don't test the
    // block it lives in. A separate solid along the same segment still wins.
    if(all(greaterThan(from,b.xy))&&all(lessThan(from,b.zw)))continue;
    if(all(greaterThan(source,b.xy))&&all(lessThan(source,b.zw)))continue;
    vec2 a=(b.xy-from)*inv,z=(b.zw-from)*inv;
    vec2 near=min(a,z),far=max(a,z);
    if(min(min(far.x,far.y),.999)>max(max(near.x,near.y),.001))return 0.;
  }
  return 1.;
}
float receivedLight(vec2 q,vec2 receiver,vec4 a,vec4 s,float depth,out vec3 L){
  vec2 source=sectionEmitter(receiver,a,s);
  vec3 d=lightVector(source-receiver,depth);
  L=vec3(0.);
  float d2=dot(d,d),r2=a.z*a.z;
  if(d2>=r2)return 0.;
  float u=d2/r2,fall=1.-u;
  float v=fall*fall/(1.+8.*u);
  if(a.w==4.||a.w==1.)v*=cookie(q,a,s);
  if(v<.001)return 0.;
  if(transmits(receiver,source)==0.)return 0.;
  L=d*inversesqrt(max(1.,d2));
  return v;
}
float receivedLight(vec2 q,vec2 receiver,vec4 a,vec4 s){
  vec3 L;
  return receivedLight(q,receiver,a,s,0.,L);
}
// U3 — a combat impulse is a real emitter: opaque posed capsules between the
// spark and this receiver block it, with one shadow-bin column and four
// slots. Emissive records never shade their own light; slabs stay out
// (their trace owns the eave), and endpoint hits are the two bodies
// themselves, not occluders.
float sparkGate(vec2 receiver,vec2 source,float depth){
  vec2 d=source-receiver;
  float span=max(.0001,dot(d,d));
  int col=sacrColumn(.5*(receiver.x+source.x));
  float gate=1.;
  float zRecv=${SACR_ACTOR_Z.toFixed(3)}+depth*${(1 / SACR_PX_PER_METER).toFixed(6)};
  for(int slot=0;slot<4;slot++){
    int word=col*2+slot/4;
    uint bits=sacrWordLane(u_ColBins[word/4],word%4);
    uint id=(bits>>uint((slot%4)*8))&255u;
    if(id==0u||id>64u)break;
    uvec4 a=u_PrimPool[int(id)-1];
    uint m=a.w;
    vec2 rZ=unpackHalf2x16(a.z);
    if(rZ.x<0.||((m>>21u)&31u)!=0u||(m>>26u)==${SACR_SOLID_ID}u)continue;
    if(rZ.y>zRecv+.02)continue;
    vec2 A=unpackHalf2x16(a.x),B=unpackHalf2x16(a.y);
    float k=clamp(dot(A-receiver,d)/span,0.,1.);
    if(k<.09||k>.91)continue;
    vec2 p=receiver+d*k;
    vec2 v=B-A;
    float t=clamp(dot(p-A,v)/max(.000001,dot(v,v)),0.,1.);
    float cov=smoothstep(-.05,.05,rZ.x-length(p-A-v*t));
    gate*=1.-cov*.92;
  }
  return gate;
}
float faceLight(vec3 N,vec3 L){return .14+.86*max(0.,dot(N,L));}
`
export const PROLOG_300 = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2D;
`
export const SCREEN_IN = `in vec2 vUV; out vec4 outColor;`

export const SKY_CACHE_MASTER = PROLOG_300 + '#define MASTER_SKY 1\n' + SCREEN_IN + ATMOSPHERE + SKY_EVALUATION + SKY_CACHE_BODY
export const SKY_CACHE_MOBILE = PROLOG_300 + '#define MASTER_SKY 0\n' + SCREEN_IN + ATMOSPHERE + SKY_EVALUATION + SKY_CACHE_BODY

// One bounded scene-space layer, resolved after lighting the transmitted
// room and before props/actors. See glassSlab for the CPU reference.
const SHOP_GLASS = `
uniform sampler2D uShopRadiance;
uniform int uShopFronts;
uniform vec4 uShopBounds[${SHOP_FRONT_LIMIT}];
uniform float uShopDistance[${SHOP_FRONT_LIMIT}];
vec3 shopGlass(vec2 q,vec3 room){
  for(int i=0;i<${SHOP_FRONT_LIMIT};i++){
    if(i>=uShopFronts)break;
    vec4 b=uShopBounds[i];
    if(any(lessThan(q,b.xy))||any(greaterThan(q,b.zw)))continue;
    vec2 uv=(q-b.xy)/(b.zw-b.xy);
    uv.y=(uv.y+float(i))/${SHOP_FRONT_LIMIT}.;
    vec4 mirror=texture(uShopRadiance,uv);
    if(mirror.a<.001)continue;
    vec2 d=(q-vec2(0.,uCam.x))/uShopDistance[i];
    float c=inversesqrt(1.+dot(d,d)),n=${GLASS_IOR};
    float t=sqrt(1.-(1.-c*c)/(n*n));
    float a=exp(-${(GLASS_THICKNESS_M * GLASS_EXTINCTION).toFixed(6)}/t);
    vec2 f=vec2((c-n*t)/(c+n*t),(n*c-t)/(n*c+t));
    vec2 r=f*f,pass=1.-r;
    vec2 through=pass*pass*a/max(vec2(.00000001),1.-r*r*a*a);
    float T=.5*(through.x+through.y),R=.5*dot(r,1.+through*a);
    return room*(1.-mirror.a*(1.-T))+mirror.rgb*(R*${GLASS_RADIANCE_RANGE});
  }
  return room;
}
`

const BASE_CITY = `
uniform sampler2D uBase, uCityFar, uCityMid, uFarBasis, uMidBasis;
uniform vec4 uFarBand, uMidBand; // offset, repeat scale, base V, height
uniform int uBaseProbe;
vec3 cityLayer(vec3 behind,vec4 band,sampler2D plate,sampler2D basis,float depth){
  vec2 uv=vec2(vUV.x*band.y+band.x,(vUV.y-band.z)/band.w);
  if(uv.y>1.||uv.y<0.)return behind;
  vec4 p=texture(plate,uv);
  if(p.a<.002) return behind;
  vec4 e=texture(basis,uv); // exactly one RGBA8 environment read per visible layer
  float strike=stormAt(vUV.x), crown=e.a*smoothstep(.60,.90,e.g);
  vec3 albedo=toLinear(p.rgb);
  float lit=(.30+.40*e.b+.24*e.g)+uAtmo.x*.40*e.r;
  vec3 rim=vec3(.12,.128,.14)*(strike*crown);
  vec3 c=albedo*lit+rim;
  // Static glazing only. The bounded in-world cab overlay animates the
  // few occupied shafts; no per-screen-pixel hash or flicker loop.
  c+=e.a*(vec3(.009,.010,.012)+albedo*.16);
  float z=max(0.,vUV.y*uAir.x-uAir.w);
  float transmission=exp(-(${CITY_AIR.clear}+${CITY_AIR.haze}*uAir.y)*depth*mix(${CITY_AIR.high},1.,exp(-${CITY_AIR.decay}*z)));
  vec3 aerial=uHazeColor*(${CITY_AIR.fill}+${CITY_AIR.baseGlow}*exp(-5.*z))+vec3(.013,.020,.027)*strike;
  return mix(behind,mix(aerial,c,transmission),p.a);
}
vec3 bridgeBase(vec2 q){
  // The road/resolve pass writes every pixel in this exact half section;
  // don't evaluate city, mist or static transport beneath opaque asphalt.
  if(q.y>=${ROAD.rear}.&&q.y<=${ROAD.front}.)return vec3(0.);
  vec4 art=texture(uBase,vUV);
  bool live=uSkyView.y>.5;
  vec3 c=vec3(0.);
  if(live&&art.a<.998){
    vec2 sky=vUV;
    vec4 s=sampleSky(sky);
    c=paintSky(sky,s.rgb);
    c=cityLayer(c,uFarBand,uCityFar,uFarBasis,${CITY_DISTANCE[0]});
    c=cityLayer(c,uMidBand,uCityMid,uMidBasis,${CITY_DISTANCE[1]});
    // Mist is a volume behind the rail, shelter and road. Sparse world
    // coverage resolves afterwards, so it never veils an opaque eave.
    c=mix(c,mistSource(vUV.x),s.a);
#if !BASE_MOBILE
    // Local light through humid air. Use the same occluded, finite-source
    // field as the road, and put the scattering behind opaque bridge art.
    // This is not a cone/halo over a fighter or a full-screen exposure lift.
    if(q.y>-220.&&q.y<${ROAD.rear}.&&cover(q)<0){
      vec2 tc=envUV(q,false);
      float scatter=envBasis(tc,false).a;
      if(scatter>.002){
        vec3 flux=fixtureRadiance(tc);
        float peak=max(flux.r,max(flux.g,flux.b));
        vec3 source=flux*(.58/max(.24,peak));
        float height=smoothstep(-220.,-164.,q.y)*(1.-smoothstep(-84.,${ROAD.rear}.,q.y));
        c=mix(c,source,scatter*height*(.024+.16*uAir.y));
      }
    }
#endif
  }
  if(art.a<=.002)return c;
  vec3 linear=toLinear(art.rgb);
  // Road is resolved in its own pass. Other non-mesh route details use the
  // same L4 basis as the Master mesh and the Mobile receiver.
  if(q.y>=-368.&&q.y<=160.){
    int eave=cover(q);
    bool inside=insideEave(q,eave);
    vec2 tc=envUV(q,false);
    vec4 e=envBasis(tc,inside);
    vec3 steady=fixtureRadiance(tc);
    float contact,depth;vec2 traceP;bool raised;
    DirectLoss loss=receiverFace(q,e,steady,contact,depth,traceP,raised);
    if(!live&&!raised)return shopGlass(q,linear);
    vec3 env=environmentLight(e,steady,.85,stormAt(vUV.x),.92,vec2(loss.moon,loss.practical));
    vec3 N=raised?vec3(0.,-1.,0.):vec3(0.,0.,-1.);
#if BASE_MOBILE
    env+=mobileImpulseDiffuse(q,traceP,e.b,depth,N)*(uFlashIDs.x==loss.combatId?1.-loss.combat*.82:1.);
#else
    env+=shadowedCombat(q,traceP,e.b,loss,depth,N);
#endif
    linear*=env*contact;
  }
  linear=shopGlass(q,linear);
  return live?mix(c,linear,art.a):linear;
}
`
export const BASE_FRAG = PROLOG_300 + `#define BASE_MOBILE 0\n#define MASTER_SKY 1\n#define BRIDGE_MASTER_ENV 1\n#define SACR_K ${SACR_MASTER_K}\n#define SHADOW_K 2\n` + SCREEN_IN + VIEW + LIGHTS + ATMOSPHERE + ENVIRONMENT + SACR_SHADOW + SKY_SAMPLE + SKY_EVALUATION + SKY_DISC_DETAIL + SHOP_GLASS + BASE_CITY + `
void main() {
  if(uBaseProbe!=0){outColor=vec4(sampleSky(vUV).rgb,1.);return;}
  outColor=vec4(bridgeBase(uvWorld(vUV)),1.);
}`

export const RECEIVER_FRAG = PROLOG_300 + `#define SACR_K ${SACR_MASTER_K}\n#define SHADOW_K 2\n#define BRIDGE_MASTER_ENV 1\n` + `in vec2 vWorld; flat in vec3 vMaterial; out vec4 outColor;` + VIEW + LIGHTS + ATMOSPHERE + ENVIRONMENT + SACR_SHADOW + SHOP_GLASS + `
uniform sampler2D uBase;
uniform sampler2DArray uMaterial;
void main() {
  vec2 q=vWorld, uv=worldUV(q);
  int eave=cover(q);
  vec4 t=texture(uMaterial,vec3(vec2(q.x+uMood.z,q.y)/${MATERIAL_TILE}.,vMaterial.x));
  vec2 relief=(t.rg*2.-1.)*.92;
  vec3 N=normalize(vec3(relief.x+vMaterial.z,relief.y-.12,1.));
  vec4 art=texture(uBase,uv);
  if(art.a<.5)discard;
  vec3 albedo=toLinear(art.rgb);
  vec2 tc=envUV(q,false);
  vec4 e=envBasis(tc,insideEave(q,eave));
  vec3 steady=fixtureRadiance(tc);
  float contact,depth;vec2 traceP;bool raised;
  DirectLoss loss=receiverFace(q,e,steady,contact,depth,traceP,raised);
  bool topFace=vMaterial.y>1.5;
  vec3 normal=topFace?normalize(vec3(N.x,-N.z,-N.y)):normalize(vec3(N.x+vMaterial.z,N.y,-N.z));
  float rim=max(dot(N,uStormDir),0.)*(topFace?1.45:.70);
  vec3 lit=environmentLight(e,steady,.39+.61*max(dot(N,LUNAR_KEY),0.),stormAt(uv.x),rim,vec2(loss.moon,loss.practical))
    +shadowedCombat(q,traceP,e.b,loss,depth,normal);
  vec3 diffuse=albedo*lit*mix(.87,1.09,t.a)*contact;
  outColor=vec4(shopGlass(q,diffuse),1.);
}`

export const MOBILE_BASE_FRAG = PROLOG_300 + `#define BASE_MOBILE 1\n#define MASTER_SKY 0\n#define BRIDGE_MASTER_ENV 0\n#define SACR_K ${SACR_MOBILE_K}\n#define SHADOW_K 1\n` + SCREEN_IN + VIEW + LIGHTS + ATMOSPHERE + ENVIRONMENT + SACR_SHADOW + SKY_SAMPLE + SKY_EVALUATION + SKY_DISC_DETAIL + MOBILE_SURFACE_FLASH + SHOP_GLASS + BASE_CITY + `
void main() {
  if(uBaseProbe!=0){outColor=vec4(sampleSky(vUV).rgb,1.);return;}
  outColor=vec4(quantizationDither(bridgeBase(uvWorld(vUV))),1.);
}`
export const MOBILE_ACTORS_FRAG = PROLOG_300 + SCREEN_IN + VIEW + LIGHTS + `
uniform sampler2D uActors;
void main() {
  vec4 a=texture(uActors,vUV);
  if(a.a==0. && uFlashIDs.x<0) discard;
  vec2 q=uvWorld(vUV);
  vec3 glow=vec3(0.);
  for (int i=0;i<1;i++) {
    int index=i==0?uFlashIDs.x:uFlashIDs.y;
    if(index<0) break;
    vec4 src=uLights[index], e=uEnergy[index], dst=uShape[index];
    if(src.w!=3.)continue;
    float u=spanDist(q,src.xy,dst.xy)/max(1.,dst.z);
    float open=(1.-a.a)*(1.-a.a);
    vec2 emit=sectionEmitter(q,src,dst);
    if(open>.005)glow+=e.rgb*min(.24,e.w*.090)*exp(-u*u*.69)*open*transmits(q,emit)*sparkGate(q,emit,0.);
  }
  outColor=vec4(min(vec3(1.),(a.a>0.?toLinear(a.rgb)*a.a:vec3(0.))+glow),a.a);
}`

export const TRAIL_VERT = PROLOG_300 + VIEW + `
layout(location=0) in vec2 aWorld;
layout(location=1) in vec3 aRadiance;
out vec3 vRadiance;
void main(){ vRadiance=aRadiance; gl_Position=vec4(worldUV(aWorld)*2.-1.,0.,1.); }
`
export const TRAIL_FRAG = PROLOG_300 + `in vec3 vRadiance; out vec4 outColor;
void main(){outColor=vec4(vRadiance,0.);}`

export const EMISSION_FRAG = PROLOG_300 + `#define SACR_K ${SACR_MASTER_K}\n` + SCREEN_IN + VIEW + LIGHTS + `
uniform sampler2D uActors;
void main() {
  vec4 a=texture(uActors,vUV);
  vec2 q=uvWorld(vUV);
  vec3 emissive=vec3(0.);
  // HDR is injected explicitly. A white road marking, a UI glyph or a near
  // opaque metal panel never qualifies for the bloom extractor.
  bool canEmit=a.a<=.995&&inLightBox(q,uEmissionBounds);
  if(!canEmit&&a.a==0.)discard;
  // U5 — the wet deck mirrors admitted emission upward. Emissive capsules
  // in the receiver's own column, read through the same UBO, warm boots,
  // hem and blade spine from below. Bounded finite-source falloff over real
  // posed records — never a screen halo or a bloom substitute.
  vec3 bounce=vec3(0.);
  if(a.a>0.&&uWeather.y>.04){
    float groundY=${ROAD.lane}.;
    float height=1.-smoothstep(0.,110.,max(0.,groundY-q.y));
    if(height>0.){
      int col=sacrColumn(q.x);
      for(int slot=0;slot<SACR_K;slot++){
        int word=col*2+slot/4;
        uint bits=sacrWordLane(u_ColBins[word/4],word%4);
        uint id=(bits>>uint((slot%4)*8))&255u;
        if(id==0u||id>64u)break;
        uvec4 pr=u_PrimPool[int(id)-1];
        vec2 rZ=unpackHalf2x16(pr.z);
        if(rZ.x<0.)continue;          // arcs already paint their own return
        uint eQ=(pr.w>>21u)&31u;
        if(eQ==0u)continue;
        vec2 A=unpackHalf2x16(pr.x),B=unpackHalf2x16(pr.y);
        float ey=max(A.y,B.y);        // SACR metres, up positive
        if(ey<${((ROAD.lane - 150) / SACR_PX_PER_METER).toFixed(3)}||ey>${((ROAD.lane + 46) / SACR_PX_PER_METER).toFixed(3)})continue;
        vec2 v=B-A;
        float t=clamp(dot(q-A,v)/max(.000001,dot(v,v)),0.,1.);
        vec2 pc=A+v*t;
        float e=.25*(exp2(float(eQ)*.23)-1.);
        vec3 tint=vec3(float((pr.w>>6u)&31u),float((pr.w>>11u)&31u),float((pr.w>>16u)&31u))/31.;
        bounce+=tint*e*height*sectionFalloff(vec3(q-pc,0.),max(6.,rZ.x))*uWeather.y*.55;
      }
    }
  }
  if(canEmit)for(int i=0;i<MAX_L;i++) {
    if(i>=uCount) break;
    vec4 f=uLights[i], b=uEnergy[i], s=uShape[i];
    if(q.x<min(f.x,s.x)-s.z-10. || q.x>max(f.x,s.x)+s.z+10. ||
       q.y<min(f.y,s.y)-s.z-10. || q.y>max(f.y,s.y)+s.z+10. ) continue;
    if(f.w==4.)continue;
    float d;
    if(f.w==3.) d=spanDist(q,f.xy,s.xy)/max(s.z,.5);
    else if(f.w==0.) d=length(q-f.xy)/max(s.z,.5);
    else {
      vec2 p=q-f.xy; p.x=max(0.,abs(p.x)-s.z);
      d=length(p/vec2(1.35,f.w==1.?1.5:1.12));
    }
    float core=exp(-d*d*1.32), halo=exp(-d*d*.21)*.060;
    vec2 emit=sectionEmitter(q,f,s);
    float visible=(1.-a.a)*(1.-a.a)*transmits(q,emit);
    if(f.w==3.)visible*=sparkGate(q,emit,0.);
    float power=b.w*(f.w==1.?.42:f.w==3.?.84:.78);
    emissive+=mix(b.rgb,max(b.rgb,vec3(.46)),core*.16)*(core+halo)*power*visible;
  }
  outColor=vec4((a.a>0.?toLinear(a.rgb)*a.a:vec3(0.))+emissive+bounce,a.a);
}`

// Screen space -> section space is affine. Interpolate it over one
// triangle instead of recomputing the camera transform for every film pixel.
export const GRADE_VERT = `#version 300 es
precision highp float;
out vec2 vUV, vWorld;
${VIEW}
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p; vWorld = uvWorld(p);
  gl_Position = vec4(p*2.-1.,0.,1.);
}`

const gradeShader=(n:16|32)=>PROLOG_300 + `#define MASTER_GRADE ${n===32?1:0}
` + SCREEN_IN + `
in vec2 vWorld;
uniform sampler2D uScene, uBloom, uActors;
uniform vec4 uInkBox;
uniform vec4 uGradeCover[${BRIDGE_COVER_BUDGET}];
uniform int uGradeRoofs;
uniform highp sampler3D uTransit, uMarket, uIndustrial, uBoss;
uniform vec4 uLook; // biome, boss, fog, shelter
vec3 acesFilm(vec3 x) { return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 displayRGB(vec3 x) {
  return mix(12.92*x,1.055*pow(max(vec3(0.),x),vec3(1./2.4))-.055,step(vec3(.0031308),x));
}
vec3 lookVolume(highp sampler3D table, vec3 p) {
  // Texel centers reproduce the authoring lattice with one hardware lookup.
  return texture(table, (clamp(p,0.,1.)*${n - 1}.+.5)/${n}.).rgb;
}
void main() {
  vec3 hdr=texture(uScene,vUV).rgb;
  vec2 q=vWorld;
  // Literal opaque black in the Ronin region is authored display ink.
  // Respect overdraw: the actor input contains steel and near Canvas FX,
  // and the HDR scene can still contain a nearer rain streak or trail.
  bool ink=false;
  if(q.x>=uInkBox.x && q.y>=uInkBox.y && q.x<=uInkBox.z && q.y<=uInkBox.w){
    ink=all(equal(texelFetch(uActors,ivec2(gl_FragCoord.xy),0),vec4(0.,0.,0.,1.)));
    if(ink && all(equal(hdr,vec3(0.)))){outColor=vec4(0.,0.,0.,1.);return;}
  }
#if MASTER_GRADE
  if(!ink) hdr+=texture(uBloom,vUV).rgb*${BLOOM_GAIN};
#endif
  // Film falloff: broad shade at the edges, no softened scene copy. Keep
  // sheltered interiors open and protect the center where attacks read.
  vec2 edge=(vUV-vec2(.5,.54))*vec2(1.10,1.);
  float gloom=smoothstep(.15,.56,dot(edge,edge))*(1.-uLook.w*.49)*(.20+uLook.y*.058+uLook.z*.042);
  hdr*=1.-gloom;
  vec3 p=displayRGB(acesFilm(hdr*1.06));
  vec3 c;
  if(uLook.x<=0.) c=lookVolume(uTransit,p);
  else if(uLook.x==1.) c=lookVolume(uMarket,p);
  else if(uLook.x>=2.) c=lookVolume(uIndustrial,p);
  else if(uLook.x<1.) c=mix(lookVolume(uTransit,p),lookVolume(uMarket,p),uLook.x);
  else c=mix(lookVolume(uMarket,p),lookVolume(uIndustrial,p),uLook.x-1.);
  float peak=max(c.r,max(c.g,c.b));
  if(q.y>-303. && uGradeRoofs>0){
    float warmth=0.;
    for(int i=0;i<${BRIDGE_COVER_BUDGET};i++){
      if(i>=uGradeRoofs)break;
      vec4 s=uGradeCover[i];if(s.w<.5)continue;
      warmth=max(warmth,1.-smoothstep(0.,288.,max(s.x-q.x,q.x-s.y)));
    }
    c*=1.+vec3(.08,.025,-.05)*warmth*smoothstep(.036,.16,peak);
  }
  if(uLook.y>0.) {
    c=mix(c,lookVolume(uBoss,p),uLook.y*.35);
    float l=dot(c,vec3(.2126,.7152,.0722));
    float mid=smoothstep(.07,.24,l)*(1.-smoothstep(.68,.93,l))*uLook.y;
    c=mix(c,vec3(l),mid*.15);
    c*=1.+(l-.25)*mid*.19;
  }
  // Tiny split tone after the authored district look, with no additional
  // LUT or texture fetch. Steel stays neutral; only the ends separate.
  c*=mix(vec3(.954,.983,1.032),vec3(1.026,1.009,.979),smoothstep(.08,.78,peak));
  outColor=vec4(clamp(c,0.,1.),1.);
}`
export const GRADE_FRAG=gradeShader(32)
export const MOBILE_GRADE_FRAG=gradeShader(16)

// These instances carry no particle buffer. Stable cell/slot hashes supply
// an address; the interpolated world clock supplies a continuous trajectory.
// Rasterization stays in narrow strips/soft lobes rather than a screen pass.
export const WEATHER_VERT = PROLOG_300 + VIEW + `
uniform int uKind; // far, mid, near, or local motes
uniform uint uSeed, uStartCell;
uniform int uCells;
uniform vec3 uRain; // first cell's local x, intensity, wind
uniform float uTime, uRainTime;
uniform vec3 uWindPhase; // translated phase pair, reduced motion
uniform int uVentCount, uCount;
uniform vec3 uVents[${BRIDGE_VENT_BUDGET}];
uniform vec4 uLights[${BRIDGE_LIGHT_BUDGET}], uEnergy[${BRIDGE_LIGHT_BUDGET}];
${SACR_BLOCK}
uniform vec2 u_SacrView; // same section address the road evaluator uses
uint weatherLane(uvec4 q,int i){return i==0?q.x:i==1?q.y:i==2?q.z:q.w;}
out vec2 vWorld, vSt;
flat out vec4 vPaint;
flat out vec2 vFoot;
flat out int vMode;
uint hashStep(uint a) {
  a = (a ^ (a >> 16u)) * 2146121005u;
  a = (a ^ (a >> 15u)) * 2221713035u;
  return a ^ (a >> 16u);
}
float rand(uint x) { return float(hashStep(x) >> 8u) / 16777216.; }
const vec3 widths = vec3(${RAIN_PLANES.map(p => p.width).join(',')});
const vec3 gain = vec3(${RAIN_PLANES.map(p => p.gain).join(',')});
const vec3 base = vec3(${RAIN_PLANES.map(p => `${p.base}.`).join(',')});
const vec3 speed = vec3(${RAIN_PLANES.map(p => `${p.speed}.`).join(',')});
const vec3 len = vec3(${RAIN_PLANES.map(p => `${p.length}.`).join(',')});
const vec3 floors = vec3(${RAIN_PLANES.map(p => `${p.floor}.`).join(',')});
float rainLane(vec3 v,int i){return i==0?v.x:i==1?v.y:v.z;}
float gustAt(float source){
  float wave=${RAIN_GUST.a}*sin(source*${RAIN_GUST.x}+uWindPhase.x+uTime*${RAIN_GUST.first})
    +${RAIN_GUST.b}*sin(source*${RAIN_GUST.y}+uWindPhase.y-uTime*${RAIN_GUST.second});
  return uRain.z*${RAIN_GUST.base}+wave*(1.-uWindPhase.z);
}
void main() {
  vec2 st=vec2(float(gl_VertexID>>1),float(gl_VertexID&1));
  vSt=st;
  vMode=uKind;
  vec2 w;
  int id=gl_InstanceID;
  if(uKind<3) {
    int cell=id%uCells, sub=id/uCells;
    uint key=uSeed ^ ((uStartCell+uint(cell))*1779033703u+uint(sub)*2654435761u+uint(uKind)*397u);
    float a=rand(key), b=rand(key+1u), c=rand(key+2u);
    float fall=mod(a*${RAIN_HEIGHT}.+uRainTime*(rainLane(base,uKind)+b*rainLane(speed,uKind)),${RAIN_HEIGHT}.);
    float squall=smoothstep(.29,.92,uRain.y);
    float source=uRain.x+(float(cell)+c)*${RAIN_CELL}.;
    float drift=gustAt(source)*(.39+.18*squall);
    vFoot=vec2(source+(fall-${RAIN_HEIGHT * .5}.)*drift, rainLane(floors,uKind)-${RAIN_HEIGHT}.+fall);
    float lengthY=rainLane(len,uKind)*(.73+.88*b)*(.60+.74*squall);
    // Fade both ends of a fall before its seeded wrap; no teleport streak.
    float life=smoothstep(0.,19.,fall)*(1.-smoothstep(${RAIN_HEIGHT - 10}.,${RAIN_HEIGHT}.,fall));
    float wide=max(rainLane(widths,uKind),1.18/uCam.y);
    w=vFoot+vec2((st.x-.5)*wide-(1.-st.y)*lengthY*drift,(st.y-1.)*lengthY);
    vec3 rgb=mix(vec3(.26,.30,.34),vec3(.51,.56,.61),float(uKind)*.42);
    float admit=1.-smoothstep(.44+.49*squall,.53+.50*squall,c);
    vPaint=vec4(rgb,uRain.y*rainLane(gain,uKind)*life*admit*(.61+b*.39));
    // U4 — O(1) rain/actor contact. The mid plane shares the actor lane, so
    // one shadow-bin column at the drop's section X answers "which posed
    // capsule is under this foot" without any CPU AABB pass. A foot that
    // lands on a fighter's surface becomes a small crown pinned there.
    if(uKind==1&&uRain.y>.025){
      float sx=vFoot.x*(1./${SACR_PX_PER_METER}.)+u_SacrView.x;
      int col=clamp(int(floor(sx*80./max(.001,u_SacrView.y))),0,79);
      for(int slot=0;slot<${SACR_MASTER_K};slot++){
        int word=col*2+slot/4;
        uint bits=weatherLane(u_ColBins[word/4],word%4);
        uint id=(bits>>uint((slot%4)*8))&255u;
        if(id==0u||id>64u)break;
        uvec4 pr=u_PrimPool[int(id)-1];
        uint m=pr.w;
        vec2 rZ=unpackHalf2x16(pr.z);
        // Arcs are emission, slabs are eaves the cover test already owns;
        // only posed opaque fighters catch drops.
        if(rZ.x<0.||((m>>21u)&31u)!=0u||(m>>26u)==${SACR_SOLID_ID}u)continue;
        if(rZ.y<1.2||rZ.y>5.8)continue;
        vec2 A=unpackHalf2x16(pr.x),B=unpackHalf2x16(pr.y);
        float top=max(A.y,B.y)+rZ.x;          // highest surface, SACR metres
        float hitY=-top*${SACR_PX_PER_METER}.; // same surface, world px (y down)
        float lo=min(A.x,B.x)-rZ.x,hi=max(A.x,B.x)+rZ.x;
        if(sx<lo||sx>hi||vFoot.y<hitY||vFoot.y>hitY+30.)continue;
        vMode=5;
        vFoot=vec2(vFoot.x,hitY);
        w=vec2(vFoot.x,hitY-7.)+vec2((st.x-.5)*11.,(st.y-.5)*14.);
        vPaint=vec4(vec3(.60,.66,.72),uRain.y*(.42+.30*rand(key+3u)));
        break;
      }
    }
  } else {
    // Up to twelve glowing motes per vent and three brief sparks per impulse.
    // Sparks are only visible in the source's covered/exposed column.
    uint key=uSeed+uint(id)*31887029u;
    float a=rand(key), b=rand(key+1u), c=rand(key+2u);
    float f=fract(uTime*(.91+.61*a)+c), extent=2.+b*2.8;
    if(id<${BRIDGE_VENT_BUDGET * 12}) {
      int vent=id/12;
      if(vent>=uVentCount){ gl_Position=vec4(3.,3.,0.,1.); return; }
      vec3 p=uVents[vent];
      vFoot=p.xy;
      w=p.xy+vec2((a-.5)*22.*f+f*f*(5.+gustAt(p.x)*33.),-f*(28.+52.*b))+(st-.5)*extent;
      vec3 rgb=p.z>1.5 ? vec3(.46,.49,.52) : vec3(.57,.47,.38);
      vPaint=vec4(rgb,sin(f*3.141593)*(.24+.32*p.z/2.)*(.41+.59*a));
    } else {
      int light=(id-${BRIDGE_VENT_BUDGET * 12})/3;
      if(light>=uCount||uLights[light].w!=3.){ gl_Position=vec4(3.,3.,0.,1.); return; }
      vec4 l=uLights[light]; vec4 energy=uEnergy[light];
      vFoot=l.xy;
      float r=f*f*(8.+32.*b);
      w=l.xy+vec2(cos(a*6.283),sin(a*6.283))*r+(st-.5)*extent;
      vPaint=vec4(energy.rgb*energy.w, sin(f*3.141593)*.74);
    }
  }
  vWorld=w;
  gl_Position=vec4(worldUV(w)*2.-1.,0.,1.);
}`

export const WEATHER_FRAG = PROLOG_300 + LIGHTS + `
in vec2 vWorld, vSt;
flat in vec4 vPaint;
flat in vec2 vFoot;
flat in int vMode;
out vec4 outColor;
void main(){
  int eave=cover(vWorld);
  if(vMode<3 ? eave>=0 || cover(vFoot)>=0 : eave!=cover(vFoot)) discard;
  float edge;
  if(vMode<3) edge=(1.-smoothstep(.04,.5,abs(vSt.x-.5)))*vSt.y*vSt.y;
  else edge=1.-smoothstep(.02,.50,length(vSt-.5));
  float a=edge*vPaint.a;
  vec3 color=vPaint.rgb;
  if((vMode<3||vMode==5)&&a>.015&&inLightBox(vWorld,uWeatherBounds))for(int i=0;i<MAX_L;i++){
    if(i>=uCount)break;
    vec4 l=uLights[i];
    if(l.w!=1.&&l.w!=4.&&l.w!=3.)continue;
    float k=receivedLight(vWorld,vWorld,l,uShape[i]);
    if(k>.0&&l.w==3.)k*=sparkGate(vWorld,sectionEmitter(vWorld,l,uShape[i]),0.);
    if(k>.0){vec3 L=normalize(vec3(l.xy-vWorld,-64.));color+=uEnergy[i].rgb*(k*pow(max(-L.z,0.),4.)*1.6);}
  }
  outColor=vec4(color*a,a);
}`
