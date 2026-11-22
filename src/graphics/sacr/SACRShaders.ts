import { SACR_SHADOW } from './SACRShadow'
export { SACR_BLOCK } from './SACRBlock'
import { ATMOSPHERE, ENVIRONMENT, MOBILE_SURFACE_FLASH, SKY_SAMPLE } from '../../gpu/bridge-lighting-shaders'
import { LIGHTS, PROLOG_300, SCREEN_IN, VIEW } from '../../gpu/bridge-shaders'
import { DECK_MASK_H, MATERIAL_TILE, PUDDLE_PITCH } from '../../game/stage/bridge-material'
import { ROAD_WATER_GLSL } from '../../game/stage/bridge-road-water'
import { BRIDGE_LANDINGS } from '../../game/render/bridge-frame'
import { ROAD } from '../../game/stage/road-section'
import { SACR_ACTOR_Z, SACR_CURB_Z, SACR_NEAR_Z } from './SACRMath'
import { SACR_BAR_DEPTH_MULTIPLIER, SACR_DILATION, SACR_MASTER_K, SACR_MOBILE_K, SACR_PX_PER_METER, SACR_SOLID_ID } from './SACRPacker'
import { STRATUM_CURB_HEIGHT, STRATUM_H, STRATUM_MAX_LOD, STRATUM_W } from './SACRAtlas'

