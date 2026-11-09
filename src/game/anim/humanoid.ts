/** Shadow Ronin — matte-black continuous anatomical silhouette renderer. No capsules, hinge discs or armor rings.
 * The skeleton is hidden: it supplies landmarks, not visible body primitives.
 */
import type { FighterGeom, FighterDrawOpts } from './rig3d'
import type { StickStyle } from './skeleton'
import { clamp01 } from '../core/utils'

type Point = { x: number; y: number }
type SurfacePoint = Point & { radius: number }
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** C1 contour through the midpoints of an anatomical profile. */
function outline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  const n = points.length
  const first = mix(points[n - 1], points[0], .5)
  ctx.beginPath(); ctx.moveTo(first.x, first.y)
  for (let i = 0; i < n; i++) {
    const end = mix(points[i], points[(i + 1) % n], .5)
    ctx.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y)
  }
  ctx.closePath()
}

/** One closed surface for an entire articulated limb, with muscle bellies,
 * tendon narrowing and a shared elbow/knee bend. Never separate bone tubes.
 */
function surface(ctx: CanvasRenderingContext2D, profile: SurfacePoint[], base: string): void {
  const left: Point[] = [], right: Point[] = []
  for (let i = 0; i < profile.length; i++) {
    const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)]
    const dx = next.x - prev.x, dy = next.y - prev.y
    const length = Math.hypot(dx, dy) || 1
    const p = profile[i]
    left.push({ x: p.x - dy / length * p.radius, y: p.y + dx / length * p.radius })
    right.push({ x: p.x + dy / length * p.radius, y: p.y - dx / length * p.radius })
  }
  outline(ctx, [...left, ...right.reverse()])
  ctx.fillStyle = base; ctx.fill()
  ctx.strokeStyle = base; ctx.lineWidth = .45; ctx.stroke()
}
const withRadius = (p: Point, radius: number): SurfacePoint => ({ ...p, radius })
function segmentProfile(a: Point, hinge: Point, b: Point, radii: number[]): SurfacePoint[] {
  return [
    withRadius(a, radii[0]), withRadius(mix(a, hinge, .34), radii[1]),
    withRadius(mix(a, hinge, .76), radii[2]), withRadius(hinge, radii[3]),
    withRadius(mix(hinge, b, .30), radii[4]), withRadius(mix(hinge, b, .70), radii[5]),
    withRadius(b, radii[6]),
  ]
}

/** A single matte-black contour language. No internal skin/costume lines.
 * Pure #000 body, including face. Short hair, no tied tail, no glow details. */
/** Shared production palm/finger shape, also used for isolated design studies. */
export function drawArticulatedHand(ctx:CanvasRenderingContext2D,color:string,open:number):void{
// Match the palm/finger silhouette to the six-unit hand in PLAYER_SPEC;
// keep the wrist origin fixed so weapon grips and arm lengths do not move.
ctx.save();ctx.scale(1.12,1.12)
ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(-.7,-1)
ctx.quadraticCurveTo(.8,-1.9,2.2,-1.3);ctx.lineTo(2.7,.5)
ctx.quadraticCurveTo(1.5,1.8,-.8,1);ctx.closePath();ctx.fill()
ctx.strokeStyle=color;ctx.lineWidth=.8;ctx.lineCap='round'
// Three phalange segments curl toward the palm. The ring/little fingers
// rest more flexed than the index: a soft athletic hand, not four spikes.
for(let i=0;i<4;i++){
  const lengths=[2.8,3.2,2.95,2.35],curl=(1-open)*(1.18+i*.11)
  const spread=(i-1.5)*open*.18
  let x=1,y=(i-1.5)*.72,angle=spread
  ctx.beginPath();ctx.moveTo(x,y)
  for(const fraction of [.44,.33,.23]){
    x+=Math.cos(angle)*lengths[i]*fraction
    y+=Math.sin(angle)*lengths[i]*fraction
    ctx.lineTo(x,y);angle+=curl
  }
  ctx.stroke()
}
// Opposable thumb folds over the grip instead of pointing sideways.
ctx.beginPath();ctx.moveTo(-.1,-1)
ctx.quadraticCurveTo(1.4,-2.2-open*.45,2.1+open,-.35-open*1.8)
ctx.stroke();
ctx.restore()
}

