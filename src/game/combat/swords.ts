/** STICKMAN RISING — grounded sword families, workshop upgrades + renderer. */

import { clamp, clamp01, rgba } from '../core/utils'

export type SwordId = 'katana' | 'wakizashi' | 'chokuto' | 'saber' | 'nodachi' | 'greatblade' | 'inferno' | 'thunder' | 'frost' | 'gale' | 'earth' | 'void' | 'gravity' | 'phantom'
export type SwordForm = 'katana' | 'short' | 'straight' | 'saber' | 'nodachi' | 'greatblade'

export interface SwordUpgrade {
  name: string; title: string; kills: number
  statScale: { dmg: number; spd: number; range: number }
  craft: 'field' | 'tempered' | 'awakened'
  /** The rebuild's combat grammar, surfaced in the arsenal and consumed by
   * elemental technique routing. */
  style: string
  fxLevel: 0 | 1 | 2
  perk: string
}
export interface SwordDef {
  id: SwordId; name: string; title: string; desc: string; form: SwordForm
  upgrades: readonly [SwordUpgrade, SwordUpgrade, SwordUpgrade]
  currentCraft?: SwordUpgrade['craft']
  currentTier?: 0 | 1 | 2
  mundane?: boolean
  /** A one-man-army form refuses a multi-blade loadout. */
  solo?: boolean
  confidence?: number
  colors: { blade:string; core:string; glow:string; trail:string; trail2:string; accent:string }
  stats: { dmg:number; spd:number; range:number }
  unlockKills:number
  ability:{ name:string; desc:string; cost:number }
  ult:{ name:string; desc:string }
  trailWidth:number
}

/** The first six are practical steel families. Experimental blades are late
 * workshop discoveries rather than the opening fantasy power curve. */
export const SWORD_ORDER: SwordId[] = ['katana','wakizashi','chokuto','saber','nodachi','greatblade','inferno','thunder','frost','gale','earth','void','gravity','phantom']

const path=(base:string,refined:string,master:string,at:number,perk:string):readonly [SwordUpgrade,SwordUpgrade,SwordUpgrade]=>[
 {name:base,title:'WORKSHOP ISSUE',kills:at,statScale:{dmg:1,spd:1,range:1},craft:'field',style:'Core form',fxLevel:0,perk:'Plain, dependable construction.'},
 {name:refined,title:'BALANCED REBUILD',kills:at+90,statScale:{dmg:1.055,spd:1.025,range:1.015},craft:'tempered',style:'Refined form',fxLevel:1,perk:'New tang, edge geometry and fittings; modest gains without power creep.'},
 {name:master,title:'MASTERWORK REBUILD',kills:at+260,statScale:{dmg:1.11,spd:1.045,range:1.03},craft:'awakened',style:'Master form',fxLevel:2,perk},
]
const katanaPath:readonly [SwordUpgrade,SwordUpgrade,SwordUpgrade]=[
 {name:'PRACTICE KATANA',title:'PLAIN CARBON STEEL',kills:0,statScale:{dmg:1,spd:1,range:1},craft:'field',style:'Fundamental form',fxLevel:0,perk:'Skill only: clean edge alignment, measured draw and honest recovery.'},
 {name:'MURASAMA',title:'MASTER-POLISHED STEEL',kills:180,statScale:{dmg:1.08,spd:1.045,range:1.015},craft:'tempered',style:'Draw-cut form',fxLevel:0,perk:'A lighter polish and exact balance sharpen draw timing; still no elemental effect.'},
 {name:'HEAVENLY STEEL',title:'ONE-MAN-ARMY FORM',kills:520,statScale:{dmg:1.16,spd:1.08,range:1.025},craft:'awakened',style:'Complete sword form',fxLevel:0,perk:'Confidence, discipline and complete technique. This form cannot share a loadout.'},
]

const elementPath=(base:string,refined:string,prime:string,at:number,forms:[string,string,string],perks:[string,string,string]):readonly [SwordUpgrade,SwordUpgrade,SwordUpgrade]=>[
 {name:base,title:'ELEMENTAL FORM I',kills:at,statScale:{dmg:1,spd:1,range:1},craft:'field',style:forms[0],fxLevel:0,perk:perks[0]},
 {name:refined,title:'ELEMENTAL FORM II',kills:at+140,statScale:{dmg:1.1,spd:1.04,range:1.025},craft:'tempered',style:forms[1],fxLevel:1,perk:perks[1]},
 {name:prime,title:'ELEMENTAL FORM III',kills:at+380,statScale:{dmg:1.22,spd:1.08,range:1.05},craft:'awakened',style:forms[2],fxLevel:2,perk:perks[2]},
]

export function swordTier(id:SwordId,totalKills:number):0|1|2 { const u=SWORDS[id].upgrades; return totalKills>=u[2].kills?2:totalKills>=u[1].kills?1:0 }
export function upgradedSword(id:SwordId,tier:0|1|2):SwordDef { const b=SWORDS[id],u=b.upgrades[tier]; const katana=id==='katana'; return {...b,name:u.name,title:u.title,currentCraft:u.craft,currentTier:tier,solo:katana&&tier===2,confidence:katana?1+tier*.04:1,ability:katana?{name:tier===0?'CUT AND SLASH':tier===1?'MURASAMA DRAW':'HEAVENLY DRAW',desc:tier===0?'A precise crossing cut with no elemental aid.':tier===1?'A master-polished draw, passing cut and disciplined catch.':'The complete draw-cut form; confidence replaces spectacle.',cost:30}:b.ability,ult:katana?{name:tier===0?'CUT AND SLASH':tier===1?'MURASAMA':'HEAVENLY STEEL',desc:tier===0?'Five practical cuts linked by footwork.':tier===1?'A master draw sequence with exact edge alignment.':'The final skill-only sword form.'}:b.ult,stats:{dmg:b.stats.dmg*u.statScale.dmg,spd:b.stats.spd*u.statScale.spd,range:b.stats.range*u.statScale.range},trailWidth:b.trailWidth*(1+tier*.05)} }

