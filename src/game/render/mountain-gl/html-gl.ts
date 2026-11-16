/**
 * mountain.html's WebGL lightfield — the reference renderer's own function set,
 * copied wholesale (the source is JavaScript; every shader string below is an
 * exact lift of the reference's, including its comments and constants). The
 * runtime mirrors the reference's mode-0 path: DECK_DIRECT_FS (the inline
 * twelve-ray shadow with the interval certificates) fed by the world-mask →
 * base/reduce/guard interval pyramid.
 *
 * The game's scene data (the moon, the door, the pan, the practicals, the
 * occluder masks) replaces the reference's own scene state; everything else —
 * the albedo, the light model, the tone curve, the shadow transport — is the
 * reference's, unchanged.
 */

/** The fullscreen triangle. */
export const VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_uv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 outColor;
const float HY=0.740,VPX=0.565,VPY=0.340;
const vec2 FIELD_MIN=vec2(-0.18,-0.025),FIELD_SIZE=vec2(1.36,0.61);
float down(float a,float b,float x){return 1.0-smoothstep(a,b,x);}
vec2 fieldUV(vec2 p){return (p-FIELD_MIN)/FIELD_SIZE;}
`;

export const NOISE_GLSL = `
uniform sampler2D u_noiseTex;
float noise2(vec2 p){return texture(u_noiseTex,p*0.0625).r;}
float hash12(vec2 p){return texture(u_noiseTex,p*0.19).b;}
float fbm3(vec2 p){return dot(texture(u_noiseTex,p*0.0625).rgb,vec3(0.54,0.30,0.16));}
`;

/** The shared header: the tone curve, the occluder sampler, the cloud field. */
export const FINAL_COMMON = HEAD + NOISE_GLSL + `
uniform sampler2D u_occluderTex,u_density0,u_density1,u_media0,u_media1,u_fogTex;
uniform vec2 u_camShift,u_moonScr,u_doorWindow,u_densityDecode;
uniform vec4 u_wind;
uniform float u_time,u_aspect,u_flicker,u_rayIntensity,u_doorCenter,u_cacheBlend;
uniform float u_panX,u_cloudShift,u_shadowPan;
uniform int u_shadowOriginCell;
float shadowRotation(vec2 ground){uvec2 cell=uvec2(ivec2(floor(ground*500.0))+ivec2(u_shadowOriginCell,0));uint h=cell.x*1597334677u^cell.y*3812015801u;h=(h^(h>>16))*2246822507u;h^=h>>13;return float(h&65535u)*(6.28318530718/65536.0);}

