/** Render the authored animation sheet using the production rig + costume. */
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { handGestures } from '../src/game/anim/hand-gestures'
import { WALK_CLIP, WALK_EXPOSURES, SPRINT_CLIP, SPRINT_EXPOSURES, IDLE_CLIP } from '../src/game/anim/clips'
import { sampleClip, type Clip } from '../src/game/anim/animator'
import { makePose } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom, drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'

const canvas = createCanvas(2400, 1300)
let ctx = canvas.getContext('2d')
ctx.fillStyle = '#0d171e'; ctx.fillRect(0, 0, canvas.width, canvas.height)
const text = (value: string, x: number, y: number, size = 20, color = '#dce6df') => {
  ctx.fillStyle = color; ctx.font = `${size}px sans-serif`; ctx.fillText(value, x, y)
}
text('STICKMAN RISING  /  CHARACTER LAB', 64, 65, 19, '#5bcfc2')
text('SHADOW RONIN', 60, 137, 66)
text('01  ANIME SILHOUETTE     02  MARTIAL POSTURE     03  BLACK SILHOUETTE     04  CONSTRAINED MOTION', 65, 182, 19, '#92aaa9')
text('Production rig + costume  /  C1-interpolated poses before gameplay ground IK  /  full left-right cycles', 65, 220, 18, '#6c868c')

function fighter(clip: Clip, phase: number, x: number, baseline: number, scale = 2.15) {
  const pose = sampleClip(clip, phase * clip.dur, makePose())
  const g = solveFighter3D(pose, PLAYER_SPEC, makeFighterGeom(), PLAYER_SPEC.blade)
  ctx.save(); ctx.translate(x, baseline - 49 * scale); ctx.scale(scale, scale)
  // Hip-mounted scabbard, same attachment and dimensions as the game.
  const angle = 0.24 + (pose[2] + pose[3] * .35) * 0.6
  const end = { x: g.hip.x - Math.cos(angle) * PLAYER_SPEC.blade * 0.88, y: g.hip.y + Math.sin(angle) * PLAYER_SPEC.blade * 0.88 }
  ctx.strokeStyle = '#0d1219'; ctx.lineWidth = 4.6; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(g.hip.x + 3, g.hip.y); ctx.lineTo(end.x, end.y); ctx.stroke()
  ctx.strokeStyle='#465a7a';ctx.lineWidth=1.1
  ctx.beginPath();ctx.moveTo(g.hip.x+2.4,g.hip.y-1.2);ctx.lineTo(end.x+Math.cos(angle)*2,end.y-Math.sin(angle)*2);ctx.stroke()
  ctx.fillStyle='#0d1219';ctx.beginPath();ctx.arc(end.x,end.y,2.5,0,Math.PI*2);ctx.fill()
  ctx.strokeStyle='#707c91';ctx.lineWidth=.6;ctx.stroke()
  drawFighter3D(ctx as unknown as CanvasRenderingContext2D, g, PLAYER_STYLE, { time: phase * clip.dur, hands:handGestures(clip.name,phase,true) })
  ctx.restore()
}
function row(clip: Clip, exposures: readonly number[], y: number, phases: string[]) {
  const width = 2272 / exposures.length
  const baseline = y + 294
  for (let i = 0; i < exposures.length; i++) {
    const x = 64 + i * width
    ctx.fillStyle = i % 2 ? '#13222b' : '#101e27'; ctx.fillRect(x, y, width - 3, 360)
    ctx.strokeStyle = '#2a454c'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x + 10, baseline); ctx.lineTo(x + width - 12, baseline); ctx.stroke()
    fighter(clip, exposures[i], x + width * 0.58, baseline)
    text(`${String(i + 1).padStart(2, '0')} / ${(exposures[i] * clip.dur).toFixed(3)}s`, x + 12, y + 25, 16, '#6a969a')
    text(phases[i % phases.length], x + 12, y + 328, 16, '#bbd3cf')
    text(i < exposures.length / 2 ? 'RIGHT LEAD' : 'LEFT LEAD', x + 12, y + 349, 12, '#5c868a')
  }
}
text('WALK', 65, 293, 31)
text('0.96 SEC / 10 EXPOSURES / HEEL-TO-TOE / DOUBLE SUPPORT', 270, 290, 18, '#86aaa8')
row(WALK_CLIP, WALK_EXPOSURES, 318, ['CONTACT', 'LOAD', 'PASS', 'HIGH POINT', 'REACH'])
text('SPRINT', 65, 760, 31)
text('0.56 SEC / 12 EXPOSURES / FOREFOOT DRIVE / FLIGHT + RECOVERY', 270, 757, 18, '#86aaa8')
row(SPRINT_CLIP, SPRINT_EXPOSURES, 785, ['STRIKE', 'COMPRESS', 'DRIVE', 'TOE-OFF', 'FLIGHT', 'RECOVER'])
text('Cadence follows movement speed. Gameplay adds foot planting, ground IK, sword grip IK and anatomical joint constraints.', 65, 1220, 20, '#86aaa8')
text('SHADOW RONIN / ANATOMICAL SURFACE + CONSTRAINED MOTION / REVISION 02', 65, 1260, 16, '#4fb8b0')
mkdirSync('research', { recursive: true })
writeFileSync('research/shadow-ronin-animation-sheet.png', canvas.toBuffer('image/png'))
// Close-framed, light-background model plate makes silhouette and posture legible.
const portrait = createCanvas(1000,1100)
ctx = portrait.getContext('2d')
ctx.fillStyle = '#c4ccd3'; ctx.fillRect(0,0,1000,1100)
text('SHADOW RONIN',55,70,42,'#172236')
text('IN-GAME MODEL / NULL-BLACK BODY + FACE / NO EYES',57,108,16,'#52617b')
fighter(IDLE_CLIP,0,560,940,8)
ctx.strokeStyle='#8592a2';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(90,940);ctx.lineTo(920,940);ctx.stroke()
text('SHORT HAIR / ARTICULATED HANDS / CONTINUOUS MOTION',55,1015,17,'#35405a')
text('Production canvas renderer. Ground / grip IK applied separately in gameplay.',55,1046,14,'#52617b')
writeFileSync('research/shadow-ronin-model.png', portrait.toBuffer('image/png'))
console.log('Rendered research/shadow-ronin-animation-sheet.png and research/shadow-ronin-model.png')
