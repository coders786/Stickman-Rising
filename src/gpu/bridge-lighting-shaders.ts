import { ENV_BOTTOM, ENV_TOP, ENV_H, LIGHT_H, GROUND_H } from '../graphics/bridge/EnvBasis'
import { MOON_KEY } from '../graphics/bridge/NoirGeometry'
import { ROAD } from '../game/stage/road-section'
import { CLOUD_ATLAS_H, CLOUD_H, CLOUD_PHASE_H, CLOUD_PHASE_ROW, CLOUD_PHASE_W, CLOUD_W, HORIZON_H, HORIZON_SECTORS, MOON_UV_SCALE } from '../graphics/bridge/SkyBasis'
import { AIR_FLASH, BANK_TINT, CIRRUS_TINT, FLASH_TINT, LUNAR_TAPS, LUNAR_TINT, MIST_HEIGHT, MOON_DETAIL_FULL_R2, MOON_DETAIL_R2, SKY_CACHE_CEILING, SKY_HORIZON_V } from '../graphics/bridge/SkyOptics'

const glNumber = (x: number) => Number.isInteger(x) ? `${x}.` : `${x}`
const glVector = (v: readonly number[]) => `vec${v.length}(${v.map(glNumber).join(',')})`

/** Inline ES 3.00 snippets shared by the live programs. Atmosphere is
 * linear radiance all the way from the micro target to grade / SACR. */
export const ATMOSPHERE = `
uniform vec4 uAtmo; // integrated lunar flux, storm impulse, sweep phase, fixture flicker
uniform vec4 uAir;  // elevation span, aerosol density, cloud cover, mist floor
uniform vec2 uStorm; // sheet epicentre, horizontal inverse optical extent
uniform vec3 uHazeColor, uLunarShift;
float skyCacheScale(){return uAir.x/max(uAir.x,${SKY_CACHE_CEILING});}
float stormAt(float u){float x=max(0.,1.-abs(u-uStorm.x)*uStorm.y);return uAtmo.y*x*x;}
vec3 mistSource(float u){return uHazeColor*1.12+${glVector(AIR_FLASH)}*.43*stormAt(u);}
`
export const SKY_SAMPLE = `
uniform sampler2D u_StratumA;
uniform vec2 uSkyView; // reserved x, live asset ready
vec4 sampleSky(vec2 uv) {
  vec4 s=texture(u_StratumA,clamp(uv*vec2(1.,skyCacheScale()),vec2(0.),vec2(1.)));
#if !BRIDGE_MASTER_ENV
  // Compand only radiance in Mobile RGBA8. Mist opacity stays linear.
  s.rgb*=s.rgb;
#endif
  return s;
}
// Map a reflected ray into the same optical elevation as the visible sky,
// not into a fraction of the current (portrait or landscape) viewport.
vec2 reflectedSkyUV(float horizontal,float slope){return vec2(horizontal,${SKY_HORIZON_V}+(.035+.82*atan(slope))/max(.001,uAir.x));}
`