const steel=(blade:string,core:string,trail:string,shadow:string,accent:string)=>({blade,core,glow:trail,trail,trail2:shadow,accent})
export const SWORDS:Record<SwordId,SwordDef>={
 katana:{id:'katana',name:'PRACTICE KATANA',title:'PLAIN CARBON STEEL',form:'katana',mundane:true,confidence:1,desc:'Plain differentially hardened carbon steel, wood core tsuka, ray skin and cotton wrap. It has no glow, element or hidden power; rain and neglect wear the polish.',upgrades:katanaPath,colors:steel('#5e6568','#c5cbc9','#8d9697','#292e30','#9ba2a1'),stats:{dmg:1,spd:1.06,range:1},unlockKills:0,ability:{name:'CUT AND SLASH',desc:'A low passing draw and immediate returning cut.',cost:30},ult:{name:'CUT AND SLASH',desc:'Five practical cuts linked by confident footwork.'},trailWidth:.92},
 wakizashi:{id:'wakizashi',name:'TRAVEL WAKIZASHI',title:'WORKSHOP ISSUE',form:'short',desc:'Short, quick and forgiving in close quarters; built around pivots and return cuts.',upgrades:path('TRAVEL WAKIZASHI','COURT WAKIZASHI','MASTER WAKIZASHI',25,'Lightened fittings make close cancels cleaner.'),colors:steel('#c8c1b2','#fffaf0','#d8c8a5','#5b5142','#eee0bd'),stats:{dmg:.88,spd:1.2,range:.86},unlockKills:25,ability:{name:'TURNING PAIR',desc:'Two close cuts around a planted pivot.',cost:27},ult:{name:'EIGHT CORNERS',desc:'Compact cuts from alternating guards.'},trailWidth:.82},
 chokuto:{id:'chokuto',name:'BLACK CHOKUTO',title:'WORKSHOP ISSUE',form:'straight',desc:'Straight-backed blade for direct entries, thrusts and hard-line interception.',upgrades:path('BLACK CHOKUTO','FOLDED CHOKUTO','MASTER CHOKUTO',65,'Rigid spine improves thrust stability and guard damage.'),colors:steel('#aeb4b5','#f3f5f2','#c3d0c9','#343b39','#dce5df'),stats:{dmg:1.04,spd:1.03,range:1.01},unlockKills:65,ability:{name:'STRAIGHT THROUGH',desc:'A driving thrust followed by a shoulder-led exit cut.',cost:32},ult:{name:'FOUR GATES',desc:'Four direct attacks with no wasted flourish.'},trailWidth:.94},
 saber:{id:'saber',name:'CAVALRY SABER',title:'WORKSHOP ISSUE',form:'saber',desc:'Forward-curved one-handed cutter with fast lateral movement and broad draw arcs.',upgrades:path('CAVALRY SABER','OFFICER SABER','MASTER SABER',110,'Counterweighted hilt improves moving cuts.'),colors:steel('#c7c9bd','#fffef4','#d9d6ad','#545345','#eee9c6'),stats:{dmg:.96,spd:1.14,range:1.03},unlockKills:110,ability:{name:'RUNNING MOULINET',desc:'A moving circular cut that keeps control of the centerline.',cost:31},ult:{name:'RIDING LINE',desc:'A sequence of passing saber cuts.'},trailWidth:.9},
 nodachi:{id:'nodachi',name:'FIELD NODACHI',title:'WORKSHOP ISSUE',form:'nodachi',desc:'Long battlefield steel with deliberate cadence and exceptional honest reach.',upgrades:path('FIELD NODACHI','REINFORCED NODACHI','MASTER NODACHI',170,'Reworked grip and spine make the long catch step recover sooner.'),colors:steel('#aeb9c2','#f8fbff','#b5cad8','#3f4c58','#d9e6ee'),stats:{dmg:1.2,spd:.9,range:1.14},unlockKills:170,ability:{name:'FALLING PINE',desc:'A high guard collapses into one weighty passing cut.',cost:36},ult:{name:'BATTLEFIELD FORM',desc:'Wide, grounded cuts that control space.'},trailWidth:1.18},
 greatblade:{id:'greatblade',name:'IRON GREATBLADE',title:'WORKSHOP ISSUE',form:'greatblade',desc:'Thick two-handed blade. Slowest family, but its leverage launches and breaks guards.',upgrades:path('IRON GREATBLADE','HOLLOW-GROUND BLADE','MASTER GREATBLADE',250,'Hollow grinding removes dead weight while preserving impact.'),colors:steel('#9da5a8','#edf0ef','#b8c0bd','#363c3d','#d6dcda'),stats:{dmg:1.32,spd:.82,range:1.1},unlockKills:250,ability:{name:'HALF-MOON BREAK',desc:'A compressed rising break into a heavy falling return.',cost:40},ult:{name:'THREE WEIGHTS',desc:'Three full-body blows, each planted before the next.'},trailWidth:1.4},
 inferno:{id:'inferno',name:'EMBERFANG',title:'EXPERIMENTAL',form:'nodachi',desc:'Late workshop steel with a heated edge; restrained embers mark heavy contact.',upgrades:elementPath('EMBERFANG','EMBERFANG II','EMBERFANG PRIME',430,['Cinder draw','Burning return','Flame-break form'],['Heavy contact sheds embers.','Return cuts leave a short burning lane.','Charged releases gain a broader flame-break impact.']),colors:steel('#d7a06b','#fff1d5','#d87942','#673421','#f0bd82'),stats:{dmg:1.18,spd:.94,range:1.08},unlockKills:430,ability:{name:'CINDER RETURN',desc:'A grounded cut whose hot edge leaves a short cinder wake.',cost:38},ult:{name:'FORGE TEMPER',desc:'Measured heat-building cuts.'},trailWidth:1.16},
 thunder:{id:'thunder',name:'STORMWIRE',title:'EXPERIMENTAL',form:'saber',desc:'Conductive fuller stores a modest discharge across fast linked contacts.',upgrades:elementPath('STORMWIRE','STORMWIRE II','STORMWIRE PRIME',560,['Static pass','Linked pursuit','Thunderstep form'],['Fast contact discharges once.','Passing cuts arc to one nearby target.','Special becomes a two-stage pursuit and return.']),colors:steel('#d4c582','#fffbe8','#dfcf65','#665c25','#f0e6a7'),stats:{dmg:1.04,spd:1.1,range:1},unlockKills:560,ability:{name:'STATIC PASS',desc:'A fast pass with a short-range contact arc.',cost:36},ult:{name:'CLOSED CIRCUIT',desc:'Linked cuts discharge only between nearby enemies.'},trailWidth:.9},
 frost:{id:'frost',name:'FROSTBITE',title:'ELEMENTAL',form:'straight',desc:'Cold-running straight steel blooms with ice only along confirmed cuts.',upgrades:elementPath('FROSTBITE','FROSTBITE II','FROSTBITE PRIME',650,['Cold snap','Rime guard','Shatter form'],['Cross-cut sheds ice.','Heavier braced cut holds contact longer.','Rising freeze-cut returns as a shattering fall.']),colors:steel('#bde7ee','#ffffff','#8eeaff','#315f72','#dffbff'),stats:{dmg:1.08,spd:1,range:1.03},unlockKills:650,ability:{name:'COLD SNAP',desc:'A braced cross-cut that freezes the impact frame in shards.',cost:37},ult:{name:'WHITE EDGE',desc:'Clean cold cuts build into one shattering finish.'},trailWidth:.96},
 gale:{id:'gale',name:'GALE EDGE',title:'ELEMENTAL',form:'saber',desc:'A light saber that wraps compressed air around fast traveling cuts.',upgrades:elementPath('GALE EDGE','GALE EDGE II','GALE EDGE PRIME',790,['Windstep','Crosswind','Gale-dance form'],['Traveling cut raises a pressure ring.','Longer passing step gains a return wake.','Special becomes a fast circular pressure route.']),colors:steel('#c8ede1','#f8fffc','#78e0c1','#27665a','#dcfff4'),stats:{dmg:.98,spd:1.17,range:1.05},unlockKills:790,ability:{name:'WINDSTEP',desc:'A rushing saber cut with a tight pressure ring at contact.',cost:35},ult:{name:'CROSSWIND',desc:'Alternating passes build a controlled cutting wake.'},trailWidth:.86},
 earth:{id:'earth',name:'STONEBREAKER',title:'ELEMENTAL',form:'greatblade',desc:'Mineral-cored greatblade throws dust and stone chips from grounded impact.',upgrades:elementPath('STONEBREAKER','STONEBREAKER II','STONEBREAKER PRIME',980,['Fault line','Uplift form','Bedrock form'],['Overhead contact cracks the floor.','Special changes into a rising launch break.','Launch returns into the heaviest falling cut.']),colors:steel('#b5a47d','#f6eedb','#c7a765','#594b32','#ead7a8'),stats:{dmg:1.3,spd:.8,range:1.08},unlockKills:980,ability:{name:'FAULT LINE',desc:'A planted overhead break with a short ground rupture.',cost:42},ult:{name:'BEDROCK',desc:'Three planted impacts; no airborne magic, only leverage.'},trailWidth:1.42},
 void:{id:'void',name:'NIGHTGLASS',title:'EXPERIMENTAL',form:'straight',desc:'Light-absorbing alloy leaves a brief dark displacement, not a magical portal.',upgrades:elementPath('NIGHTGLASS','NIGHTGLASS II','NIGHTGLASS PRIME',720,['Blind-side step','Dark return','Night-cross form'],['Retreat cut leaves a dark trace.','Exit cut gains a delayed shadow line.','Special becomes a crossing displacement cut.']),colors:steel('#45404d','#d8d1df','#8c7b9b','#25222a','#b9acc6'),stats:{dmg:1.1,spd:1.02,range:1.04},unlockKills:720,ability:{name:'BLIND-SIDE STEP',desc:'A low evasive pass into an unseen-side return cut.',cost:38},ult:{name:'BLACK ROOM',desc:'Dark afterimages hide a disciplined cut sequence.'},trailWidth:1},
 gravity:{id:'gravity',name:'WEIGHTFALL',title:'EXPERIMENTAL',form:'nodachi',desc:'Dense spine exaggerates leverage and launch without supernatural arena control.',upgrades:elementPath('WEIGHTFALL','WEIGHTFALL II','WEIGHTFALL PRIME',900,['Uproot','Suspension cut','Weightfall form'],['Rising cut launches one target.','Launch gains a controlled hanging beat.','Special becomes rise, catch and grounded finish.']),colors:steel('#9eb5bd','#eff8fa','#91b6c2','#354a50','#c9e0e5'),stats:{dmg:1.27,spd:.86,range:1.1},unlockKills:900,ability:{name:'UPROOT',desc:'A low full-body rising cut made to launch one target.',cost:40},ult:{name:'HEAVY GROUND',desc:'Launch, catch and grounded finish.'},trailWidth:1.3},
 phantom:{id:'phantom',name:'GHOSTLINE',title:'EXPERIMENTAL',form:'short',desc:'Mirror finish produces readable afterimages; the steel itself remains ordinary.',upgrades:elementPath('GHOSTLINE','GHOSTLINE II','GHOSTLINE PRIME',1100,['Second image','Mirror pair','Ghostline form'],['One afterimage follows the cut.','Pivot produces a delayed return echo.','Special becomes a three-angle body-and-echo route.']),colors:steel('#dbe0e3','#ffffff','#d5e0e6','#59666d','#f5f7f8'),stats:{dmg:.98,spd:1.16,range:.9},unlockKills:1100,ability:{name:'SECOND IMAGE',desc:'A real cut followed by one delayed visual echo strike.',cost:33},ult:{name:'MIRROR FORM',desc:'Alternating body and afterimage cuts.'},trailWidth:.84},
}