const EVALUATOR = `
uniform sampler2D u_StratumB;
uniform float u_CamWorldX, u_StratumOriginX, u_StratumWidthMeters;
uniform float u_StratumReady;
uniform float u_CurbZ;
const float SACR_PI=3.141592653589793;
struct SACRReturn { vec3 reflection; vec3 skyReturn; vec3 emissive; float ao; float opacity; float portal; float portalV; vec3 background; float underside; float skyTrans; };
uint columnID(int col,int slot) {
  int word=col*2+slot/4;
  uint packedWord=wordLane(u_ColBins[word/4],word%4);
  return (packedWord >> uint((slot%4)*8)) & 255u;
}
vec4 unpackUnorm4x8_ES30(uint p) {
  return vec4(float(p&255u),float((p>>8u)&255u),float((p>>16u)&255u),float(p>>24u))/255.;
}
float lightEnergy(uint q){return .25*(exp2(float(q)*.23)-1.);}
float atlasV(float h,bool interior,float lod) {
  float lo=interior?.5:0.;
  float inset=.5*exp2(ceil(lod))/${STRATUM_H}.;
  return clamp(lo+mix(.004,.496,clamp(h,0.,1.)),lo+inset,lo+.5-inset);
}
vec3 stratumB(vec3 P,vec3 ray,float lod,out float kind,out float sampleV) {
  vec3 pCurb=P+ray*(max(0.,u_CurbZ-P.z)/max(.001,ray.z));
  float xCurbWorld=pCurb.x+u_CamWorldX;
  float at=xCurbWorld-u_StratumOriginX;
  kind=0.; sampleV=atlasV(pCurb.y/${STRATUM_CURB_HEIGHT},false,lod);
  if(u_StratumReady<.5||at<0.||at>=u_StratumWidthMeters)return vec3(.021,.023,.026);
  for(int i=0;i<32;i++) {
    uvec4 a=u_ArchProfile[i];
    if(a.y<=a.x) break;
    float l=float(a.x)*.001,r=float(a.y)*.001;
    if(at<l||at>=r) continue;
    vec2 bay=unpackHalf2x16(a.z);
    if(bay.x<=0.||pCurb.y<0.||pCurb.y>=bay.y) break;
    vec3 back=pCurb+ray*(bay.x/max(.001,ray.z));
    float backX=(back.x+u_CamWorldX)-u_StratumOriginX;
    if(back.y>=bay.y||backX<l||backX>=r) {
      kind=2.; sampleV=-1.;
      return unpackUnorm4x8_ES30(a.w).rgb;
    }
    kind=1.; sampleV=atlasV(back.y/bay.y,true,lod);
    return textureLod(u_StratumB,vec2(backX/u_StratumWidthMeters,sampleV),lod).rgb;
  }
  vec2 uv=vec2(at/u_StratumWidthMeters,sampleV);
  return textureLod(u_StratumB,uv,lod).rgb;
}
float arcDistance(vec2 d,float R,vec2 m,float halfTheta) {
  float r=length(d);
  if(r<.00001) return R-r;
  m=normalize(m);
  float c=cos(halfTheta);
  if(dot(d,m)>=r*c) return abs(r-R);
  vec2 n=vec2(-m.y,m.x);
  float side=dot(d,n)<0.?-1.:1.;
  return length(d-R*(m*c+n*(side*sin(halfTheta))));
}
vec2 undersideHit(vec3 p,vec3 ray,vec2 A,float right,vec2 rZ,float depth){
  float rz=max(.001,ray.z), ry=max(.001,ray.y);
  float lo=max(0.,max((rZ.y-p.z)/rz,(A.y-rZ.x-p.y)/ry));
  float hi=min((rZ.y+depth-p.z)/rz,(A.y+rZ.x-p.y)/ry);
  if(lo>hi)return vec2(1e4,1e4);
  float x0=p.x+clamp(ray.x*lo,-${SACR_DILATION},${SACR_DILATION});
  float x1=p.x+clamp(ray.x*hi,-${SACR_DILATION},${SACR_DILATION});
  float d=max(A.x-max(x0,x1),min(x0,x1)-right);
  float crossX=x0<A.x&&ray.x>0.?(A.x-p.x)/ray.x:x0>right&&ray.x<0.?(right-p.x)/ray.x:lo;
  return vec2(d,p.z+clamp(crossX,lo,hi)*rz);
}
vec3 capsuleTint(uint m){return vec3(float((m>>6u)&31u),float((m>>11u)&31u),float((m>>16u)&31u))/31.;}
SACRReturn evaluateSACR_v40(vec3 P,vec3 ray,float rough,float wet,float lod,vec3 sky) {
  SACRReturn o;
  o.ao=soleAO(P); o.reflection=vec3(0.); o.skyReturn=vec3(0.); o.emissive=vec3(0.); o.opacity=0.;
  o.portal=0.; o.portalV=0.; o.background=vec3(0.); o.underside=0.; o.skyTrans=0.;
  if(wet<.04) return o;
  o.background=stratumB(P,ray,lod,o.portal,o.portalV);
  // In normal frames sky contribution fades at a portal. Probe sky is zero.
  vec3 background=o.background+(o.portal==0.?sky:vec3(0.));
  vec3 slab=vec3(0.); float stopZ=1e4, edge=.026+rough*rough*.18;
  uint IDs[SACR_K]; float alphas[SACR_K]; vec3 colors[SACR_K];
  int groups=0, col=int(floor(P.x*80./u_SacrView.y));
  if(col>=0 && col<80) for(int slot=0;slot<SACR_K;slot++) {
    uint id=columnID(col,slot);
    if(id==0u||id>64u) break;
    uvec4 a=u_PrimPool[int(id)-1];
    vec2 rZ=unpackHalf2x16(a.z), A=unpackHalf2x16(a.x), B=unpackHalf2x16(a.y);
    uint m=a.w;
    if(rZ.x>=0. && (m>>26u)==${SACR_SOLID_ID}u && ((m>>21u)&31u)==0u){
      vec2 hit=undersideHit(P,ray,A,B.x,rZ,float(m&63u)*.02*${SACR_BAR_DEPTH_MULTIPLIER}.);
      float a=1.-smoothstep(0.,edge,hit.x);
      if(a>o.underside || (a>0.&&a==o.underside&&hit.y<stopZ)){
        o.underside=a; stopZ=hit.y; slab=pow(capsuleTint(m),vec3(2.2));
      }
      continue;
    }
    float dz=rZ.y-P.z;
    if(dz<-.001 || (o.underside==1.&&rZ.y>stopZ)) continue;
    float dt=max(0.,dz)/max(.001,ray.z);
    vec2 p_i=P.xy+vec2(clamp(ray.x*dt,-${SACR_DILATION},${SACR_DILATION}),ray.y*dt);
    float d, e;
    vec3 tint;
    uint charID=0u;
    if(rZ.x<0.) {
      float theta=float((m>>6u)&255u)*SACR_PI/255.;
      d=arcDistance(p_i-A,-rZ.x,B,theta)-float(m&63u)*.01;
      tint=vec3(float((m>>14u)&15u)/15.,float((m>>18u)&31u)/31.,float((m>>23u)&15u)/15.);
      e=lightEnergy(m>>27u);
    } else {
      d=capsuleDistance(p_i,A,B,rZ.x,float(m&63u)*.02);
      tint=capsuleTint(m);
      e=lightEnergy((m>>21u)&31u);
      charID=m>>26u;
    }
    float raw=(1.-smoothstep(0.,edge,d))*(rZ.y>stopZ?1.-o.underside:1.);
    if(raw<=0.) continue;
    vec3 rgb=pow(tint,vec3(2.2));
    if(e>0.) { o.emissive+=rgb*(raw*e); continue; }
    int at=groups;
    for(int j=0;j<SACR_K;j++) {
      if(j>=groups) break;
      if(IDs[j]==charID){at=j;break;}
    }
    if(at==groups){IDs[at]=charID; alphas[at]=raw; colors[at]=rgb; groups++;}
    else if(raw>alphas[at]){alphas[at]=raw; colors[at]=rgb;}
  }
  float trans=1.; vec3 c=vec3(0.);
  for(int i=0;i<SACR_K;i++) {
    if(i>=groups) break;
    c+=colors[i]*alphas[i]*trans;
    trans*=1.-alphas[i];
  }
  float ndv=clamp(ray.y/max(.001,length(ray)),0.,1.);
  float gain=clamp(wet,0.,1.)*(.18+.64*pow(1.-ndv,3.))*(1.-.38*rough);
  o.opacity=1.-trans*(1.-o.underside);
  o.skyTrans=o.portal==0.?1.-o.opacity:0.;
  o.reflection=(c+o.emissive+mix(background,slab,o.underside)*trans)*gain;
  o.skyReturn=sky*o.skyTrans*gain;
  return o;
}
`