export const SKY_EVALUATION = `
uniform sampler2D uCloudBasis, uLunarBasis, uHorizonBasis;
uniform vec4 uCirrus, uBank, uMist, uLunar, uCloudPhase;
uniform vec2 uStars, uLunarTurn;
uniform vec3 uLunarSun;
uniform float uSkySector, uPhaseEnergy, uLunarAA;
const vec3 LUNAR_TINT=${glVector(LUNAR_TINT)};
vec4 deck(vec4 map,vec2 uv,float layer){
  const float h=${CLOUD_H}., total=${CLOUD_ATLAS_H}.;
  vec2 st=map.xz+uv*map.yw;
  return texture(uCloudBasis,vec2(st.x,(h*layer+.5+clamp(st.y,0.,1.)*(h-1.))/total));
}
vec4 evolvingDeck(vec4 map,vec2 uv,float layer,vec2 phase){
  vec2 st=map.xz+uv*map.yw;
  vec4 modes=texture(uCloudBasis,vec2((1.+fract(st.x)*${CLOUD_PHASE_W}.)/${CLOUD_W}.,
    (${CLOUD_PHASE_ROW}.+.5+clamp(st.y,0.,1.)*${CLOUD_PHASE_H - 1}.)/${CLOUD_ATLAS_H}.));
  vec2 weights=layer<.5?modes.rg:modes.ba;
  return clamp(deck(map,uv,layer)*(1.+dot(weights*2.-1.,phase)),0.,1.);
}
float skyElevation(vec2 uv){return (uv.y-${SKY_HORIZON_V})*uAir.x;}
float upperDepth(float mass){return mass*(.48+1.10*uAir.z);}
float lowerDepth(float mass){
  float threshold=.57-.35*uAir.z;
  return (.49+6.5*uAir.z*uAir.z)*smoothstep(threshold-.18,threshold+.30,mass);
}
float hazeDepth(float z){return (.034+.66*uAir.y)*exp(-3.9*max(0.,z));}
float mistOpacity(vec2 uv){
  float z=uv.y*uAir.x-uAir.w;
  if(z<=0.||z>=${MIST_HEIGHT})return 0.;
  float m=deck(uMist,uv,1.).r;
  float profile=smoothstep(0.,.055,z)*exp(-5.9*z)*(1.-smoothstep(.24,${MIST_HEIGHT},z));
  return 1.-exp(-(.065+uAir.y*1.58)*profile*(.24+.93*smoothstep(.16,.70,m)));
}
vec4 horizon(vec2 uv,float sector){
  const float h=${HORIZON_H}., total=${HORIZON_H * HORIZON_SECTORS}.;
  return texture(uHorizonBasis,vec2(uStars.x+uv.x*uStars.y,(h*sector+.5+clamp(skyElevation(uv)/.86,0.,1.)*(h-1.))/total));
}
vec2 skyMoonOffset(vec2 uv){return (uv-uLunar.xy)/max(uLunar.zw,vec2(.00001));}
float lunarLight(vec2 m,float r2){
  float c=1.+uLunarTurn.x,s=uLunarTurn.y;
  mat2 turn=mat2(c,s,-s,c);
  vec4 tile=texture(uLunarBasis,(m*turn)*${MOON_UV_SCALE}+.5);
  float z=sqrt(max(0.,1.-r2));
  vec3 n=vec3(m,z), relief=vec3(turn*(tile.rg*2.-1.)*.36*z,0.);
  float face=dot(n,uLunarSun), light=max(0.,dot(normalize(n+relief),uLunarSun));
  // A real terminator and weak Earthshine; no outline at the dark limb.
  return tile.b*(.0021+smoothstep(-.026,.064,face)*(.59*light+.78*light/max(.24,z+light)))+tile.a*light*.044;
}
vec3 skyRadiance(vec2 uv){
  float lo=floor(uSkySector), blend=uSkySector-lo;
  vec4 strip=horizon(uv,lo);
  if(blend>0.)strip=mix(strip,horizon(uv,lo+1.),blend);
  vec4 hi=evolvingDeck(uCirrus,uv,0.,uCloudPhase.xy), low=evolvingDeck(uBank,uv,1.,uCloudPhase.zw);
  float t0=exp(-upperDepth(hi.r)), t1=exp(-lowerDepth(low.r));
  float z=skyElevation(uv), t=exp(-hazeDepth(z));
  vec2 m=skyMoonOffset(uv);
  float r2=dot(m,m), forward=uPhaseEnergy/((1.+r2*.37)*(1.+r2*.37));
  vec3 c=strip.rgb+LUNAR_TINT*strip.a*.040*(1.-uAir.z*.95);
  float rim=1.+uLunarAA;
  // The dark limb occludes stars, not the foreground airglow.
  if(r2<rim*rim)c=mix(c,lunarLight(m,r2)*(LUNAR_TINT+uLunarShift)+strip.rgb*.91,1.-smoothstep(1.-uLunarAA,rim,sqrt(r2)));
  float shot=stormAt(uv.x), dz=z-.51, interior=exp(-dz*dz*10.8);
  float scatterHigh=(.023+hi.g*.068+hi.b*.021)*(1.+forward*.47);
  float scatterLow=.008+low.g*.113+low.b*.029+forward*low.g*.24;
  float internal=shot*low.a*(.040+.35*interior)*(.75+low.g*.67);
  c=mix(scatterHigh*${glVector(CIRRUS_TINT)},c,t0)+shot*hi.a*.074*LUNAR_TINT;
  c=mix(scatterLow*${glVector(BANK_TINT)}+uHazeColor*(.07+.31*(1.-clamp(z,0.,1.))),c,t1)+internal*${glVector(FLASH_TINT)};
  return mix(uHazeColor,c,t)+(LUNAR_TINT+uLunarShift)*forward*(.020+.098*uAir.y)*mix(.15,.58,t0*t1);
}
`
export const SKY_CACHE_BODY = `
uniform int uSkyProbe;
float transmission(vec2 uv){
  return exp(-upperDepth(evolvingDeck(uCirrus,uv,0.,uCloudPhase.xy).r)-lowerDepth(evolvingDeck(uBank,uv,1.,uCloudPhase.zw).r)-hazeDepth(skyElevation(uv)));
}
vec4 fluxProbe(){
  const vec2 taps[${LUNAR_TAPS.length}]=vec2[](${LUNAR_TAPS.map(glVector).join(',')});
  float lit=0., open=0.;
  for(int i=0;i<${LUNAR_TAPS.length};i++){
    vec2 p=taps[i];
    float w=max(0.,dot(vec3(p,sqrt(max(0.,1.-dot(p,p)))),uLunarSun));
    lit+=w; open+=w*transmission(uLunar.xy+p*uLunar.zw);
  }
  float through=open/max(.001,lit);
  return vec4(transmission(uLunar.xy),through,through*uPhaseEnergy,1.);
}
void main(){
  if(uSkyProbe==1){outColor=fluxProbe();return;}
  // A steep road reflection can sample above the visible optical crop.
  vec2 uv=vec2(vUV.x,vUV.y/max(.001,skyCacheScale()));
  float mist=mistOpacity(uv);
  if(uSkyProbe==2){outColor=vec4(transmission(uv),mist,0.,1.);return;}
  vec3 c=skyRadiance(uv);
#if !MASTER_SKY
  c=sqrt(clamp(c,0.,1.));
#endif
  outColor=vec4(c,mist);
}
`
export const SKY_DISC_DETAIL = `
// Resolve lunar relief at display resolution only inside a small patch.
// Both paths use the same clouds in front of the surface, even under a squall.
vec3 paintSky(vec2 uv,vec3 cached){
  vec2 m=skyMoonOffset(uv);
  float d=dot(m,m);
  if(d>${MOON_DETAIL_R2})return cached;
  return mix(cached,skyRadiance(clamp(uv,0.,1.)),1.-smoothstep(${MOON_DETAIL_FULL_R2},${MOON_DETAIL_R2},d));
}
`