/* ------------------------------------------------------------------ */
/* Sword rendering — drawn in the character's local space.             */
/* ------------------------------------------------------------------ */

type GuardShape = 'maru' | 'mokko' | 'square' | 'dguard' | 'cross' | 'ring'
interface WeaponProfile {
  handleRatio:number; width:number; sori:number; guard:GuardShape
  tip:'kissaki'|'needle'|'clip'|'chisel'; spine:number
}

/** Physical construction profile. Colour is intentionally absent: changing
 * tint can never turn one weapon into another. Every family gets different
 * proportions, curvature, point geometry, spine and furniture. */
function weaponProfile(s:SwordDef):WeaponProfile {
  if(s.id==='katana') {
    if(s.currentTier===2) return {handleRatio:.335,width:.67,sori:.052,guard:'mokko',tip:'kissaki',spine:.76}
    if(s.currentTier===1) return {handleRatio:.315,width:.62,sori:.048,guard:'square',tip:'kissaki',spine:.73}
    return {handleRatio:.3,width:.58,sori:.045,guard:'maru',tip:'kissaki',spine:.7}
  }
  if(s.id==='wakizashi'||s.id==='phantom') return {handleRatio:.32,width:.82,sori:.055,guard:'mokko',tip:'kissaki',spine:.72}
  if(s.id==='chokuto'||s.id==='frost') return {handleRatio:.23,width:.88,sori:0,guard:'square',tip:'chisel',spine:.9}
  if(s.id==='saber'||s.id==='thunder'||s.id==='gale') return {handleRatio:.2,width:.72,sori:.115,guard:'dguard',tip:'clip',spine:.62}
  if(s.id==='greatblade'||s.id==='earth') return {handleRatio:.36,width:1.58,sori:.008,guard:'cross',tip:'clip',spine:1.08}
  if(s.id==='void') return {handleRatio:.25,width:.9,sori:0,guard:'ring',tip:'needle',spine:.82}
  if(s.id==='inferno') return {handleRatio:.35,width:1.16,sori:.052,guard:'mokko',tip:'kissaki',spine:.86}
  if(s.id==='gravity') return {handleRatio:.38,width:1.3,sori:.025,guard:'cross',tip:'chisel',spine:1.05}
  return {handleRatio:.36,width:1.08,sori:.038,guard:'mokko',tip:'kissaki',spine:.86}
}

