/** Flat Ronin ink over solved XY landmarks. Depth remains in the rig for
 * motion, blade projection and transport; it does not drive paint or width. */
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
function surface(ctx: CanvasRenderingContext2D, profile: SurfacePoint[], color: string): void {
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
  ctx.fillStyle = color; ctx.fill()
  ctx.strokeStyle = color; ctx.lineWidth = .45; ctx.stroke()
}
const withRadius = (p: Point, radius: number): SurfacePoint => ({ ...p, radius })

function segmentProfile(a: Point, hinge: Point, b: Point, r: readonly number[]): SurfacePoint[] {
  return [
    withRadius(a, r[0]), withRadius(mix(a, hinge, .34), r[1]),
    withRadius(mix(a, hinge, .76), r[2]), withRadius(hinge, r[3]),
    withRadius(mix(hinge, b, .30), r[4]), withRadius(mix(hinge, b, .70), r[5]),
    withRadius(b, r[6]),
  ]
}

const CROWN = [
  {x:-4.4,y:2}, {x:-5.7,y:-2.3}, {x:-6.6,y:-4.9}, {x:-4.3,y:-5.8},
  {x:-5.0,y:-7.3}, {x:-1.6,y:-7.4}, {x:.2,y:-7.8}, {x:1.8,y:-7.2},
  {x:5.2,y:-7.4}, {x:4.1,y:-5.1}, {x:5.5,y:-3.8}, {x:4.6,y:-2},
  {x:5.6,y:.3}, {x:4.5,y:.9}, {x:4.5,y:3.3}, {x:1.6,y:5.5}, {x:-3.1,y:4.2},
]

/** Shared production palm/finger shape, also used for isolated design studies. */
export function drawArticulatedHand(ctx:CanvasRenderingContext2D,color:string,open:number):void{
// Palm/fingers sized to the 6.6-unit hand in PLAYER_SPEC. At 1.19 the palm
// measured ~3.2 units — a nub on the end of the old 10-unit arm, which is
// half of why the limb read as a monster with a mitten. 1.52 puts the whole
// hand (palm + fist mass) at the spec length; the wrist origin stays fixed
// so weapon grips and arm lengths do not move.
ctx.save();ctx.scale(1.52,1.52)
const o=clamp01(open)
ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round'
// ── palm: ONE smooth block from the wrist to the knuckle line. The old path
// was four straight edges with quadratic corners, which at this scale drew a
// dark rhombus on the end of the arm.
ctx.lineWidth=.5
ctx.beginPath()
ctx.moveTo(-.95,-1);ctx.quadraticCurveTo(.9,-1.45,2.15,-1.15)
ctx.quadraticCurveTo(2.6,-.55,2.55,0)
ctx.quadraticCurveTo(2.6,.55,2.15,1.15)
ctx.quadraticCurveTo(.9,1.45,-.95,1)
ctx.quadraticCurveTo(-1.35,0,-.95,-1)
ctx.closePath();ctx.fill();ctx.stroke()
if(o<.55){
  // ── closed fist: the curled fingers are ONE rounded mass with soft knuckle
  // seams. Four curled 3-segment polylines is precisely what made the hand
  // read as a cluster of crystal spikes.
  const t=1-o/.55,reach=.85+.3*t
  ctx.beginPath()
  ctx.moveTo(1.9,-1.02);ctx.quadraticCurveTo(2.55+reach,-.92,2.6+reach,0)
  ctx.quadraticCurveTo(2.55+reach,.92,1.9,1.02)
  ctx.quadraticCurveTo(1.45,0,1.9,-1.02)
  ctx.closePath();ctx.fill()
  ctx.lineWidth=.16
  for(const ky of [-.62,-.21,.21,.62]){
    ctx.beginPath();ctx.moveTo(2.05,ky)
    ctx.quadraticCurveTo(2.35,ky*.9,2.3+reach*.8,ky*.72);ctx.stroke()
  }
}else{
  // ── open hand: four tapered fingers, round caps, a single gentle curl
  // (no zig-zag), spreading as the hand opens.
  const k=(o-.55)/.45
  for(let i=0;i<4;i++){
    const spread=(i-1.5)*.22*k, len=[2.5,2.9,2.65,2.15][i], by=(i-1.5)*.6
    ctx.lineWidth=.7-i*.04
    const kx=1.9+Math.cos(spread-.1)*len*.55, ky=by+Math.sin(spread-.1)*len*.55
    const tx=kx+Math.cos(spread+.22)*len*.45, ty=ky+Math.sin(spread+.22)*len*.45
    ctx.beginPath();ctx.moveTo(1.85,by);ctx.quadraticCurveTo(kx,ky,tx,ty);ctx.stroke()
  }
}
// ── thumb: a rounded pad folding over the grip.
ctx.lineWidth=.9
ctx.beginPath();ctx.moveTo(-.2,-.88)
ctx.quadraticCurveTo(1.1,-1.5-o*.25,1.8+o*.3,-.5-o*.45);ctx.stroke()
ctx.restore()
}