uniform int u_mediaPacked,u_fogCached;
const vec2 FOG_MIN=vec2(-0.10,0.36),FOG_SIZE=vec2(1.20,0.41);
float cloudField(vec2 p){if(p.y<0.01||p.y>0.58)return 0.0;vec2 uv=fieldUV(p+vec2(u_cloudShift,0.0));return dot(mix(texture(u_density0,uv).rg,texture(u_density1,uv).rg,u_cacheBlend),u_densityDecode);}
vec2 sampleOcc(vec2 p){if(p.x<0.0||p.x>1.0||p.y<=0.0||p.y>=HY)return vec2(0.0);return texture(u_occluderTex,vec2(p.x,p.y/HY)).rg;}
vec3 tone(vec3 x){vec3 a=clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);return pow(a,vec3(0.96));}
vec4 unpackMedia(vec4 m){if(u_mediaPacked==1)m.rgb=m.rgb*m.rgb*8.0;return m;}
vec4 media(vec2 p){if(p.y<0.01||p.y>0.58)return vec4(0.0);vec2 uv=fieldUV(p+vec2(u_cloudShift,0.0));return mix(unpackMedia(texture(u_media0,uv)),unpackMedia(texture(u_media1,uv)),u_cacheBlend);}
`;

/** The wet-basin distance field (the puddle). */
export const WET_GLSL = `float wetRegion(vec2 w){float basin=length((w-vec2(.555,.128))/vec2(.123,.132))-1.0;float threshold=length((w-vec2(.503,.028))/vec2(.045,.047))-1.0;float h=clamp(.5+.5*(threshold-basin)/.18,0.0,1.0);return mix(threshold,basin,h)-.18*h*(1.0-h);}`;

/** The interval pyramid's first reduction: the 4×4 min/max of the mask. */
export const SHADOW_BASE_FS = HEAD + `
uniform sampler2D u_src;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)*4,limit=textureSize(u_src,0)-1;vec2 lo=vec2(1.0),hi=vec2(0.0);
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){vec2 v=texelFetch(u_src,min(p+ivec2(x,y),limit),0).rg;lo=min(lo,v);hi=max(hi,v);}
 outColor=vec4(lo.r,hi.r,lo.g,hi.g);
}
`;

export const SHADOW_REDUCE_FS = HEAD + `
uniform sampler2D u_src;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)*2,limit=textureSize(u_src,0)-1;
 vec4 a=texelFetch(u_src,min(p,limit),0),b=texelFetch(u_src,min(p+ivec2(1,0),limit),0),c=texelFetch(u_src,min(p+ivec2(0,1),limit),0),d=texelFetch(u_src,min(p+ivec2(1,1),limit),0);
 outColor=vec4(min(min(a.r,b.r),min(c.r,d.r)),max(max(a.g,b.g),max(c.g,d.g)),min(min(a.b,b.b),min(c.b,d.b)),max(max(a.a,b.a),max(c.a,d.a)));
}
`;

export const SHADOW_GUARD_FS = HEAD + `
uniform sampler2D u_src;
uniform vec2 u_guardOrigin;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)-ivec2(u_guardOrigin),limit=textureSize(u_src,0)-1;vec2 lo=vec2(1.0),hi=vec2(0.0);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec4 v=texelFetch(u_src,clamp(p+ivec2(x,y),ivec2(0),limit),0);lo=min(lo,v.rb);hi=max(hi,v.ga);}
 outColor=vec4(lo.r,hi.r,lo.g,hi.g);
}
`;

/** The reference's shadow transport: the certificates + the twelve-ray disk. */
export const SHADOW_GLSL = `
uniform sampler2D u_worldMask,u_intervalTex;
uniform vec4 u_planeTiles[5],u_maskMap[5],u_planeInfo[5],u_planeBounds[5];
uniform vec2 u_guardOrigins[5],u_worldAtlasSize;
uniform vec3 u_shadowLight;
uniform int u_shadowMode;
const vec2 SHADOW_DISK[12]=vec2[12](vec2(-0.326,-0.406),vec2(-0.840,-0.074),vec2(-0.696,0.457),vec2(-0.203,0.621),vec2(0.962,-0.195),vec2(0.473,-0.480),vec2(0.519,0.767),vec2(0.185,-0.893),vec2(0.507,0.064),vec2(0.896,0.412),vec2(-0.322,-0.933),vec2(-0.792,-0.598));
float maskTransmission(vec2 o){return 1.0-clamp(o.r+0.82*o.g*(1.0-o.r),0.0,1.0);}
vec2 maskCoord(int i,vec2 p){vec4 m=u_maskMap[i];return vec2(p.x*m.x+m.z,m.w-p.y*m.y);}
float planeTransmission(int i,vec2 p){
 vec2 uv=maskCoord(i,p);if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 1.0;
 vec4 tile=u_planeTiles[i];vec2 texel=clamp(tile.xy+uv*tile.zw,tile.xy+0.5,tile.xy+tile.zw-0.5);
 return maskTransmission(texture(u_worldMask,texel/u_worldAtlasSize).rg);
}
// The selected macrocell's 3x3 neighborhood contains the complete ray-disk
// footprint plus bilinear support. A range that is not constant is NEVER used
// as a shadow approximation: it sends the native receiver to the twelve rays.
bool planeCertificate(int i,vec2 center,float distance,out float trans){
 vec4 tile=u_planeTiles[i],m=u_maskMap[i];vec2 texel=tile.xy+maskCoord(i,center)*tile.zw;
 vec2 radius=distance*u_shadowLight.z*vec2(1.0/u_aspect,1.0)*m.xy*tile.zw;
 vec2 support=radius+vec2(1.5);
 if(any(lessThan(texel-support,tile.xy))||any(greaterThan(texel+support,tile.xy+tile.zw)))return false;
 float r=max(support.x,support.y),cell=4.0;int level=0;
 if(u_shadowMode==1){if(r>8.0)return false;cell=8.0;level=1;}
 else{if(r>64.0)return false;if(r>4.0){cell=8.0;level=1;}if(r>8.0){cell=16.0;level=2;}if(r>16.0){cell=32.0;level=3;}if(r>32.0){cell=64.0;level=4;}}
 ivec2 p=ivec2(u_guardOrigins[level])+ivec2(floor(texel/cell));vec4 range=texelFetch(u_intervalTex,p,0);
 float lo=maskTransmission(range.ga),hi=maskTransmission(range.rb);
 if(lo==hi){trans=lo;return true;}return false;
}
vec2 shadowIntersection(vec2 ground,float d,vec2 disk){
 vec2 slope=u_shadowLight.xy+disk*u_shadowLight.z*vec2(1.0/u_aspect,1.0);
 return vec2(ground.x+d*slope.x,d*slope.y);
}
float shadowAudit(vec2 ground,out vec3 audit){
 int flags=0,single=0;float constantVis=1.0;audit=vec3(0.0);
 for(int i=0;i<5;i++){
  vec4 bounds=u_planeBounds[i];float d=ground.y-u_planeInfo[i].x;
  if(d<0.0||ground.x<bounds.x||ground.x>bounds.y||ground.y>bounds.w)continue;
  audit.x+=1.0;
  if(u_shadowMode!=0){float c;vec2 center=vec2(ground.x+d*u_shadowLight.x,d*u_shadowLight.y);
   if(planeCertificate(i,center,d,c)){audit.y+=1.0;constantVis*=c;if(constantVis==0.0)return 0.0;continue;}
  }
  flags|=(1<<i);single=i;audit.z+=1.0;
 }
 if(flags==0)return constantVis;
 float a=shadowRotation(ground);mat2 rotation=mat2(cos(a),-sin(a),sin(a),cos(a));float sum=0.0;
 if((flags&(flags-1))==0){
  float d=ground.y-u_planeInfo[single].x;
  for(int j=0;j<12;j++)sum+=planeTransmission(single,shadowIntersection(ground,d,rotation*SHADOW_DISK[j]));
 }else{
  for(int j=0;j<12;j++){
   vec2 disk=rotation*SHADOW_DISK[j];float vis=1.0;
   for(int i=0;i<5;i++)if((flags&(1<<i))!=0){float d=ground.y-u_planeInfo[i].x;vis*=planeTransmission(i,shadowIntersection(ground,d,disk));if(vis==0.0)break;}
   sum+=vis;
  }
 }
 return constantVis*(sum/12.0);
}
float worldShadow(vec2 ground){vec3 unused;return shadowAudit(ground,unused);}
`;

/** Mode 0 compiles the certificate branch away: the direct reference. */
export const DIRECT_SHADOW_GLSL = SHADOW_GLSL
  .replace('uniform int u_shadowMode;', '')
  .replaceAll('u_shadowMode', '0');

/** The reference's deck material: albedo, the moon/door/practical light, tone. */
export const DECK_FS = FINAL_COMMON + SHADOW_GLSL + WET_GLSL + `
uniform vec4 u_ripples[4],u_shadowAABB[3],u_stones[13];
uniform float u_stoneSeeds[13],u_specF;
uniform vec4 u_practical[4];
uniform vec3 u_moonDir,u_halfVec,u_reflDir;
uniform sampler2D u_moonTex,u_skyTex,u_reflectionTex;
uniform float u_moonAtlasSize;
uniform vec4 u_skyAtlas,u_reflectionBounds,u_waves[3];

