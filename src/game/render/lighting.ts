/** Ground-shadow rewrite, pass 4: sky-colored shadows + PCSS contact-hardening.
 * World joint Y ALREADY includes jump height. Never add it again to the skull.
 */
import { clamp,clamp01,lerp,rgba } from '../core/utils'
export interface KeyLight {
  /** horizontal direction shadows lean along (unit-ish, +X = right) */
  dirX: number
  /** elevation above the horizon, radians: high → short shadows */
  elev: number
  /** 0 = soft ambient … 1 = hard directional (strobes) */
  hard: number
  /** overall intensity */
  i: number
  /** shadow tint (near-black; storms cool it further) */
  color: string
}

export interface ShadowFigure {
  /** stroke chains in WORLD space: flat [x0,y0, x1,y1, ...] per chain
   * (y negative = above the ground line) */
  chains: number[][]
  /** head joint for the skull ellipse (world) */
  head: { x: number; y: number; r: number } | null
  /** optional weapon chain already included in chains; kept separate here
   * so it can carry a wider streak */
  blade?: { x0: number; y0: number; x1: number; y1: number } | null
}

export interface CastShadowOpts {
  /** base opacity multiplier */
  alpha?: number
  /** base stroke width (world px) — roughly limb width */
  width?: number
  /** penumbra passes (2 cheap / 3 player) */
  passes?: number
  /** body scale (widths scale) */
  scale?: number
  /** Physics root altitude, for falloff only; joints already include world Y. */
  height?: number
  /** planted-foot contact points for the AO cores (world x) */
  contacts?: number[]
  /** light intensity boost (strobes) — defaults from light */
  lightBoost?: number
}


const finite=(n:number,fallback:number)=>Number.isFinite(n)?n:fallback
const mixHex=(a:string,b:string,t:number)=>{
  const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16),u=clamp01(finite(t,0))
  const r=Math.round(((pa>>16)&255)*(1-u)+((pb>>16)&255)*u)
  const g=Math.round(((pa>>8)&255)*(1-u)+((pb>>8)&255)*u)
  const bl=Math.round((pa&255)*(1-u)+(pb&255)*u)
  return '#'+((1<<24)|(r<<16)|(g<<8)|bl).toString(16).slice(1)
}

/* ===================== typed light rig (UE archetypes) =====================
 * Directional = the moon key (KeyLight above). Point/spot/rect sources carry
 * UE-style attenuation and cast their own shadows + wet-deck reflections. */
export type LightKind = 'directional' | 'point' | 'spot' | 'rect'
export interface Light2D {
  kind: LightKind
  x: number
  y: number
  /** attenuation radius (point/spot/rect) */
  range: number
  intensity: number
  color: string
  /** spot axis */
  dirX?: number
  dirY?: number
  /** rect extent */
  w?: number
  h?: number
}

/** UE-style inverse-square-ish falloff, clamped at the attenuation radius */
export function pointAt(l: Light2D, x: number, y: number): number {
  const dx = x - l.x, dy = y - l.y
  const r = Math.max(1, l.range)
  return l.intensity / (1 + (dx * dx + dy * dy) / (r * r))
}

  /** secondary shadow key from a point source: shadows fall AWAY from it */
export function shadowKeyFromPoint(l: Light2D, x: number, y: number): KeyLight {
  const dx = x - l.x
  const dirX = dx >= 0 ? 0.85 : -0.85
  // warm-dark umber: the blocked door light leaves a warm-shaped smudge,
  // visually distinct from the moon key's violet (research: shadow = the
  // remaining ambient, never pure black)
  return {dirX, elev: .52, hard: .42, i: pointAt(l, x, y), color: '#2a1410'}
}