function silhouette(ctx: CanvasRenderingContext2D, g: FighterGeom, color: string, opts: FighterDrawOpts): void {
  const fill = (points: Point[]) => {
    outline(ctx, points)
    ctx.fillStyle = color
    ctx.fill()
  }
  for (const [h,k,a,t] of [[g.hipPtL,g.kneeL,g.ankleL,g.toeL],[g.hipPtR,g.kneeR,g.ankleR,g.toeR]] as const) {
    surface(ctx, segmentProfile(h,k,a,[4.2,4.35,3.1,2.0,2.75,1.9,1.35]), color)
    fill([{x:a.x-2.4,y:a.y-2}, {x:a.x+2,y:a.y-2},
      {x:t.x+1.4,y:t.y-1},{x:t.x+1.8,y:t.y+1.8},{x:a.x-2.5,y:a.y+2}])
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
  // V-taper fitted to the LEAN arm: pelvis 5.2 → waist 4.5 → ribcage 9.6,
  // with the lat flare landing on a 3.4 deltoid. Holding the old 10.9
  // shoulder half-width against slim arms produced a pyramid under a pair of
  // sticks — the girdle has to shrink with the limbs or neither reads.
  fill([at(-.09,-4.4),at(0,-5.2),at(.32,-4.5),at(.73,-8.6),at(.98,-9.6),
    at(1.08,-3),at(1.08,3),at(.98,9.6),at(.73,8.6),at(.32,4.5),at(0,5.2),at(-.09,4.4)])
  // No thigh-length gi flaps: they fused into a low diaper-shaped crotch.
  // The pelvis contour ends at the femoral heads; legs supply the rest.
  // Raised collar and short split obi ends sit behind the arms.
  fill([at(.94,-6.6),at(1.14,-5.3),at(1.18,4.0),at(.96,6.6)])
  const energy=clamp01(opts.motionEnergy??0),flutter=Math.sin((opts.time??0)*7)*(.3+energy*1.1)
  ctx.beginPath();ctx.moveTo(g.hip.x-5,g.hip.y-1)
  ctx.quadraticCurveTo(g.hip.x-12,g.hip.y-5-flutter,g.hip.x-18-energy*3,g.hip.y-2-flutter)
  ctx.lineTo(g.hip.x-14,g.hip.y-5-flutter);ctx.lineTo(g.hip.x-5,g.hip.y-3);ctx.closePath()
  ctx.fillStyle=color;ctx.fill()
  surface(ctx,[withRadius(g.chest,3.5),withRadius(g.neckTop,2.7),withRadius(mix(g.neckTop,g.headC,.65),2.8)],
    color)
  const gesture=opts.hands??{leftOpen:.2,rightOpen:0,leftRoll:0,rightRoll:0}
  for(const [sh,el,wr,open,roll] of [
    [g.shoulderL,g.elbL,g.handL,gesture.leftOpen,gesture.leftRoll],
    [g.shoulderR,g.elbR,g.handR,gesture.rightOpen,gesture.rightRoll],
  ] as const){
    const ux=el.x-sh.x,uy=el.y-sh.y,fx=wr.x-el.x,fy=wr.y-el.y
    const flex=.5*(1-(ux*fx+uy*fy)/(Math.hypot(ux,uy)*Math.hypot(fx,fy)||1))
    // LEAN fighter arm (deltoid → bicep → elbow → forearm → wrist). The old
    // profile ran a 5.15 deltoid and a 4.95 bicep — a 10-unit-wide limb on a
    // 22-unit upper arm, as wide as the skull, which read as a brute/golem
    // mass rather than a martial artist. This one is 3.4 at the deltoid and
    // tapers MONOTONICALLY through the elbow (1.7) into the forearm belly
    // (2.25) and a 1.15 wrist: one continuous taper, no flare-pinch-flare,
    // so the outline has no diamond nodes left in it. Bicep still flexes
    // with elbow bend so a chambered arm reads as loaded, not tubular.
    surface(ctx,segmentProfile(sh,el,wr,[3.4,3.2+.22*flex,2.55,1.7,2.25,1.85,1.15]),color)
    // Keep the original solved wrist and finger gesture, without Z magnification.
    const angle=Math.atan2(wr.y-el.y,wr.x-el.x)+roll
    ctx.save();ctx.translate(wr.x,wr.y);ctx.rotate(angle)
    drawArticulatedHand(ctx,color,open);ctx.restore()
  }
  ctx.save();ctx.translate(g.headC.x,g.headC.y);ctx.rotate(g.headAng);ctx.scale(.88,.92)
  // Compact swept crown, softened nose, slightly stronger jaw; no ponytail.
  ctx.beginPath();ctx.moveTo(CROWN[0].x,CROWN[0].y)
  for(let i=1;i<CROWN.length;i++)ctx.lineTo(CROWN[i].x,CROWN[i].y)
  ctx.closePath()
  ctx.fillStyle = color; ctx.fill()
  ctx.restore()
}

/** Authored matte-black Ronin. World light never changes the body pigment. */
export function drawHumanoid(ctx:CanvasRenderingContext2D,g:FighterGeom,_style:StickStyle,opts:FighterDrawOpts={}):void {
  const alpha=clamp01(opts.alpha??1)*clamp01(opts.ghostAlpha??1)
  if(alpha<=.001)return
  ctx.save();ctx.globalAlpha*=alpha;ctx.lineJoin='round';ctx.lineCap='round'
  const nodes = opts.scarfNodes, tail = Math.min(nodes?.length ?? 0, opts.scarfCount ?? 0)
  if (!opts.ghost && nodes && tail >= 2) {
    // The anchored Verlet nodes still supply the exact same polygon.
    const tip = nodes[tail - 1]
    ctx.beginPath(); ctx.moveTo(nodes[0].x - 1, nodes[0].y - 1.3)
    for (let i = 1; i < tail; i++) ctx.lineTo(nodes[i].x, nodes[i].y - 1.5 * (1 - i / tail))
    ctx.lineTo(tip.x + .6, tip.y + 1.8)
    for (let i = tail - 2; i >= 0; i--) ctx.lineTo(nodes[i].x + .75, nodes[i].y + 2.8 * (1 - i / tail))
    ctx.closePath()
    ctx.fillStyle = ctx.strokeStyle = '#000'
    ctx.lineWidth = .44; ctx.fill(); ctx.stroke()
  }
  silhouette(ctx,g,opts.ghost ?? '#000',opts)
  // Impact flashes remain an explicit temporary combat effect, not clothing.
  if((opts.flash??0)>.02){ctx.save();ctx.globalAlpha*=clamp01(opts.flash??0);silhouette(ctx,g,opts.flashColor??'#fff',opts);ctx.restore()}
  ctx.restore()
}