float specular(vec3 N,float rough){
 const vec3 V=vec3(0.0,0.611447501,0.791285001);
 float nh=max(0.0,dot(N,u_halfVec)),nl=max(0.0,dot(N,u_moonDir)),nv=max(0.001,dot(N,V));
 float a=rough*rough;a*=a;float d=nh*nh*(a-1.0)+1.0,D=a/(3.14159*d*d+0.00001),k=(rough+1.0)*(rough+1.0)*0.125;
 float G=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));return clamp(D*u_specF*G/(4.0*nv*nl+0.05),0.0,2.5);
}
float stones(vec2 w,out int hit,out vec2 uv){
 hit=-1;uv=vec2(0.0);float best=0.008;int center=int(floor((w.y-0.015)*(12.0/0.352)+0.5));
 for(int j=-1;j<=1;j++){int i=center+j;if(i<0||i>12)continue;vec4 s=u_stones[i];vec2 d=(w-s.xy)/s.zw;
  if((max(abs(d.x),abs(d.y))-1.22)*s.w>best)continue;
  float a=atan(d.y,d.x),fi=float(i),dist=(length(d)-(1.0+0.14*cos(a*3.0+fi*1.9)+0.08*sin(a*5.0-fi)))*s.w;
  if(dist<best){best=dist;hit=i;uv=d;}
 }return best;
}