/** the stairwell practical — scene point light (warm), world coords */
export const DOOR_LIGHT: Light2D = {
  kind: 'point', x: 1755, y: -120, range: 640, intensity: .95, color: '#ff9a4d',
}
export function keyLightFromStorm(intensity:number,azimuth:number):KeyLight {
  const k=clamp01(finite(intensity,0)),az=clamp(finite(azimuth,0),-1,1)
  // Bolt-strobe mode (k→1): hard, bright, near-white, raking toward the bolt —
  // shadows snap tight and near-black (ambient drowned). Moon mode (k→0):
  // KEY LIGHT = moon upper-right — LOW elevation so shadows rake LONG
  // down-left across the deck (~1.8 body-lengths at elev .50), soft-edged.
  // SKY-COLORED SHADOWS law: shadow = the remaining skylight — a DARK
  // violet-blue that pops against the bright moonlit deck (target-art
  // contrast: bright ground, deep shadow), never dead black.
  return {dirX:lerp(-.85,-.92*az,k),elev:lerp(.50,.40,k),hard:lerp(.12,1,k),
    i:lerp(.62,1,k),color:mixHex('#231d48','#0d0c22',k)}
}
export function projectGroundPoint(x:number,y:number,light:KeyLight):{x:number;y:number}|null {
  if(!Number.isFinite(x)||!Number.isFinite(y))return null
  const height=Math.max(0,-y)
  const cot=1/Math.tan(clamp(finite(light.elev,1),.3,1.45))
  const offset=clamp(height*cot*clamp(finite(light.dirX,0),-1,1),-320,320)
  return {x:x+offset,y:1.5+Math.min(12,height*.06)}
}
/** Build every body primitive into ONE fill path: crossings/duplicates do
 * not multiply opacity. World coordinates already contain the airborne Y. */