export interface DrawSwordOpts {
  time: number
  charge: number // 0..1 charge glow
  alpha?: number
  swingGlow?: number // extra energy right after a swing
  condition?: number // plain-steel maintenance, 0 worn/rusted .. 1 clean
  /** 3D depth (−1..1): + = blade plane rotated TOWARD the camera →
   * procedural foreshortening (face opens up: wider silhouette, fatter
   * tsuba, huge kissaki flare). Thrusts (z≈0.85) read as spearing the lens. */
  z?: number
  /** hyper-scale multiplier on the whole weapon (active swing / dash) */
  lenScale?: number
}

/** Draws the weapon from EXPLICIT projected blade metrics (rig3d output):
 * the grip point, the PROJECTED blade angle (what the eye sees after 3D
 * yaw + perspective), the projected length, and the tip's normalized depth.
 * Visual blade == hitbox blade: both consume the same projection. */
export function drawSword(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  opts: DrawSwordOpts,
  hx: number, hy: number, // grip (projected, character-local)
  ang: number, // PROJECTED blade angle (rad)
  len: number, // PROJECTED blade length (local units, incl. lenScale)
  z: number, // tip depth −1..1 (+ = toward camera)
): void {
  const t = opts.time
  const charge = clamp01(opts.charge)
  const swing = clamp01(opts.swingGlow ?? 0)
  z = clamp(z, -1, 1) // + = toward camera
  const a = ang
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  // edge-side perpendicular: for a forward blade this points DOWN — the ha
  // (cutting edge) faces down-forward, correct for kiri-oroshi cuts.
  const ex = -dy
  const ey = dx
  // REAL long-katana proportion: blade = PLAYER_SPEC.blade (~50% of body
  // height), tsuka ≈ 30% of the blade, motohaba→kissaki taper with sori.
  const craft = sword.currentCraft ?? 'field'
  const craftN = craft === 'awakened' ? 2 : craft === 'tempered' ? 1 : 0
  const profile = weaponProfile(sword)
  // Rebuilds refine furniture; the base family supplies its own proportion.
  const tsuka = len * (profile.handleRatio + craftN * 0.012)
  // 2.8D FORESHORTENING: blade pitched toward the camera presents its FACE
  // — the silhouette fattens with z (up to ×1.85), the fittings swell, the
  // kissaki flares. Away from camera (z<0) it slims toward a needle.
  const zm = 1 + Math.max(0, z) * 0.85 + Math.min(0, z) * 0.35
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return

  // Plain steel is a separate renderer, not a de-powered elemental sword.
  // This deliberately bypasses every legacy aura, orb, camera flare and
  // energy-furniture pass below.
  if (sword.mundane) {
    drawPlainKatana(ctx, sword, opts, hx, hy, a, len, z)
    return
  }

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'

  // CHARGE no longer feeds the glow width — the charged blade speaks
  // KINETIC (trembling steel + traveling glint), not neon amplitude.
  const glowW = 5 + swing * 3.2 + (sword.currentTier ?? 0) * .7

  // ---- 0. tsuka (handle): wrapped grip BEHIND the hand, kashira pommel ----
  const gripColor = profile.guard==='dguard' ? '#493524' : profile.guard==='cross' ? '#302821' : sword.mundane ? '#171717' : '#20262b'
  ctx.strokeStyle = gripColor
  ctx.lineWidth = (profile.guard==='cross'?5.8:profile.guard==='dguard'?4.4:5.0) * zm
  ctx.beginPath()
  ctx.moveTo(hx - dx * tsuka, hy - dy * tsuka)
  ctx.lineTo(hx + dx * 2.4, hy + dy * 2.4)
  ctx.stroke()
  // tsuka-ito diamond wraps — the classic katana grip read
  ctx.strokeStyle = rgba(sword.colors.accent, 0.8)
  ctx.lineWidth = 1.5 * zm
  for (let i = 1; i <= 4; i++) {
    const k = i / 4.8
    const wx = hx - dx * tsuka * k
    const wy = hy - dy * tsuka * k
    ctx.beginPath()
    ctx.moveTo(wx - ey * 2.8 * zm, wy + ex * 2.8 * zm)
    ctx.lineTo(wx + ey * 2.8 * zm, wy - ex * 2.8 * zm)
    ctx.stroke()
  }
  // kashira (pommel cap) — metal end disc
  ctx.fillStyle = '#3d4f6e'
  ctx.beginPath()
  ctx.ellipse(hx - dx * tsuka, hy - dy * tsuka, 2.0 * zm, 3.4 * zm, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.fill()

  // ---- 1. aura pass (additive) behind the blade — SWING energy only.
  // A stored charge adds no aura: it lives in the physical layers below
  // (vibration ghost, edge glint, kissaki star). ----
  if (!sword.mundane) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = rgba(sword.colors.glow, 0.16 + swing * 0.25)
    ctx.lineWidth = glowW + 5
    strokeBlade(ctx, sword, hx, hy, dx, dy, ex, ey, len, t)
    ctx.stroke()
    ctx.strokeStyle = rgba(sword.colors.glow, 0.5 + swing * 0.15)
    ctx.lineWidth = glowW * 0.55
    strokeBlade(ctx, sword, hx, hy, dx, dy, ex, ey, len, t)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  // ---- 2. tsuba (guard): crisp disc at the hand (swells with z — the
  // hand socket pitching toward the camera shows the guard's face) ----
  const gx=hx+dx*2.2, gy=hy+dy*2.2
  ctx.fillStyle = sword.mundane ? '#303233' : '#46515a'
  ctx.strokeStyle = sword.mundane ? '#8b8172' : rgba(sword.colors.accent, .82)
  ctx.lineWidth = 1.25
  ctx.beginPath()
  if(profile.guard==='maru') ctx.ellipse(gx,gy,1.35*zm,3.8*zm,a+Math.PI/2,0,Math.PI*2)
  else if(profile.guard==='mokko') {
    // Four-lobed mokko tsuba, common and visibly unlike a circular disc.
    for(let i=0;i<4;i++){const q=a+i*Math.PI/2;const x=gx+Math.cos(q)*2.2*zm,y=gy+Math.sin(q)*2.2*zm;ctx.moveTo(x+2.6*zm,y);ctx.arc(x,y,2.6*zm,0,Math.PI*2)}
  } else if(profile.guard==='square') ctx.rect(gx-4.6*zm,gy-4.6*zm,9.2*zm,9.2*zm)
  else if(profile.guard==='cross') {
    ctx.moveTo(gx-ex*9*zm,gy-ey*9*zm);ctx.lineTo(gx+ex*9*zm,gy+ey*9*zm)
  } else if(profile.guard==='dguard') {
    ctx.arc(gx-dx*4*zm,gy-dy*4*zm,8*zm,a-Math.PI/2,a+Math.PI/2)
    ctx.lineTo(gx+ex*5*zm,gy+ey*5*zm)
  } else {
    ctx.ellipse(gx,gy,3.2*zm,6.8*zm,a+Math.PI/2,0,Math.PI*2)
    ctx.ellipse(gx,gy,1.3*zm,3.2*zm,a+Math.PI/2,0,Math.PI*2)
  }
  if(profile.guard==='cross'){ctx.lineWidth=3.2*zm;ctx.stroke()}else{ctx.fill();ctx.stroke()}
  // Tempered and awakened fittings add visible concentric seppa; the top
  // rebuild receives an asymmetric knuckle spur toward the cutting edge.
  if (craftN > 0) {
    ctx.strokeStyle = rgba(sword.colors.core, .72)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(hx + dx * 2.2, hy + dy * 2.2, (3.2 + craftN) * zm, (6.6 + craftN) * zm, a + Math.PI / 2, 0, Math.PI * 2)
    ctx.stroke()
    if (craftN === 2) {
      ctx.beginPath()
      ctx.moveTo(hx + ex * 5 * zm, hy + ey * 5 * zm)
      ctx.lineTo(hx + ex * 10 * zm - dx * 2, hy + ey * 10 * zm - dy * 2)
      ctx.stroke()
    }
  }

  // ---- 3. the blade: filled polygon with sori + kissaki + habaki ----
  // base past the tsuba; motohaba (base width) → kissaki taper — the base
  // width rides the foreshortening multiplier zm (blade face → camera)
  const bx0 = hx + dx * 3.4
  const by0 = hy + dy * 3.4
  const bladeLen = len - 3.4
  const wBase = 2.1 * sword.trailWidth * profile.width * (1 + craftN * .045) * zm
  // ---- 3a. VIBRATION GHOST — steel under stored tension physically
  // trembles: two translucent offset copies of the blade body flicker at
  // frame-aliased ~90Hz (±perpendicular, amplitude grows with charge).
  // A blur read, never a glow. ----
  if (charge > .25 && !sword.mundane) {
    const vg = (charge - .25) / .75
    const amp = .6 + vg * 1.1
    for (let i = 0; i < 2; i++) {
      const off = Math.sin(t * 93 + i * 2.4) * amp
      ctx.save()
      ctx.translate(ex * off, ey * off)
      ctx.beginPath()
      buildBladePolygon(ctx, sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
      ctx.fillStyle = rgba(sword.colors.blade, 0.26 * vg)
      ctx.fill()
      ctx.restore()
    }
  }
  // fill body
  ctx.beginPath()
  buildBladePolygon(ctx, sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
  ctx.fillStyle = rgba(sword.colors.blade, 0.96)
  ctx.fill()
  // Carbon steel in rain dulls and develops a restrained oxide stain. The
  // same silhouette is overlaid deterministically—no glitter/no random noise.
  const wear = sword.mundane ? 1 - clamp01(opts.condition ?? 1) : 0
  if (wear > .02) {
    ctx.beginPath()
    buildBladePolygon(ctx, sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
    ctx.fillStyle = rgba('#7b4a2c', wear * .38)
    ctx.fill()
  }
  // spine (mune) hairline — separates the two faces
  ctx.strokeStyle = rgba(sword.colors.trail2, 0.9)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  const munePts = bladeSpine(sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase)
  ctx.moveTo(munePts[0], munePts[1])
  ctx.quadraticCurveTo(munePts[2], munePts[3], munePts[4], munePts[5])
  ctx.stroke()
  // habaki (blade collar): bright metallic band right past the tsuba
  ctx.strokeStyle = rgba(sword.colors.core, 0.92)
  ctx.lineWidth = 3.4 * sword.trailWidth
  ctx.beginPath()
  ctx.moveTo(bx0 + ex * 0.4, by0 + ey * 0.4)
  ctx.lineTo(bx0 + dx * 5 - ex * 0.2, by0 + dy * 5 - ey * 0.2)
  ctx.stroke()
  // ha (cutting edge) highlight — the glowing sharp side
  ctx.strokeStyle = rgba(sword.colors.core, 0.9)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  const edgePts = bladeEdge(sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
  ctx.moveTo(edgePts[0], edgePts[1])
  ctx.quadraticCurveTo(edgePts[2], edgePts[3], edgePts[4], edgePts[5])
  ctx.stroke()
  // ---- 3b. TRAVELING EDGE GLINT — the charge read: a bright specular
  // band slides along the ha from habaki toward the kissaki as stored
  // tension rises (steel catching light under inspection). Quadratic eval
  // of the author's own edge curve, ±10% span, white-steel, additive. ----
  if (charge > 0.04 && !sword.mundane) {
    const g = clamp01(charge)
    const qEval = (s: number): [number, number] => {
      const u = Math.max(0, Math.min(1, s))
      const iu = 1 - u
      return [
        iu * iu * edgePts[0] + 2 * iu * u * edgePts[2] + u * u * edgePts[4],
        iu * iu * edgePts[1] + 2 * iu * u * edgePts[3] + u * u * edgePts[5],
      ]
    }
    const u0 = clamp01(0.15 + g * 0.75 + Math.sin(t * 2.6) * 0.06)
    const [gx0, gy0] = qEval(u0 - 0.09)
    const [gx1, gy1] = qEval(u0 + 0.09)
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = rgba(sword.colors.core, 0.35 + 0.45 * g)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(gx0, gy0)
    ctx.lineTo(gx1, gy1)
    ctx.stroke()
    // the hot head of the glint — a mote of caught light
    ctx.fillStyle = rgba('#ffffff', 0.5 * g)
    ctx.beginPath()
    ctx.arc(gx1, gy1, 1.1 + g * 0.9, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  // ---- 4. kissaki (tip) glint ----
  const tipX = hx + dx * len
  const tipY = hy + dy * len
  if (!sword.mundane) {
    ctx.globalCompositeOperation = 'lighter'
    const tw = (2.2 + Math.sin(t * 9) * 0.7 + swing * 3.6) * (1 + Math.max(0, z) * 1.3)
    ctx.fillStyle = rgba(sword.colors.core, 0.75 + swing * 0.25)
    ctx.beginPath()
    ctx.arc(tipX, tipY, tw, 0, Math.PI * 2)
    ctx.fill()
  }
  // ---- 4b. KISSAKI GLINT STAR — the fully charged read, replacing the
  // old energy halo: a tight 4-ray specular star at the point (steel-white,
  // rotating slowly with the blade's own clock — a reflection, not a ring). ----
  if (charge > 0.15 && !sword.mundane) {
    const g = clamp01((charge - 0.15) / 0.85)
    const gs = (3 + g * 3.5 + Math.sin(t * 31) * 0.8) * (1 + Math.max(0, z) * 0.8)
    ctx.strokeStyle = rgba('#ffffff', 0.55 * g)
    ctx.lineWidth = 1.1
    for (let i = 0; i < 4; i++) {
      const sa = a + Math.PI / 4 + i * Math.PI / 2
      ctx.beginPath()
      ctx.moveTo(tipX + Math.cos(sa) * gs * 0.35, tipY + Math.sin(sa) * gs * 0.35)
      ctx.lineTo(tipX + Math.cos(sa) * gs, tipY + Math.sin(sa) * gs)
      ctx.stroke()
    }
  }
  // ---- 5. CAMERA-PIERCE FLARE: when the thrust drives the blade deep
  // toward the lens (z > 0.55), bloom a hard halo + streak ring at the
  // kissaki — instant depth pop, the anime "spear at the screen" beat ----
  if (z > 0.55 && !sword.mundane) {
    const pz = (z - 0.55) / 0.45
    const fr = 9 + pz * 15 + swing * 6
    ctx.strokeStyle = rgba(sword.colors.glow, 0.5 * pz)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(tipX, tipY, fr, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(sword.colors.core, 0.85 * pz)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(tipX, tipY, fr * 0.62, 0, Math.PI * 2)
    ctx.stroke()
    // radial pierce streaks
    ctx.strokeStyle = rgba(sword.colors.core, 0.4 * pz)
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const sa = a + Math.PI + (i - 2) * 0.16
      ctx.beginPath()
      ctx.moveTo(tipX + Math.cos(sa) * fr * 1.15, tipY + Math.sin(sa) * fr * 1.15)
      ctx.lineTo(tipX + Math.cos(sa) * fr * 1.8, tipY + Math.sin(sa) * fr * 1.8)
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

/** Dedicated realistic katana renderer. No part of the old energy-blade
 * renderer is reused: no centerline aura, circular point, glowing tsuba,
 * camera flare, vibration copy or elemental colour pass. */
function drawPlainKatana(
  ctx:CanvasRenderingContext2D, sword:SwordDef, opts:DrawSwordOpts,
  hx:number,hy:number,a:number,len:number,z:number,
):void {
  const dx=Math.cos(a),dy=Math.sin(a),ex=-dy,ey=dx
  const face=1+Math.max(0,z)*.22+Math.min(0,z)*.12
  const alpha=opts.alpha??1
  const tier=sword.currentTier??0
  const grip=len*(.285+tier*.018)
  ctx.save();ctx.globalAlpha*=alpha;ctx.lineCap='butt';ctx.lineJoin='round'

  // Honoki core under black samegawa/ito: a slim oval grip, not a luminous rod.
  ctx.strokeStyle='#151311';ctx.lineWidth=4.1*face
  ctx.beginPath();ctx.moveTo(hx-dx*grip,hy-dy*grip);ctx.lineTo(hx+dx*1.2,hy+dy*1.2);ctx.stroke()
  ctx.strokeStyle='#756a5d';ctx.lineWidth=.72*face
  for(let i=1;i<=6;i++){
    const q=i/6.5,x=hx-dx*grip*q,y=hy-dy*grip*q,s=(i&1)?1:-1
    ctx.beginPath();ctx.moveTo(x-ex*2.15*face,y-ey*2.15*face);ctx.lineTo(x+ex*2.15*face+s*dx*1.2,y+ey*2.15*face+s*dy*1.2);ctx.stroke()
  }
  // Kashira and a small iron maru tsuba. Both are solid fittings—never rings.
  ctx.fillStyle='#2b2926';ctx.beginPath();ctx.ellipse(hx-dx*grip,hy-dy*grip,1.4*face,2.35*face,a+Math.PI/2,0,Math.PI*2);ctx.fill()
  const gx=hx+dx*1.7,gy=hy+dy*1.7
  ctx.fillStyle='#242321';ctx.beginPath()
  if(tier===0) ctx.ellipse(gx,gy,1.45*face,3.65*face,a+Math.PI/2,0,Math.PI*2)
  else if(tier===1) ctx.rect(gx-3.25*face,gy-3.25*face,6.5*face,6.5*face)
  else { for(let i=0;i<4;i++){const q=a+i*Math.PI/2,x=gx+Math.cos(q)*1.55*face,y=gy+Math.sin(q)*1.55*face;ctx.moveTo(x+1.85*face,y);ctx.arc(x,y,1.85*face,0,Math.PI*2)} }
  ctx.fill();ctx.strokeStyle='#777169';ctx.lineWidth=.55;ctx.stroke()

  const bx=hx+dx*3.3,by=hy+dy*3.3,L=Math.max(8,len-3.3)
  const sori=L*(.042+tier*.004),w=(1.15+tier*.13)*face
  const tx=bx+dx*L+ex*sori,ty=by+dy*L+ey*sori
  // Shinogi-zukuri body: narrow motohaba, restrained sori, geometric kissaki.
  ctx.beginPath();ctx.moveTo(bx+ex*w,by+ey*w)
  ctx.quadraticCurveTo(bx+dx*L*.58+ex*(sori+w*.45),by+dy*L*.58+ey*(sori+w*.45),tx,ty)
  ctx.lineTo(tx-dx*4.2-ex*.35*w,ty-dy*4.2-ey*.35*w)
  ctx.quadraticCurveTo(bx+dx*L*.58-ex*(w*.72-sori*.2),by+dy*L*.58-ey*(w*.72-sori*.2),bx-ex*w*.82,by-ey*w*.82)
  ctx.closePath();ctx.fillStyle='#697174';ctx.fill()
  const wear=1-clamp01(opts.condition??1)
  if(wear>.02){ctx.fillStyle=rgba('#75462c',wear*.42);ctx.fill()}
  // Dark mune and bright ha make the section legible without making it glow.
  ctx.strokeStyle='#303638';ctx.lineWidth=.72
  ctx.beginPath();ctx.moveTo(bx-ex*w*.72,by-ey*w*.72);ctx.quadraticCurveTo(bx+dx*L*.58-ex*(w*.45-sori*.16),by+dy*L*.58-ey*(w*.45-sori*.16),tx-dx*4.1,ty-dy*4.1);ctx.stroke()
  ctx.strokeStyle='#c7ccca';ctx.lineWidth=.82
  ctx.beginPath();ctx.moveTo(bx+ex*w,by+ey*w);ctx.quadraticCurveTo(bx+dx*L*.58+ex*(sori+w*.45),by+dy*L*.58+ey*(sori+w*.45),tx,ty);ctx.stroke()
  // Habaki: one short brass collar at the base.
  ctx.strokeStyle='#8a7045';ctx.lineWidth=2.1*face
  ctx.beginPath();ctx.moveTo(bx+dx*.5,by+dy*.5);ctx.lineTo(bx+dx*3.1,by+dy*3.1);ctx.stroke()
  ctx.restore()
}

/** Builds the filled blade silhouette: ha (curved edge) → kissaki → mune. */
function buildBladePolygon(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
  t: number,
): void {
  // Family silhouette: chokuto stays straight, saber carries a deep curve,
  // nodachi stretches a restrained arc and greatblade is nearly rigid.
  const profile = weaponProfile(sword)
  const soriRate = profile.sori
  const sori = len * soriRate
  // per-sword edge character offset at parameter k (0..1)
  const jit = (k: number): number => {
    switch (sword.id) {
      case 'thunder':
        return Math.sin(k * 19 + t * 31) * 1.1
      case 'inferno':
        return Math.sin(k * 9 + t * 17) * 1.6
      case 'void':
        return Math.sin(k * 6 - t * 5) * 0.7
      case 'frost':
        return Math.sin(k * 13 + t * 4) * .35
      case 'gale':
        return Math.sin(k * 8 - t * 9) * .45
      case 'earth':
        return Math.sin(k * 17) * .25
      case 'phantom':
        return 0
      default:
        return 0
    }
  }
  // ha (edge) curve — from the wide base to the kissaki
  const e0x = bx + ex * wBase
  const e0y = by + ey * wBase
  const midK = 0.62
  const emx = bx + dx * len * midK + ex * (sori + jit(midK) + wBase * 0.24)
  const emy = by + dy * len * midK + ey * (sori + jit(midK) + wBase * 0.24)
  const pointExtra = profile.tip === 'needle' ? 4 : 0
  const kx = bx + dx * (len + pointExtra) + ex * (sori * 1.15 + jit(1))
  const ky = by + dy * (len + pointExtra) + ey * (sori * 1.15 + jit(1))
  // mune (spine) curve — straighter, meets the kissaki
  const m0x = bx - ex * wBase * profile.spine
  const m0y = by - ey * wBase * profile.spine
  const mmx = bx + dx * len * 0.6 - ex * (wBase * profile.spine * .5 - sori * 0.25 - jit(0.6) * 0.5)
  const mmy = by + dy * len * 0.6 - ey * (wBase * profile.spine * .5 - sori * 0.25 - jit(0.6) * 0.5)
  ctx.moveTo(e0x, e0y)
  ctx.quadraticCurveTo(emx, emy, kx, ky)
  if(profile.tip==='clip') ctx.lineTo(kx-dx*7-ex*wBase*.65,ky-dy*7-ey*wBase*.65)
  else if(profile.tip==='chisel') ctx.lineTo(kx-dx*1.2-ex*wBase*1.35,ky-dy*1.2-ey*wBase*1.35)
  else if(profile.tip==='needle') ctx.lineTo(kx-dx*5.5,ky-dy*5.5)
  else ctx.lineTo(kx-dx*2.2,ky-dy*2.2)
  ctx.quadraticCurveTo(mmx, mmy, m0x, m0y)
  ctx.closePath()
}

/** Edge (ha) polyline for the highlight stroke. */
function bladeEdge(
  sword: SwordDef,
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
  t: number,
): number[] {
  const sori = len * (weaponProfile(sword).sori)
  const jit = (k: number): number => {
    switch (sword.id) {
      case 'thunder': return Math.sin(k * 19 + t * 31) * 1.1
      case 'inferno': return Math.sin(k * 9 + t * 17) * 1.6
      case 'void': return Math.sin(k * 6 - t * 5) * 0.7
      case 'frost': return Math.sin(k * 13 + t * 4) * .35
      case 'gale': return Math.sin(k * 8 - t * 9) * .45
      case 'earth': return Math.sin(k * 17) * .25
      default: return 0
    }
  }
  const midK = 0.62
  return [
    bx + ex * wBase,
    by + ey * wBase,
    bx + dx * len * midK + ex * (sori + jit(midK) + wBase * 0.24),
    by + dy * len * midK + ey * (sori + jit(midK) + wBase * 0.24),
    bx + dx * len + ex * (sori * 1.15 + jit(1)),
    by + dy * len + ey * (sori * 1.15 + jit(1)),
  ]
}

/** Spine (mune) polyline for the hairline stroke. */
function bladeSpine(
  sword: SwordDef,
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
): number[] {
  const profile=weaponProfile(sword)
  const sori = len * profile.sori
  const mmx = bx + dx * len * 0.6 - ex * (wBase * profile.spine * .5 - sori * 0.25)
  const mmy = by + dy * len * 0.6 - ey * (wBase * profile.spine * .5 - sori * 0.25)
  return [
    bx - ex * wBase * profile.spine,
    by - ey * wBase * profile.spine,
    mmx,
    mmy,
    bx + dx * len + ex * sori,
    by + dy * len + ey * sori,
  ]
}

/** Aura stroke path (centerline of the blade with sori). */
function strokeBlade(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  hx: number, hy: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number,
  t: number,
): void {
  const sori = len * (weaponProfile(sword).sori) * .5
  const wobble = sword.id === 'thunder' ? Math.sin(t * 31) * 1.1 : sword.id === 'inferno' ? Math.sin(t * 17) * 1.4 : 0
  ctx.beginPath()
  ctx.moveTo(hx + dx * 3.4, hy + dy * 3.4)
  ctx.quadraticCurveTo(
    hx + dx * len * 0.62 + ex * (sori + wobble),
    hy + dy * len * 0.62 + ey * (sori + wobble),
    hx + dx * len,
    hy + dy * len,
  )
}