void main(){
 vec2 scr=vec2(v_uv.x,1.0-v_uv.y),moonScene=u_moonScr+u_camShift*0.64;
 float hy=HY-u_camShift.y*0.72,moonDim=exp(-cloudField(u_moonScr+u_camShift*0.04)*0.95);
 float persp=1.0+(scr.y-hy)/(HY-VPY),parX=u_camShift.x*(0.72+(persp-1.0)*1.48);
 float wx=VPX+(scr.x+parX-VPX)/persp+u_panX,wz=1.0-1.0/persp;float doorX=u_doorCenter+u_panX;
 if(wz>0.365){vec3 edge=mix(vec3(0.14,0.18,0.22),vec3(0.015,0.02,0.03),smoothstep(0.365,0.371,wz));outColor=vec4(tone(edge*(0.72+0.38*fbm3(vec2(wx*22.0,wz*48.0)))),1.0);return;}
 float plank=wx*29.0,id=floor(plank),pu=fract(plank),seed=hash12(vec2(id,7.3));
 float sw=mix(0.034,0.018,clamp(wz*2.5,0.0,1.0));
 float seamAA=max(fwidth(plank)*0.5,0.0001);
 float seam=smoothstep(0.0,max(sw,seamAA),pu)*down(1.0-max(sw,seamAA),1.0,pu),joint=fract(wz*4.4+seed*5.3);
 seam*=mix(0.25,1.0,smoothstep(0.0,0.014,joint)*down(0.986,1.0,joint));
 float g1=fbm3(vec2(pu*6.0+seed*19.0,wz*11.0+seed*7.0)),g2=noise2(vec2(pu*24.0+seed*5.0,wz*26.0));
 vec3 albedo=mix(vec3(0.075,0.098,0.125),vec3(0.27,0.32,0.37),g1*0.72+g2*0.28)*(0.74+0.40*seed)*mix(0.08,1.0,seam);
 float bevel=(smoothstep(0.0,0.12,pu)-1.0)+(1.0-smoothstep(0.88,1.0,pu));
 float grainFilter=1.0/(1.0+dot(fwidth(vec2(pu*24.0,wz*26.0)),vec2(0.8)));
 vec3 N=normalize(vec3(bevel*0.42+(g2-0.5)*0.16*grainFilter,1.0,(g1-0.5)*0.13));
 float rough=sqrt(mix(0.38,0.60,g1)*mix(0.38,0.60,g1)+(1.0-grainFilter)*0.06);
 float pd=length((vec2(wx,wz)-vec2(.555,.128))/vec2(.123,.132)),damp=1.0-smoothstep(-.05,.38,wetRegion(vec2(wx,wz)));albedo*=mix(1.0,0.54,damp);rough=mix(rough,0.14,damp);
 if(wx>0.66&&wx<0.77&&wz>0.0&&wz<0.38){int sid;vec2 suv;float sd=stones(vec2(wx,wz),sid,suv),mask=1.0-smoothstep(-0.0012,0.0014,sd);if(mask>0.01&&sid>=0){float ns=fbm3(suv*4.5+u_stoneSeeds[sid]*11.0);vec3 stoneCol=mix(vec3(0.09,0.12,0.16),vec3(0.30,0.37,0.44),ns),sn=normalize(vec3(suv.x*0.58,0.78+clamp(1.0-length(suv),0.0,1.0)*0.5,suv.y*0.58));albedo=mix(albedo,stoneCol,mask);N=normalize(mix(N,sn,mask));rough=mix(rough,0.32,mask);}albedo*=mix(0.22,1.0,smoothstep(-0.001,0.007,sd));}
 float moonLit=worldShadow(vec2(VPX+(scr.x+parX-VPX)/persp+u_shadowPan,wz));
 float doorVis=0.0;
 if(wz<0.25&&abs(wx-doorX)<0.19){vec2 bulb=vec2(doorX+0.007,-0.036);float gate=wx+(wz/(wz-bulb.y))*(bulb.x-wx),jamb=smoothstep(u_doorWindow.x-0.002,u_doorWindow.x+0.002,gate)*down(u_doorWindow.y-0.002,u_doorWindow.y+0.002,gate);vec2 dd=bulb-vec2(wx,wz);doorVis=jamb*(1.0-sampleOcc(vec2(gate-u_panX,HY-0.015)).r)/(1.0+dot(dd,dd)*120.0)*4.2*u_flicker*down(0.18,0.25,wz)*down(0.15,0.19,abs(wx-doorX));}
 float spec=specular(N,rough)*0.43*moonLit*moonDim,diff=max(0.0,dot(N,u_moonDir));
 vec3 light=vec3(0.080,0.110,0.145)+vec3(0.87,1.06,1.24)*(diff*1.40*moonDim)*moonLit+vec3(1.38,0.72,0.24)*doorVis;
 vec3 practical=vec3(0.0);
 for(int i=0;i<4;i++){
  vec4 lamp=u_practical[i];vec3 L=vec3((lamp.x-wx)*u_aspect,lamp.z,lamp.y-wz);float ds=max(.0001,dot(L,L));if(ds>=.0784||lamp.w<=0.0)continue;
  L*=inversesqrt(ds);
  float fade=max(0.0,1.0-ds/.0784);float irradiance=lamp.w*(.16+.84*max(0.0,dot(N,L)))*fade*fade/(1.0+ds*80.0);
  practical+=vec3(1.40,.79,.32)*irradiance;
 }
 vec3 col=albedo*(light+practical)+vec3(.65,.83,1.0)*spec;float backFog=exp(-wz*18.0)*0.30*clamp(u_rayIntensity,0.4,1.4),fw=(wx-doorX)/0.13,warm=exp(-fw*fw)*0.45*u_flicker;
 vec3 fogCol=mix(vec3(0.10,0.17,0.24)*(0.45+0.65*moonLit*moonDim),vec3(0.68,0.40,0.18),warm);col=mix(col,fogCol,clamp(backFog,0.0,0.68));

 col*=mix(0.46,1.06,1.0-smoothstep(0.36,0.92,length((scr-vec2(0.5,0.55))*vec2(1.05,1.25))));outColor=vec4(tone(col*1.18),1.0);
}
`;

export const DECK_DIRECT_FS = DECK_FS.replace(SHADOW_GLSL, DIRECT_SHADOW_GLSL);

/** The reference's noise field: three interpolated value grids in RGB. */
export function buildNoise(size = 256): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const mulberry = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const grid = (n: number, seed: number) => {
    const r = mulberry(seed);
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = r();
    return (x: number, y: number) => {
      const px = (x / size) * n;
      const py = (y / size) * n;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const fx = px - ix;
      const fy = py - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const x1 = (ix + 1) % n;
      const y1 = (iy + 1) % n;
      return (
        (a[iy * n + ix] * (1 - ux) + a[iy * n + x1] * ux) * (1 - uy) +
        (a[y1 * n + ix] * (1 - ux) + a[y1 * n + x1] * ux) * uy
      );
    };
  };
  const r = grid(16, 101);
  const g = grid(32, 307);
  const b = grid(64, 709);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      out[i] = Math.round(r(x, y) * 255);
      out[i + 1] = Math.round(g(x, y) * 255);
      out[i + 2] = Math.round(b(x, y) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The atlas layout the reference packs its five world planes into. */
export const WORLD_ATLAS_H = 768;

export interface DeckFrame {
  time: number;
  aspect: number;
  camNX: number;
  camNY: number;
  /** The moon's screen position (the reference's breath-perturbed slot). */
  moonX: number;
  moonY: number;
  flicker: number;
  rayIntensity: number;
  panX: number;
  shadowPan: number;
  shadowOriginCell: number;
  /** The door's world x in deck units, minus the pan (the shader adds it back). */
  doorCenter: number;
  doorWindow: [number, number];
  shadowLight: [number, number, number];
  moonDir: [number, number, number];
  halfVec: [number, number, number];
  specF: number;
  reflDir: [number, number, number];
  /** The four practicals: x, height, z, power (the reference's layout). */
  practicals: Float32Array;
  ripples: Float32Array;
  stones: Float32Array;
  stoneSeeds: Float32Array;
  waves: Float32Array;
  shadowAABB: Float32Array;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/**
 * The reference's mode-0 lightfield host: the program set, the world-mask
 * pyramid, and the deck draw. Any construction failure throws — the caller's
 * canvas fallback takes over exactly as the reference's own initGL does.
 */
export class HtmlLightfield {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly programs = new Map<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
  private noise!: WebGLTexture;
  private maskTexture!: WebGLTexture;
  private levels: Target[] = [];
  private interval!: Target;
  private guardOrigins = new Float32Array(10);
  private maskMap = new Float32Array(20);
  private intervalVersion = -1;
  private planeTiles = new Float32Array(20);
  private planeInfo = new Float32Array(20);
  private planeBounds = new Float32Array(20);
  private planeWorlds: number[][] = [];
  private worldAnchor = 0;
  private occluderTex: WebGLTexture | null = null;
  private dummyTex: WebGLTexture | null = null;
  private densityTex: WebGLTexture | null = null;
  private atlasW = 2048;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const g = gl;
    this.vao = g.createVertexArray()!;
    g.bindVertexArray(this.vao);
    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.disable(g.BLEND);
    g.disable(g.DITHER);
    const vs = this.shader(g.VERTEX_SHADER, VERT);
    // Mode 0 only: the direct deck + the interval pyramid that certifies it.
    this.program('deck', vs, DECK_DIRECT_FS);
    this.program('base', vs, SHADOW_BASE_FS);
    this.program('reduce', vs, SHADOW_REDUCE_FS);
    this.program('guard', vs, SHADOW_GUARD_FS);
    g.deleteShader(vs);
    this.noise = this.texture(256, 256, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, buildNoise(), true);
    this.initPyramid();
  }

  private shader(type: number, source: string): WebGLShader {
    const g = this.gl;
    const s = g.createShader(type)!;
    g.shaderSource(s, source);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      const log = g.getShaderInfoLog(s);
      g.deleteShader(s);
      throw new Error(log ?? 'shader compile failed');
    }
    return s;
  }

  private program(key: string, vs: WebGLShader, source: string): void {
    const g = this.gl;
    const fs = this.shader(g.FRAGMENT_SHADER, source);
    const p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      const log = g.getProgramInfoLog(p);
      g.deleteProgram(p);
      throw new Error(log ?? 'program link failed');
    }
    const u: Record<string, WebGLUniformLocation | null> = Object.create(null);
    const names = [
      'u_panX', 'u_shadowPan', 'u_shadowOriginCell', 'u_cloudShift', 'u_time', 'u_aspect',
      'u_densityDecode', 'u_rayIntensity', 'u_noiseTex', 'u_occluderTex', 'u_density0', 'u_density1',
      'u_media0', 'u_media1', 'u_camShift', 'u_moonScr', 'u_doorWindow', 'u_flicker', 'u_doorCenter',
      'u_cacheBlend', 'u_mediaPacked', 'u_fogCached', 'u_wind', 'u_ripples[0]', 'u_shadowAABB[0]',
      'u_stones[0]', 'u_stoneSeeds[0]', 'u_practical[0]', 'u_specF', 'u_moonDir', 'u_halfVec',
      'u_reflDir', 'u_moonTex', 'u_moonAtlasSize', 'u_fogTex', 'u_skyTex', 'u_reflectionTex',
      'u_skyAtlas', 'u_reflectionBounds', 'u_waves[0]', 'u_src', 'u_guardOrigin', 'u_worldMask',
      'u_intervalTex', 'u_planeTiles[0]', 'u_maskMap[0]', 'u_planeInfo[0]', 'u_planeBounds[0]',
      'u_guardOrigins[0]', 'u_worldAtlasSize', 'u_shadowLight', 'u_shadowMode',
    ];
    for (const n of names) u[n] = g.getUniformLocation(p, n);
    this.programs.set(key, { p, u });
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, bytes: ArrayBufferView | null = null, repeat = false): WebGLTexture {
    const g = this.gl;
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, repeat ? g.REPEAT : g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, repeat ? g.REPEAT : g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, internal, w, h, 0, format, type, bytes);
    return t;
  }

  private target(w: number, h: number, byte = false): Target {
    const g = this.gl;
    const useFloat = !byte && !!g.getExtension('EXT_color_buffer_float');
    const internal = useFloat ? g.RGBA16F : g.RGBA8;
    const format = useFloat ? g.RGBA : g.RGBA;
    const type = useFloat ? g.HALF_FLOAT : g.UNSIGNED_BYTE;
    const tex = this.texture(w, h, internal, format, type);
    const fbo = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
      g.deleteFramebuffer(fbo);
      g.deleteTexture(tex);
      throw new Error('Lightfield framebuffer unavailable');
    }
    return { tex, fbo, w, h };
  }

  private bind(unit: number, tex: WebGLTexture | null): void {
    const g = this.gl;
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, tex);
  }

  /** The five-level interval pyramid the certificates read. */
  private initPyramid(): void {
    const g = this.gl;
    this.atlasW = 2048;
    this.maskTexture = this.texture(this.atlasW, WORLD_ATLAS_H, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE);
    this.levels = [];
    let height = 0;
    for (let i = 0; i < 5; i++) {
      const cell = 4 << i;
      const t = this.target(Math.max(1, Math.floor(this.atlasW / cell)), Math.max(1, Math.floor(WORLD_ATLAS_H / cell)), true);
      this.levels.push(t);
      this.guardOrigins[i * 2] = 0;
      this.guardOrigins[i * 2 + 1] = height;
      height += t.h;
    }
    this.interval = this.target(Math.max(1, Math.floor(this.atlasW / 4)), Math.max(1, height), true);
    for (const t of [...this.levels, this.interval]) {
      g.bindTexture(g.TEXTURE_2D, t.tex);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  /**
   * The reference packs five world planes into the atlas; our scene feeds the
   * same layout with its own occluder canvases (the house with the door
   * opening, the cherry, the rack, the props) painted in the reference's
   * convention: red = solid, green = soft foliage.
   */
  setWorldPlanes(planes: { rect: [number, number, number, number]; world: [number, number, number, number] }[], anchor: number): void {
    this.worldAnchor = anchor;
    this.planeWorlds = planes.map((p) => [...p.world]);
    for (let i = 0; i < 5; i++) {
      const p = planes[i];
      this.planeTiles[i * 4] = p.rect[0];
      this.planeTiles[i * 4 + 1] = p.rect[1];
      this.planeTiles[i * 4 + 2] = p.rect[2];
      this.planeTiles[i * 4 + 3] = p.rect[3];
      const w = p.world;
      this.maskMap[i * 4] = 1 / w[2];
      this.maskMap[i * 4 + 1] = 1 / w[3];
      this.maskMap[i * 4 + 2] = -(w[0] - anchor) / w[2];
      this.maskMap[i * 4 + 3] = (w[1] + w[3]) / w[3];
      this.planeInfo[i * 4] = 0;
      this.planeInfo[i * 4 + 1] = w[1] + w[3];
      this.planeInfo[i * 4 + 2] = w[0] - anchor;
      this.planeInfo[i * 4 + 3] = w[0] + w[2] - anchor;
    }
    this.intervalVersion = -1;
  }

  /** Upload one plane's occluder canvas into the atlas. */
  uploadPlane(index: number, canvas: HTMLCanvasElement | OffscreenCanvas): void {
    const g = this.gl;
    const [x, y] = this.planeTiles.slice(index * 4, index * 4 + 2);
    g.bindTexture(g.TEXTURE_2D, this.maskTexture);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.texSubImage2D(g.TEXTURE_2D, 0, x, y, g.RGBA, g.UNSIGNED_BYTE, canvas as TexImageSource);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.intervalVersion = -1;
  }

  /** The reference's per-frame shadow bounds (the light's AABB per plane). */
  setShadowBounds(bounds: Float32Array): void {
    this.planeBounds.set(bounds);
  }

  /** The reference's interval pyramid: the base/reduce/guard passes. */
  reduceIntervals(): void {
    const g = this.gl;
    if (this.intervalVersion === 0) return;
    g.disable(g.SCISSOR_TEST);
    for (let i = 0; i < this.levels.length; i++) {
      const t = this.levels[i];
      const cell = 4 << i;
      g.bindFramebuffer(g.FRAMEBUFFER, t.fbo);
      g.viewport(0, 0, t.w, t.h);
      this.bind(13, i === 0 ? this.maskTexture : this.levels[i - 1].tex);
      const prog = this.programs.get(i === 0 ? 'base' : 'reduce')!;
      g.useProgram(prog.p);
      g.uniform1i(prog.u.u_src!, 13);
      g.drawArrays(g.TRIANGLES, 0, 3);
      // The guard window: one cell of conservative padding per level.
      const origin = this.guardOrigins[i * 2 + 1];
      g.bindFramebuffer(g.FRAMEBUFFER, this.interval.fbo);
      g.viewport(0, 0, this.interval.w, this.interval.h);
      this.bind(13, t.tex);
      const guard = this.programs.get('guard')!;
      g.useProgram(guard.p);
      g.uniform1i(guard.u.u_src!, 13);
      g.uniform2f(guard.u.u_guardOrigin!, 0, origin);
      g.drawArrays(g.TRIANGLES, 0, 3);
      void cell;
    }
    this.intervalVersion = 0;
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  /** The reference's `common()` uniform feed. */
  private common(key: string, f: DeckFrame): void {
    const g = this.gl;
    const { p, u } = this.programs.get(key)!;
    g.useProgram(p);
    g.uniform1f(u.u_time!, f.time);
    g.uniform2f(u.u_camShift!, f.camNX, f.camNY);
    g.uniform2f(u.u_moonScr!, f.moonX, f.moonY);
    g.uniform1f(u.u_flicker!, f.flicker);
    g.uniform1f(u.u_rayIntensity!, f.rayIntensity);
    g.uniform1f(u.u_doorCenter!, f.doorCenter);
    g.uniform2f(u.u_doorWindow!, f.doorWindow[0], f.doorWindow[1]);
    g.uniform1f(u.u_cacheBlend!, 0);
    g.uniform4f(u.u_wind!, 0, 0, 0, 0);
    g.uniform1i(u.u_fogCached!, 0);
    g.uniform1f(u.u_panX!, f.panX);
    g.uniform1f(u.u_shadowPan!, f.shadowPan);
    g.uniform1i(u.u_shadowOriginCell!, f.shadowOriginCell);
    g.uniform1f(u.u_cloudShift!, 0);
    g.uniform1i(u.u_mediaPacked!, 0);
    g.uniform2f(u.u_densityDecode!, 0, 0);
    g.uniform1f(u.u_aspect!, f.aspect);
    if (u.u_shadowLight) {
      g.uniform1i(u.u_shadowMode!, 0);
      g.uniform3fv(u.u_shadowLight!, f.shadowLight);
      g.uniform4fv(u['u_planeBounds[0]']!, this.planeBounds);
      g.uniform4fv(u['u_planeTiles[0]']!, this.planeTiles);
      g.uniform4fv(u['u_maskMap[0]']!, this.maskMap);
      g.uniform4fv(u['u_planeInfo[0]']!, this.planeInfo);
      g.uniform2fv(u['u_guardOrigins[0]']!, this.guardOrigins);
      g.uniform2f(u.u_worldAtlasSize!, this.atlasW, WORLD_ATLAS_H);
      g.uniform1i(u.u_worldMask!, 11);
      g.uniform1i(u.u_intervalTex!, 12);
    }
    if (u['u_practical[0]']) g.uniform4fv(u['u_practical[0]']!, f.practicals);
  }

  /**
   * Draw the deck with the reference's material — the caller has already
   * bound the deck region; this issues the fullscreen pass.
   */
  drawDeck(f: DeckFrame, canvasW: number, canvasH: number): void {
    const g = this.gl;
    this.reduceIntervals();
    g.bindVertexArray(this.vao);
    g.viewport(0, 0, canvasW, canvasH);
    this.bind(0, this.occluderTex);
    this.bind(1, this.noise);
    this.bind(2, this.densityTex);
    this.bind(3, this.densityTex);
    this.bind(4, this.densityTex);
    this.bind(5, this.densityTex);
    this.bind(6, this.dummyTex);
    this.bind(7, this.densityTex);
    this.bind(8, this.dummyTex);
    this.bind(9, this.dummyTex);
    this.bind(11, this.maskTexture);
    this.bind(12, this.interval.tex);
    this.common('deck', f);
    const { u } = this.programs.get('deck')!;
    g.uniform4fv(u['u_ripples[0]']!, f.ripples);
    g.uniform4fv(u['u_shadowAABB[0]']!, f.shadowAABB);
    g.uniform4fv(u['u_stones[0]']!, f.stones);
    g.uniform1fv(u['u_stoneSeeds[0]']!, f.stoneSeeds);
    g.uniform4fv(u['u_waves[0]']!, f.waves);
    g.uniform1f(u.u_specF!, f.specF);
    g.uniform3fv(u.u_moonDir!, f.moonDir);
    g.uniform3fv(u.u_halfVec!, f.halfVec);
    g.uniform3fv(u.u_reflDir!, f.reflDir);
    g.uniform1i(u.u_moonTex!, 6);
    g.uniform1f(u.u_moonAtlasSize!, 1);
    g.uniform1i(u.u_skyTex!, 8);
    g.uniform1i(u.u_reflectionTex!, 9);
    g.uniform4f(u.u_skyAtlas!, 0, 0, 1, 1);
    g.uniform4f(u.u_reflectionBounds!, 0, 0, 1, 1);
    // The reference scissors the material to the deck's rows; the sky region
    // stays transparent for the 2D sky plate beneath.
    const rows = Math.max(0, Math.min(canvasH, Math.round((1 - 0.74 + f.camNY * 0.72) * canvasH)))
    g.enable(g.SCISSOR_TEST)
    g.scissor(0, 0, canvasW, rows)
    g.drawArrays(g.TRIANGLES, 0, 3)
    g.disable(g.SCISSOR_TEST)
  }

  /** The door's occluder texture (the jamb visibility `sampleOcc` reads). */
  setOccluder(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    const g = this.gl;
    if (this.occluderTex) g.deleteTexture(this.occluderTex);
    this.occluderTex = this.texture(canvas.width, canvas.height, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE);
    g.bindTexture(g.TEXTURE_2D, this.occluderTex);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RGBA, g.UNSIGNED_BYTE, canvas as TexImageSource);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** One-pixel stand-ins for the samplers the deck declares but never reads. */
  ensureDummies(): void {
    const g = this.gl;
    if (!this.dummyTex) this.dummyTex = this.texture(1, 1, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    if (!this.densityTex) this.densityTex = this.texture(1, 1, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }
}