function silhouette(ctx:CanvasRenderingContext2D,g:FighterGeom,color:string,opts:FighterDrawOpts):void {
  const limb=(a:Point,b:Point,c:Point,r:number[])=>surface(ctx,segmentProfile(a,b,c,r),color)
  for(const [h,k,a,t] of [[g.hipPtL,g.kneeL,g.ankleL,g.toeL],[g.hipPtR,g.kneeR,g.ankleR,g.toeR]]){
    limb(h,k,a,[4.6,4.9,3.45,2.25,3.05,2.05,1.4])
    outline(ctx,[{x:a.x-2.4,y:a.y-2}, {x:a.x+2,y:a.y-2},
      {x:t.x+1.4,y:t.y-1},{x:t.x+1.8,y:t.y+1.8},{x:a.x-2.5,y:a.y+2}]);ctx.fillStyle=color;ctx.fill()
  }
  const dx=g.chest.x-g.hip.x,dy=g.chest.y-g.hip.y,l=Math.hypot(dx,dy)||1
  // A continuous shallow C-curve follows waist and shoulder drive instead
  // of a rigid straight torso slab. Contour-only: no contact landmark moves.
  const waistLine=mix(g.hip,g.chest,.57)
  const at=(t:number,w:number)=>{
    const envelope=Math.sin(Math.PI*clamp01(t))
    const bow=-Math.min(1.5,Math.max(0,g.torsoAngle-.2)*2)*envelope
    return{x:g.hip.x+dx*t+(g.waist.x-waistLine.x)*envelope-dy/l*(w+bow),
      y:g.hip.y+dy*t+(g.waist.y-waistLine.y)*envelope+dx/l*(w+bow)}
  }
  outline(ctx,[at(-.09,-4.5),at(0,-5.4),at(.32,-4.6),at(.73,-8.6),at(.98,-10.1),
    at(1.08,-3),at(1.08,3),at(.98,10.1),at(.73,8.6),at(.32,4.6),at(0,5.4),at(-.09,4.5)])
  ctx.fillStyle=color;ctx.fill()
  // No thigh-length gi flaps: they fused into a low diaper-shaped crotch.
  // The pelvis contour ends at the femoral heads; legs supply the rest.
  // Raised collar and short split obi ends stylize the OUTLINE only.
  // No colored headband, cape, ponytail or interior clothing highlights.
  const collar=(t:number,w:number)=>at(t,w)
  outline(ctx,[collar(.94,-6),collar(1.14,-4.8),collar(1.18,3.6),collar(.96,6)])
  ctx.fillStyle=color;ctx.fill()
  const energy=clamp01(opts.motionEnergy??0),flutter=Math.sin((opts.time??0)*7)*(.3+energy*1.1)
  ctx.beginPath();ctx.moveTo(g.hip.x-5,g.hip.y-1)
  ctx.quadraticCurveTo(g.hip.x-12,g.hip.y-5-flutter,g.hip.x-18-energy*3,g.hip.y-2-flutter)
  ctx.lineTo(g.hip.x-14,g.hip.y-5-flutter);ctx.lineTo(g.hip.x-5,g.hip.y-3);ctx.closePath();ctx.fill()
  surface(ctx,[withRadius(g.chest,3.1),withRadius(g.neckTop,2.4),withRadius(mix(g.neckTop,g.headC,.65),2.5)],color)
  const gesture=opts.hands??{leftOpen:.2,rightOpen:0,leftRoll:0,rightRoll:0}
  for(const [sh,el,wr,open,roll] of [
    [g.shoulderL,g.elbL,g.handL,gesture.leftOpen,gesture.leftRoll],
    [g.shoulderR,g.elbR,g.handR,gesture.rightOpen,gesture.rightRoll],
  ] as const){
    const ux=el.x-sh.x,uy=el.y-sh.y,fx=wr.x-el.x,fy=wr.y-el.y
    const flex=.5*(1-(ux*fx+uy*fy)/(Math.hypot(ux,uy)*Math.hypot(fx,fy)||1))
    // Re-composed taper: triceps mass -> elbow pinch -> forearm -> wrist.
    limb(sh,el,wr,[3.85,3.6+.3*flex,2.5,1.65,2.55,1.65,1.08])
    // Palm/fingers articulate around the solved wrist, not an offset fist.
    ctx.save();ctx.translate(wr.x,wr.y);ctx.rotate(Math.atan2(wr.y-el.y,wr.x-el.x)+roll)
    drawArticulatedHand(ctx,color,open);ctx.restore()
  }
  ctx.save();ctx.translate(g.headC.x,g.headC.y);ctx.rotate(g.headAng);ctx.scale(.88,.92)
  // Compact swept crown, softened nose, slightly stronger jaw; no ponytail.
  ctx.beginPath();ctx.moveTo(-4.4,2);ctx.lineTo(-5.7,-2.3);ctx.lineTo(-6.6,-4.9)
  ctx.lineTo(-4.3,-5.8);ctx.lineTo(-5.0,-7.3);ctx.lineTo(-1.6,-7.4)
  ctx.lineTo(.2,-7.8);ctx.lineTo(1.8,-7.2);ctx.lineTo(5.2,-7.4)
  ctx.lineTo(4.1,-5.1);ctx.lineTo(5.5,-3.8);ctx.lineTo(4.6,-2)
  ctx.lineTo(5.6,.3);ctx.lineTo(4.5,.9);ctx.lineTo(4.5,3.3)
  ctx.lineTo(1.6,5.5);ctx.lineTo(-3.1,4.2);ctx.closePath();ctx.fillStyle=color;ctx.fill()
  ctx.restore()
}

/** Matte black player surface, also used by dash/ability echoes. */
export function drawHumanoid(ctx:CanvasRenderingContext2D,g:FighterGeom,_style:StickStyle,opts:FighterDrawOpts={}):void {
  const alpha=clamp01(opts.alpha??1)*clamp01(opts.ghostAlpha??1)
  if(alpha<=.001)return
  ctx.save();ctx.globalAlpha*=alpha;ctx.lineJoin='round';ctx.lineCap='round'
  // Thin whole-contour rim goes BEHIND the opaque surface. No bone overlay.
  if((opts.rimAlpha??0)>.01){
    ctx.save();ctx.globalAlpha*=clamp01(opts.rimAlpha??0)*.24
    ctx.translate(-.65,-.25);silhouette(ctx,g,opts.rimColor??'#b5c9da',opts);ctx.restore()
  }
  silhouette(ctx,g,opts.ghost??'#000000',opts)
  // Impact flashes remain an explicit temporary combat effect, not clothing.
  if((opts.flash??0)>.02){ctx.save();ctx.globalAlpha*=clamp01(opts.flash??0);silhouette(ctx,g,opts.flashColor??'#fff',opts);ctx.restore()}
  ctx.restore()
}