const ULTRA_SURFACE = `
#if !SACR_MOBILE
float waterLod(float rough){return .19+5.6*rough*rough;}
// Bounded, long-tailed lobe; broad on aggregate, narrow on the water film.
// Lobe height is kept finite so a subpixel normal cannot produce fireflies.
float roadGloss(float noH,float rough){
  float width=.014+.21*rough*rough;
  float h=width/(width+max(0.,1.-noH*noH));
  return h*h;
}
#endif
`

/** These requests are enabled only by the opt-in driver test. They run
 * through the same evaluator, block and sampler that paint the live road. */
const PROBES = `
uniform int u_SacrProbe;
vec4 sacrProbe() {
#if !SACR_MOBILE
  if(u_SacrProbe==9){
    // Same opaque capsule, same ray angle. Only separation and emitter
    // aperture change; measure both shoulders and the retained dark core.
    float gap=vUV.y<.5?.24:2.;
    vec3 P=vec3(8.+mix(-.56,.56,vUV.x),.54,${SACR_ACTOR_Z.toFixed(3)}-gap);
    return vec4(traceProjectedCapsules(P,vec3(0.,0.,1.),.028),
      traceProjectedCapsules(P,vec3(0.,0.,1.),.092),shadowSpread(gap,.092),1.);
  }
  if(u_SacrProbe==10){
    float moisture=vUV.y<.25?0.:vUV.y<.5?.35:.92;
    RoadWater w=roadWater(moisture,vUV.x,.58,vUV.y>=.75);
    return vec4(w.rough,w.traceWet,roadDiffuse(w),roadGloss(.92,w.rough));
  }
#endif
  if(u_SacrProbe==6) return vec4(sampleSky(vUV).rgb,1.); // same cache address as the sky/base probe
  if(u_SacrProbe==7){
    bool blocked=vUV.y>.5;
    vec2 q=vec2(0.);
    vec2 tc=envUV(q,true);
    vec4 env=envBasis(tc,blocked);
    vec3 steady=blocked?vec3(0.):fixtureRadiance(tc);
    // Two opposite ray directions converge on the same opaque spine from
    // distinct road points. The dry, fully baked umbra gets no extra ink.
    // The decoded octahedral lanes have x/z = +1 and -1. At one
    // metre from the caster plane, 7 and 9 both hit the centre at 8.
    float x=vUV.x<.25?7.:vUV.x<.5?8.:vUV.x<.75?9.:11.;
    vec3 P=vec3(x,0.,2.4);
    DirectLoss s=receiverShadows(P,q,q,env,steady);
    return vec4(s.practical,soleAO(P),s.moon,1.);
  }
  if(u_SacrProbe==8){
    vec2 q=vec2(0.); vec3 e=fixtureRadiance(envUV(q,true));
    float x=vUV.x>.5?2.4:0.;
    return vec4(transmits(vec2(x,0.),vec2(x,-3.2)),e);
  }
  bool right=vUV.x>.5;
  if(u_SacrProbe==1) {
    SACRReturn o=evaluateSACR_v40(vec3(right?7.:2.,0.,1.5),vec3(0.,1.,1.),.45,0.,0.,vec3(0.));
    return vec4(o.ao,o.opacity,o.emissive.r,1.);
  }
  if(u_SacrProbe==2) {
    SACRReturn o=evaluateSACR_v40(vec3(4.,right?.000001:0.,1.5),vec3(0.,1.,1.),.45,1.,0.,vec3(0.));
    return vec4(o.emissive/32.,o.opacity);
  }
  if(u_SacrProbe==3) {
    bool outside=vUV.x<.25, top=vUV.y>.5;
    vec3 p=vec3(outside?16.:4.,0.,right?u_CurbZ-.75:u_CurbZ-4.);
    vec3 ray=vec3(0.,outside?(top?1.:0.):right?2.:.375,1.);
    // Test base and trilinear; the exterior column proves ground-up V.
    float lod=top?2.75:0.;
    SACRReturn o=evaluateSACR_v40(p,ray,.45,1.,lod,vec3(0.));
    return vec4(o.background.rg,max(0.,o.portalV),o.portal*.5);
  }
  if(u_SacrProbe==5) {
    vec3 sky=vec3(.54,.62,.79);
    SACRReturn o=evaluateSACR_v40(vec3(right?12.:4.,0.,1.5),vec3(0.,vUV.y>.5?.08:1.,1.),.45,1.,0.,sky);
    return vec4(o.reflection.r*.38,o.emissive.r/32.,o.underside,o.skyTrans);
  }
  SACRReturn o=evaluateSACR_v40(vec3(right?12.:3.,0.,1.5),vec3(0.,1.,1.),.45,1.,0.,vec3(0.));
  return vec4(o.emissive/32.,o.opacity);
}
`

