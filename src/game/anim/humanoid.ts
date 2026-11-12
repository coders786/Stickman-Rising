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

/** DEPTH SCALE — the single technique that separates a foreshortened limb
 * from a broken stub.
 *
 * A limb pointing at the camera compresses along its LENGTH (the perspective
 * projection does that for free: measured 20.4 -> 2.2 units at full yaw).
 * But a stick figure drawn with constant line weight then reads as a
 * SHORTENED STICK, not a limb coming at you, because the near end never
 * grows. Reference art is explicit that the fix is the opposite of what the
 * word suggests: "when a limb points at the viewer, draw it LARGER, not
 * smaller" — the wrist must occupy more pixels than the shoulder.
 *
 * So every limb radius is scaled by the perspective factor at ITS OWN
 * depth. The camera FOCUS is 620 (near-orthographic, only 8.9% scale across
 * the whole reachable depth range), which is far too subtle to carry the
 * read on its own, so the effect is deliberately exaggerated here: this is
 * the one place the renderer departs from the camera's true maths, and it
 * is a drawing law rather than a projection.
 */
const DEPTH_GAIN = 5.0
function depthScale(z: number): number {
  const p = 620 / (620 - z)          // the camera's true perspective factor
  return 1 + (p - 1) * DEPTH_GAIN    // exaggerated to a readable amount
}
/**
 * THE HAND MAGNIFIES HARDER THAN THE LIMB.
 *
 * Dillon Wright's limb experiment ("Foreshortening and Limb Length in
 * Perspective Made Easy", 2023) measured hand size against arm angle across
 * hundreds of cartoon frames: at 45 deg the hand is ~1.5x, pointed straight
 * at the viewer it is 2.0x (safe), 2.5x (splits the difference) to 3.0x
 * (exaggerated but reads normal). Drawlikeasir's foreshortening tutorial
 * puts the same rule on the shoulder/elbow/wrist circle stack -- "the more
 * the circles overlap, the more foreshortened it looks", and the wrist is
 * the smallest circle normally, so most of the growth lands on the hand.
 *
 * That is a far bigger multiplier than the taper on the limb itself, and it
 * is anchored to the NEUTRAL wrist depth so a resting hand stays exactly 1.0.
 */
const HAND_GAIN = 14.0          // toward the camera: 1.0 -> ~2.05 at full yaw
const HAND_FAR_GAIN = 4.0       // away: 1.0 -> ~0.78, readably smaller, never a dot
const HAND_MIN = 0.7, HAND_MAX = 2.2
const WRIST_REST_Z = 7.84              // measured: neutral-pose wrist depth
const REST_P = 620 / (620 - WRIST_REST_Z)
function handScale(z: number): number {
  const d = (620 / (620 - z)) - REST_P
  // Asymmetric on purpose: growth toward the viewer is the readable half of
  // foreshortening, and the far hand only needs to lose a little size before
  // it reads as behind. A single gain either saturated the far side into a
  // flat 0.75 within 3 units or shrank a pointing-away arm to a 0.22 dot.
  const s = 1 + d * (d >= 0 ? HAND_GAIN : HAND_FAR_GAIN)
  return s < HAND_MIN ? HAND_MIN : s > HAND_MAX ? HAND_MAX : s
}
function segmentProfile(
  a: Point, hinge: Point, b: Point, radii: number[],
  za = 0, zh = 0, zb = 0,
): SurfacePoint[] {
  const sa = depthScale(za), sh = depthScale(zh), sb = depthScale(zb)
  // the two intermediate points on each bone interpolate their own depth so
  // the taper stays smooth instead of stepping at the joint
  const s1 = sa + (sh - sa) * .34, s2 = sa + (sh - sa) * .76
  const s4 = sh + (sb - sh) * .30, s5 = sh + (sb - sh) * .70
  return [
    withRadius(a, radii[0] * sa), withRadius(mix(a, hinge, .34), radii[1] * s1),
    withRadius(mix(a, hinge, .76), radii[2] * s2), withRadius(hinge, radii[3] * sh),
    withRadius(mix(hinge, b, .30), radii[4] * s4), withRadius(mix(hinge, b, .70), radii[5] * s5),
    withRadius(b, radii[6] * sb),
  ]
}

/** A single matte-black contour language. No internal skin/costume lines.
 * Pure #000 body, including face. Short hair, no tied tail, no glow details. */
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