export const ENVIRONMENT = `
uniform sampler2D uEnvBasis, uIrradiance;
uniform vec2 uEnvWindow; // camera relative origin, inverse width
uniform vec3 uStormDir;
uniform float uEnvReady;
const vec3 LUNAR_KEY=normalize(vec3(${MOON_KEY.join(',')}));
vec2 envUV(vec2 q,bool road){
  float y=road?${LIGHT_H}.+clamp((q.y-(${ROAD.rear}.0))*${GROUND_H}./${ROAD.front - ROAD.rear}.,.5,${GROUND_H - .5})
    : clamp((q.y-(${ENV_TOP}.0))*${LIGHT_H}./${ENV_BOTTOM - ENV_TOP}.,.5,${LIGHT_H - .5});
  return vec2((q.x-uEnvWindow.x)*uEnvWindow.y,y/${ENV_H}.);
}
vec4 envBasis(vec2 uv,bool inside){
  vec4 e=uEnvReady<.5||uv.x<0.||uv.x>=1.?vec4(0.,.63,1.,0.):texture(uEnvBasis,uv);
  // Keep a half-open eave exact even while its bake is bilinearly filtered.
  if(inside){e.r=0.;e.g=min(e.g,.08);}
  return e;
}
vec3 fixtureRadiance(vec2 uv){return (uEnvReady<.5||uv.x<0.||uv.x>=1.?vec3(0.):textureLod(uIrradiance,uv,0.).rgb);}
bool insideEave(vec2 q,int id){return id>=0&&q.y>=uCover[id].z+9.;}
float skyCast(float alpha, vec4 e){return 1.-alpha*e.r*e.g*.84;}
vec3 applyBridgeLayers(vec3 diffuse,vec3 specular,vec3 reflection,float contact){
  return min(diffuse*contact,vec3(.78))+specular+reflection;
}
vec3 environmentLight(vec4 e,vec3 practical,float noL,float flash,float rim,vec2 loss){
  float moon=e.r*uAtmo.x*noL*uWeather.w;
  float exposed=smoothstep(.52,.82,e.g);
  // Source-specific occlusion. A baked umbra contributes no lunar energy
  // to remove. Neither reflected combat nor hemispheric ambient is inked.
  vec3 base=vec3(.186,.19,.198)+vec3(.30,.32,.359)*e.g;
#if BRIDGE_MASTER_ENV
  // A small hemispheric sky return and one local diffuse bounce. The
  // aperture already accounts for cover, and the fixture field for solids.
  float open=smoothstep(.08,.92,e.g);
  base+=uHazeColor*(.90*open)+min(practical,vec3(.72))*(.055+.035*open);
#endif
  vec3 key=(vec3(.48,.55,.62)+uLunarShift*.47)*moon;
  vec3 lightning=vec3(.96,1.04,1.16)*exposed*flash*rim;
  base*=mix(vec3(.94,.98,1.),vec3(1.),smoothstep(.13,.56,e.r));
  return e.b*(base+key*(1.-loss.x*.94)+practical*(1.-loss.y*.86)+lightning);
}
// A stable sub-byte bias for Mobile's RGBA8 receiver; no time-domain noise.
vec3 quantizationDither(vec3 c){
  float d=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  return max(vec3(0.),c+d*.00355);
}
`

export const MOBILE_SURFACE_FLASH = `
vec3 mobileImpulseDiffuse(vec2 q, vec2 receiver, float ao, float depth, vec3 N) {
  int k=uFlashIDs.x;
  if(k<0)return vec3(0.);
  vec4 a=uLights[k], b=uEnergy[k];
  vec3 L;
  float v=receivedLight(q,receiver,a,uShape[k],depth,L);
  return b.rgb*(b.w*v*ao*(a.w==3.?.68:.48)*faceLight(N,L));
}
`