function shadowPath(ctx:CanvasRenderingContext2D,fig:ShadowFigure,light:KeyLight,radius:number):void {
  // PCSS CONTACT-HARDENING (research: penumbra width ∝ distance from the
  // contact patch): each joint's penumbra radius scales with ITS height above
  // the deck — feet razor-tight, head/tip blooming wide; soft keys widen
  // more than strobes. Each segment fills a TRAPEZOID quad whose width grows
  // from the contact end toward the raised end = the slembcke penumbra wedge.
  const hard=clamp01(finite(light.hard,.14))
  const rAt=(y:number)=>radius*(1+(1-hard)*1.2*clamp01(Math.max(0,-y)/70))
  const ryR=.32
  const ellipse=(x:number,y:number,xr:number,yr?:number)=>{ctx.moveTo(x+xr,y);ctx.ellipse(x,y,xr,yr??Math.max(.5,xr*ryR),0,0,Math.PI*2)}
  ctx.beginPath()
  for(const chain of fig.chains){
    let prev:{x:number;y:number}|null=null,prevR=radius
    for(let i=0;i+1<chain.length;i+=2){
      const q=projectGroundPoint(chain[i],chain[i+1],light)
      if(!q){prev=null;continue}
      const rQ=rAt(chain[i+1])
      ellipse(q.x,q.y,rQ)
      if(prev){const dx=q.x-prev.x,dy=q.y-prev.y,l=Math.hypot(dx,dy)||1
        const kx=-dy/l,ky=dx/l*ryR
        const n0x=kx*prevR,n0y=ky*prevR,n1x=kx*rQ,n1y=ky*rQ
        // Same winding as ellipses, so overlapping shapes form a solid union.
        ctx.moveTo(prev.x-n0x,prev.y-n0y);ctx.lineTo(q.x-n1x,q.y-n1y)
        ctx.lineTo(q.x+n1x,q.y+n1y);ctx.lineTo(prev.x+n0x,prev.y+n0y);ctx.closePath()}
      prev=q;prevR=rQ
    }
  }
  if(fig.head){const q=projectGroundPoint(fig.head.x,fig.head.y,light)
    if(q){const r=clamp(finite(fig.head.r,6),1,30);const rr=rAt(fig.head.y)
      ellipse(q.x,q.y,r*.9+rr*.25,Math.max(1,r*.26))}}
  if(fig.blade){const b=fig.blade,a=projectGroundPoint(b.x0,b.y0,light),z=projectGroundPoint(b.x1,b.y1,light)
    if(a&&z){const r0=Math.max(.7,rAt(b.y0)*.22),r1=Math.max(.7,rAt(b.y1)*.22)
      ctx.moveTo(a.x,a.y-r0);ctx.lineTo(z.x,z.y-r1);ctx.lineTo(z.x,z.y+r1);ctx.lineTo(a.x,a.y+r0);ctx.closePath()}}
}
export function shadowOpacity(height:number,alpha=.55):number {
  // Height changes softness/opacity, NOT a second displacement of the head.
  return clamp01(finite(alpha,.55))/(1+Math.max(0,-finite(height,0))/115)
}
export function drawCastShadow(ctx:CanvasRenderingContext2D,fig:ShadowFigure,light:KeyLight,opts:CastShadowOpts={}):void {
  const height=finite(opts.height??0,0),alpha=shadowOpacity(height,opts.alpha??.55)
  if(alpha<.005)return
  const scale=clamp(finite(opts.scale??1,1),.1,5)
  const radius=clamp(finite(opts.width??6,6),.5,24)*scale*.5
  ctx.save();ctx.globalCompositeOperation='source-over'
  const passes=Math.round(clamp(finite(opts.passes??2,2),1,3))
  const soft=1-clamp01(finite(light.hard,.14)),alt=Math.max(0,-height)
  const weights=[.62,.26,.12],sum=weights.slice(0,passes).reduce((a,b)=>a+b,0)
  const target=alpha*(.88+.12*clamp01(finite(opts.lightBoost??light.i,.55)))
  const tint=/^#[0-9a-f]{6}$/i.test(light.color)?light.color:'#020409'
  // LONG-SHADOW TIP FADE: opacity dies toward the far tip the way a real
  // penumbra dissolves with distance from the contact patch. One gradient
  // per caster per frame (never per stroke) — passes share it via globalAlpha.
  const rootX=fig.chains.length&&fig.chains[0].length?fig.chains[0][0]:(fig.head?fig.head.x:0)
  let maxH=20
  for(const ch of fig.chains)for(let i=1;i<ch.length;i+=2)if(1.5-ch[i]>maxH)maxH=1.5-ch[i]
  if(fig.head&&1.5-fig.head.y>maxH)maxH=1.5-fig.head.y
  if(fig.blade){if(1.5-fig.blade.y0>maxH)maxH=1.5-fig.blade.y0;if(1.5-fig.blade.y1>maxH)maxH=1.5-fig.blade.y1}
  const tipOff=Math.min(320,maxH*Math.abs(Math.cos(finite(light.elev,.58)))/Math.max(.24,Math.sin(finite(light.elev,.58))))*finite(light.dirX,-.85)
  const shade=ctx.createLinearGradient(rootX,0,rootX+tipOff*1.3,0)
  shade.addColorStop(0,rgba(tint,1))
  shade.addColorStop(.55,rgba(tint,.78))
  shade.addColorStop(1,rgba(tint,.32))
  ctx.fillStyle=shade
  // Outside-in soft passes. Normalize accumulated center opacity so adding
  // quality passes cannot darken the entire character shadow three times.
  for(let pass=passes-1;pass>=0;pass--){
    const opacity=1-Math.pow(1-target,weights[pass]/sum)
    ctx.globalAlpha=opacity
    shadowPath(ctx,fig,light,radius*(1+pass*(soft*.42+Math.min(.65,alt/400))))
    ctx.fill()
  }
  ctx.globalAlpha=1
  // AO belongs only to actual foot contact; stale airborne anchors are ignored.
  if(height>=-1.5){
    ctx.fillStyle=rgba('#0c0a20',alpha*.45)
    const unique=new Set((opts.contacts??[]).filter(Number.isFinite).map(x=>Math.round(x*4)/4))
    ctx.beginPath();for(const x of unique){ctx.moveTo(x+6*scale,2);ctx.ellipse(x,2,6*scale,1.6*scale,0,0,Math.PI*2)}ctx.fill()
  }
  ctx.restore()
}
export function drawStrobeRim(ctx:CanvasRenderingContext2D,light:KeyLight,k:number,chains:number[][],head:{x:number;y:number;r:number},face:number,lineW:number,color='#cfe4ff'):void {
  const amount=clamp01(finite(k,0));if(amount<.04)return
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=rgba(color,amount*.2)
  ctx.lineWidth=.65;ctx.beginPath()
  const off=-clamp(finite(light.dirX,0),-1,1)*finite(face,1)*(clamp(finite(lineW,5),.1,20)*.5+.5)
  for(const chain of chains){let started=false;for(let i=0;i+1<chain.length;i+=2){
    if(!Number.isFinite(chain[i])||!Number.isFinite(chain[i+1])){started=false;continue}
    if(!started)ctx.moveTo(chain[i]+off,chain[i+1]);else ctx.lineTo(chain[i]+off,chain[i+1]);started=true}}
  ctx.stroke();ctx.restore();void head
}