function silhouette(ctx:CanvasRenderingContext2D,g:FighterGeom,color:string,opts:FighterDrawOpts):void {
  // every limb is drawn with its joints' true depths, so the near end of a
  // limb aimed at the camera widens while its length compresses
  const limb=(a:Point,b:Point,c:Point,r:number[],za=0,zb=0,zc=0)=>
    surface(ctx,segmentProfile(a,b,c,r,za,zb,zc),color)
  for(const [h,k,a,t] of [[g.hipPtL,g.kneeL,g.ankleL,g.toeL],[g.hipPtR,g.kneeR,g.ankleR,g.toeR]]){
    limb(h,k,a,[4.2,4.35,3.1,2.0,2.75,1.9,1.35],h.z,k.z,a.z)
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
  // V-taper fitted to the LEAN arm: pelvis 5.2 → waist 4.5 → ribcage 9.6,
  // with the lat flare landing on a 3.4 deltoid. Holding the old 10.9
  // shoulder half-width against slim arms produced a pyramid under a pair of
  // sticks — the girdle has to shrink with the limbs or neither reads.
  outline(ctx,[at(-.09,-4.4),at(0,-5.2),at(.32,-4.5),at(.73,-8.6),at(.98,-9.6),
    at(1.08,-3),at(1.08,3),at(.98,9.6),at(.73,8.6),at(.32,4.5),at(0,5.2),at(-.09,4.4)])
  ctx.fillStyle=color;ctx.fill()
  // No thigh-length gi flaps: they fused into a low diaper-shaped crotch.
  // The pelvis contour ends at the femoral heads; legs supply the rest.
  // Raised collar and short split obi ends stylize the OUTLINE only.
  // No colored headband, cape, ponytail or interior clothing highlights.
  const collar=(t:number,w:number)=>at(t,w)
  outline(ctx,[collar(.94,-6.6),collar(1.14,-5.3),collar(1.18,4.0),collar(.96,6.6)])
  ctx.fillStyle=color;ctx.fill()
  const energy=clamp01(opts.motionEnergy??0),flutter=Math.sin((opts.time??0)*7)*(.3+energy*1.1)
  ctx.beginPath();ctx.moveTo(g.hip.x-5,g.hip.y-1)
  ctx.quadraticCurveTo(g.hip.x-12,g.hip.y-5-flutter,g.hip.x-18-energy*3,g.hip.y-2-flutter)
  ctx.lineTo(g.hip.x-14,g.hip.y-5-flutter);ctx.lineTo(g.hip.x-5,g.hip.y-3);ctx.closePath();ctx.fill()
  surface(ctx,[withRadius(g.chest,3.5),withRadius(g.neckTop,2.7),withRadius(mix(g.neckTop,g.headC,.65),2.8)],color)
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
    limb(sh,el,wr,[3.4,3.2+.22*flex,2.55,1.7,2.25,1.85,1.15],sh.z,el.z,wr.z)
    // Palm/fingers articulate around the solved wrist, not an offset fist.
    // Scaled by wrist depth LAST (innermost to the wrist) so rotation and
    // position stay exact while the hand itself grows toward the camera.
    ctx.save();ctx.translate(wr.x,wr.y);ctx.rotate(Math.atan2(wr.y-el.y,wr.x-el.x)+roll)
    const hs=handScale(wr.z);ctx.scale(hs,hs)
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
  // TWO TAPS — a moon-key sliver up-left and a weaker city-fill sliver on
  // the right — so the black figure separates from the night with light
  // rather than an outline.
  if((opts.rimAlpha??0)>.01){
    const rk=clamp01(opts.rimAlpha??0)
    ctx.save();ctx.globalAlpha*=rk*.44
    ctx.translate(-1.15,-.7);silhouette(ctx,g,opts.rimColor??'#b5c9da',opts);ctx.restore()
    ctx.save();ctx.globalAlpha*=rk*.3
    ctx.translate(1.05,-.3);silhouette(ctx,g,opts.rimColor??'#b5c9da',opts);ctx.restore()
  }
  silhouette(ctx,g,opts.ghost??'#000000',opts)
  // Impact flashes remain an explicit temporary combat effect, not clothing.
  if((opts.flash??0)>.02){ctx.save();ctx.globalAlpha*=clamp01(opts.flash??0);silhouette(ctx,g,opts.flashColor??'#fff',opts);ctx.restore()}
  ctx.restore()
}
