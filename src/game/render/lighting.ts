/** Ground-shadow rewrite, pass 3: bounded penumbra, normalized compositing and contacts.
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
export function keyLightFromStorm(intensity:number,azimuth:number):KeyLight {
  const k=clamp01(finite(intensity,0)),az=clamp(finite(azimuth,0),-1,1)
  // Bolt-strobe mode (k→1): hard, bright, near-white, raking toward the bolt.
  // Moon mode (k→0): KEY LIGHT = moon upper-right — LOW elevation so shadows
  // rake LONG down-left across the deck (~1.5 body-lengths at elev .58),
  // soft-edged, violet-black (invented chroma — real moonlight is gray).
  return {dirX:lerp(-.85,-.92*az,k),elev:lerp(.58,.42,k),hard:lerp(.12,1,k),
    i:lerp(.62,1,k),color:'#050310'}
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
  const rx=radius,ry=Math.max(.5,radius*.32)
  const ellipse=(x:number,y:number,xr=rx,yr=ry)=>{ctx.moveTo(x+xr,y);ctx.ellipse(x,y,xr,yr,0,0,Math.PI*2)}
  ctx.beginPath()
  for(const chain of fig.chains){
    let prev:{x:number;y:number}|null=null
    for(let i=0;i+1<chain.length;i+=2){
      const q=projectGroundPoint(chain[i],chain[i+1],light)
      if(!q){prev=null;continue}
      ellipse(q.x,q.y)
      if(prev){const dx=q.x-prev.x,dy=q.y-prev.y,l=Math.hypot(dx,dy)||1
        const nx=-dy/l*rx,ny=dx/l*ry
        // Same winding as ellipses, so overlapping shapes form a solid union.
        ctx.moveTo(prev.x-nx,prev.y-ny);ctx.lineTo(q.x-nx,q.y-ny)
        ctx.lineTo(q.x+nx,q.y+ny);ctx.lineTo(prev.x+nx,prev.y+ny);ctx.closePath()}
      prev=q
    }
  }
  if(fig.head){const q=projectGroundPoint(fig.head.x,fig.head.y,light)
    if(q){const r=clamp(finite(fig.head.r,6),1,30);ellipse(q.x,q.y,r*.9+radius*.25,Math.max(1,r*.26))}}
  if(fig.blade){const b=fig.blade,a=projectGroundPoint(b.x0,b.y0,light),z=projectGroundPoint(b.x1,b.y1,light)
    if(a&&z){const r=Math.max(.7,radius*.22)
      ctx.moveTo(a.x,a.y-r);ctx.lineTo(z.x,z.y-r);ctx.lineTo(z.x,z.y+r);ctx.lineTo(a.x,a.y+r);ctx.closePath()}}
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
  const target=alpha*(.8+.2*clamp01(finite(opts.lightBoost??light.i,.55)))
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
  shade.addColorStop(.55,rgba(tint,.7))
  shade.addColorStop(1,rgba(tint,.26))
  ctx.fillStyle=shade
  // Outside-in soft passes. Normalize accumulated center opacity so adding
  // quality passes cannot darken the entire character shadow three times.
  for(let pass=passes-1;pass>=0;pass--){
    const opacity=1-Math.pow(1-target,weights[pass]/sum)
    ctx.globalAlpha=opacity
    shadowPath(ctx,fig,light,radius*(1+pass*(soft*.65+Math.min(.65,alt/400))))
    ctx.fill()
  }
  ctx.globalAlpha=1
  // AO belongs only to actual foot contact; stale airborne anchors are ignored.
  if(height>=-1.5){
    ctx.fillStyle=rgba('#010307',alpha*.35)
    const unique=new Set((opts.contacts??[]).filter(Number.isFinite).map(x=>Math.round(x*4)/4))
    ctx.beginPath();for(const x of unique){ctx.moveTo(x+6*scale,2);ctx.ellipse(x,2,6*scale,1.6*scale,0,0,Math.PI*2)}ctx.fill()
  }
  ctx.restore()
}
export function drawStrobeRim(ctx:CanvasRenderingContext2D,light:KeyLight,k:number,chains:number[][],head:{x:number;y:number;r:number},face:number,lineW:number):void {
  const amount=clamp01(finite(k,0));if(amount<.04)return
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=rgba('#cfe4ff',amount*.16)
  ctx.lineWidth=.65;ctx.beginPath()
  const off=-clamp(finite(light.dirX,0),-1,1)*finite(face,1)*(clamp(finite(lineW,5),.1,20)*.5+.5)
  for(const chain of chains){let started=false;for(let i=0;i+1<chain.length;i+=2){
    if(!Number.isFinite(chain[i])||!Number.isFinite(chain[i+1])){started=false;continue}
    if(!started)ctx.moveTo(chain[i]+off,chain[i+1]);else ctx.lineTo(chain[i]+off,chain[i+1]);started=true}}
  ctx.stroke();ctx.restore();void head
}