function roadShader(mobile: boolean) {
  return PROLOG_300 + `#define SACR_K ${mobile ? SACR_MOBILE_K : SACR_MASTER_K}\n#define SHADOW_K ${mobile ? 1 : 2}\n#define SACR_MOBILE ${mobile ? 1 : 0}\n#define BRIDGE_MASTER_ENV ${mobile ? 0 : 1}\n` +
    (mobile ? 'in vec2 vUV; layout(location=0) out vec4 outColor; layout(location=1) out vec4 outDirect;\n' : SCREEN_IN) +
    VIEW + LIGHTS + ATMOSPHERE + ENVIRONMENT + SACR_SHADOW + SKY_SAMPLE + EVALUATOR + ROAD_WATER_GLSL + ULTRA_SURFACE + PROBES + `
uniform sampler2D uBase, uDeckMask, uRipple;
uniform sampler2DArray uMaterial;
#if !SACR_MOBILE
vec2 rippleXY(vec2 uv){return texture(uRipple,uv).rg;}
uniform vec4 uLandings[${BRIDGE_LANDINGS}];
uniform int uLandingCount;
#endif
void main() {
  if(u_SacrProbe!=0){outColor=sacrProbe();return;}
  vec2 uv=vUV;
  vec2 q=uvWorld(uv);
  float y=clamp(q.y,${ROAD.rear}.,${ROAD.front}.);
#if !SACR_MOBILE
  if(q.y<${ROAD.rear}.||q.y>${ROAD.front}.) discard;
#endif
  float frac=(y+${-ROAD.rear}.)/${DECK_MASK_H}.;
  float z=mix(u_CurbZ,${SACR_NEAR_Z},frac);
  bool inside=cover(q)>=0;
  vec4 m=texture(uDeckMask,vec2((q.x+uMood.w)/${PUDDLE_PITCH}.,frac));
#if SACR_MOBILE
  RoadWater water=roadWater(uWeather.y,m.b,m.g,inside);
#else
  vec4 t=texture(uMaterial,vec3(vec2(q.x+uMood.z-.37*y,y*1.4)/${MATERIAL_TILE}.,inside?1.:0.));
  RoadWater water=roadWater(uWeather.y,m.b,mix(m.g,t.b,.30),inside);
#endif
  float wet=water.traceWet,rough=water.rough;
  vec2 p=vec2(q.x/${SACR_PX_PER_METER}.+u_SacrView.x,0.);
  vec3 P=vec3(p,z);
  vec3 C=vec3(u_SacrView.x,max(.8,-uCam.x/${SACR_PX_PER_METER}.),0.);
  vec2 tc=envUV(vec2(q.x,y),true);
  vec4 envM=envBasis(tc,inside);
  vec3 practical=fixtureRadiance(tc);
  vec2 traceP=vec2(q.x,y*.56);
  DirectLoss loss=receiverShadows(P,q,traceP,envM,practical);
  vec2 perturb=vec2(0.);
  float lod=2.;
  if(wet>=.04){
#if SACR_MOBILE
    float wave=sin((q.x+uMood.w)*(6.2831853/${PUDDLE_PITCH}.)*4.+y*.13-uWeather.x*2.8)*.075;
    perturb=vec2(wave,wave*.11);
    lod=1.35+rough*1.10;
#else
    vec2 tex=vec2((q.x+uMood.w)/${PUDDLE_PITCH}.*3.,y*.043);
    perturb=(rippleXY(tex+uWeather.x*vec2(.09,-.13))*2.-1.)*.14;
    perturb+=(rippleXY(tex*2.+uWeather.x*vec2(-.16,.11))*2.-1.)*.060;
    for(int i=0;i<${BRIDGE_LANDINGS};i++){
      if(i>=uLandingCount) break;
      vec4 a=uLandings[i]; vec2 d=P.xz-a.xy;
      float l=length(d), t=l-a.z*3.8;
      perturb+=d/max(.01,l)*sin(t*39.)*exp(-t*t*25.)*(1.-a.z/.36)*a.w*.16;
    }
    lod=waterLod(rough);
#endif
  }
  // The side-scroller uses an orthographic X slice. C supplies elevation
  // and depth; any horizontal bending is explicitly limited by the bins.
  float lean=clamp((P.x-C.x)*.10,-.63,.63);
  float elevation=C.y/max(.1,P.z);
  vec3 ray=vec3(lean+perturb.x,max(.045,elevation+perturb.y),1.);
  vec2 st=reflectedSkyUV(.5+q.x*uCam.y/uView.x+perturb.x*.16,ray.y);
  vec3 sky=vec3(0.);
  if(wet>=.04)sky=(uSkyView.y>.5?sampleSky(st).rgb:vec3(.026,.030,.036))*.61;
  SACRReturn o=evaluateSACR_v40(P,ray,rough,wet,clamp(lod,0.,${STRATUM_MAX_LOD}.),sky);
  // Only the incident sky term is occluded. Local, emissive and posed
  // specular returns are not modulated by asphalt diffuse shadow coverage.
  vec3 reflected=o.reflection+(skyCast(loss.moon,envM)-1.)*o.skyReturn;
#if SACR_MOBILE
  outColor=vec4(clamp(reflected,0.,1.),o.ao);
  outDirect=vec4(loss.moon,loss.practical,loss.combat,1.);
#else
  // Match the view geometry used by SACR. Suppress the dry aggregate
  // normals as water fills its pores; keep real wave and landing normals.
  float traceFade=smoothstep(.04,.115,wet);
  float grain=mix(mix(.78,.40,water.film),.095,water.pool);
  vec2 relief=(t.rg*2.-1.)*grain+perturb*(.64*traceFade);
  vec3 N=normalize(vec3(relief,1.));
  vec3 V=normalize(vec3(-lean,1.,elevation));
  vec3 moon=vec3(LUNAR_KEY.x,-LUNAR_KEY.z,-LUNAR_KEY.y);
  vec3 storm=vec3(uStormDir.x,-uStormDir.z,-uStormDir.y);
  float rim=.53+.48*max(dot(N,storm),0.);
  vec3 lit=environmentLight(envM,practical,.74+.26*max(dot(N,moon),0.),stormAt(uv.x),rim,vec2(loss.moon,loss.practical));
  vec3 spec=vec3(0.);
  float depth=(z-${SACR_ACTOR_Z})*${SACR_PX_PER_METER}.;
  // One visibility walk supplies both the diffuse and specular lobes of
  // this incident source. Its shadow cannot subtract another light's lobe.
  if(inLightBox(traceP,uDirectBounds))for(int i=0;i<MAX_L;i++) {
    if(i>=uCount)break;
    vec4 a=uLights[i];
    if(a.w==1.||a.w==2.)continue;
    vec3 L;
    float v=receivedLight(q,traceP,a,uShape[i],depth,L);
    if(v<=0.)continue;
    vec3 I=vec3(L.x,-L.z,-L.y);
    vec3 flux=uEnergy[i].rgb*(v*uEnergy[i].w*envM.b*combatVisibility(loss,i));
    lit+=flux*(faceLight(N,I)*(a.w==3.?.68:.48));
    if(a.w!=3.&&a.w!=4.)continue;
    vec3 H=I+V;
    H*=inversesqrt(max(.00001,dot(H,H)));
    spec+=flux*(max(0.,dot(N,I))*roadGloss(max(0.,dot(N,H)),rough)*(.035+.10*water.film+.16*water.pool));
  }
  // The unresolved sky/fixture directions supply a low-frequency sheen
  // on damp stone, not the old repeated screen-thin sine stripes. Pools
  // exchange that sheen for the sharper depth/portal-aware return above.
  float noV=max(0.,dot(N,V));
  float grazing=pow(1.-mix(V.z,noV,.22),3.);
  spec+=roadFilmLight(water,envM.b*mix(.62,1.,m.r),envM.g,practical*(1.-loss.practical*.86),grazing);
  spec*=.30/max(.30,max(spec.r,max(spec.g,spec.b)));
  vec3 albedo=toLinear(texture(uBase,uv).rgb);
  vec3 bounce=min(o.reflection*traceFade,vec3(.22))*(wet*.12);
  vec3 diffuse=albedo*(lit+bounce)*mix(.79,1.06,inside?t.a:m.r)*roadDiffuse(water);
  outColor=vec4(applyBridgeLayers(diffuse,spec,reflected*traceFade,o.ao),1.);
#endif
}`
}

export const SACR_ROAD_FRAG = roadShader(false)
export const SACR_MOBILE_FRAG = roadShader(true)
export const SACR_MOBILE_RESOLVE_FRAG = PROLOG_300 + '#define BRIDGE_MASTER_ENV 0\n' + SCREEN_IN + VIEW + LIGHTS + ATMOSPHERE + ENVIRONMENT + MOBILE_SURFACE_FLASH + ROAD_WATER_GLSL + `
uniform sampler2D uBase, uRoadHalf, uRoadVisibility, uDeckMask;
void main(){
  vec2 q=uvWorld(vUV);
  if(q.y<${ROAD.rear}.||q.y>${ROAD.front}.) discard;
  vec4 a=texture(uRoadHalf,vUV);
  float frac=(q.y+${-ROAD.rear}.)/${DECK_MASK_H}.;
  float z=mix(${SACR_CURB_Z},${SACR_NEAR_Z},frac);
  vec4 mask=texture(uDeckMask,vec2((q.x+uMood.w)/${PUDDLE_PITCH}.,frac));
  int eave=cover(q);
  bool dry=eave>=0;
  vec2 tc=envUV(q,true);
  vec4 e=envBasis(tc,dry);
  vec3 loss=texture(uRoadVisibility,vUV).rgb;
  vec3 practical=fixtureRadiance(tc);
  vec3 light=environmentLight(e,practical,.89,stormAt(vUV.x),.63,loss.xy)
    +mobileImpulseDiffuse(q,vec2(q.x,q.y*.56),e.b,(z-${SACR_ACTOR_Z})*${SACR_PX_PER_METER}.,vec3(0.,-1.,0.))*(1.-loss.z*.82);
  RoadWater water=roadWater(uWeather.y,mask.b,mask.g,dry);
  vec3 base=toLinear(texture(uBase,vUV).rgb)*light*mix(.79,1.06,dry?.86:mask.r)*roadDiffuse(water);
  float elevation=max(.8,-uCam.x/${SACR_PX_PER_METER}.)/z;
  float grazing=pow(1.-mix(elevation,1.,.22)*inversesqrt(1.+elevation*elevation),3.);
  vec3 spec=roadFilmLight(water,e.b*mix(.62,1.,mask.r),e.g,practical*(1.-loss.y*.86),grazing);
  outColor=vec4(clamp(quantizationDither(applyBridgeLayers(base,spec,dry?vec3(0.):a.rgb,a.a)),0.,1.),1.);
}`
