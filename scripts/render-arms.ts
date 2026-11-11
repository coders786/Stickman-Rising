import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {MOVES, UNARMED_GUARD} from '../src/game/combat/moveset'
import {sampleClip} from '../src/game/anim/animator'
import {solveFighter3D, makeFighterGeom, drawFighter3D, FOCUS} from '../src/game/anim/rig3d'
import {PLAYER_SPEC, PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const geom = makeFighterGeom()
const out = process.argv[2] ?? 'research/arms.png'
const shots: {label: string; pose: Float32Array; hands: number}[] = []
const guard = new Float32Array(28)
for (let i = 0; i < 28; i++) guard[i] = UNARMED_GUARD[i]
shots.push({label: 'GUARD', pose: guard, hands: 0})
for (const [id, t] of [['l1', 0.16], ['viperPalm', 0.32], ['omegaPalm', 0.56], ['cyclone', 0.44]] as const) {
  const clip = MOVES[id].clip
  shots.push({label: id, pose: sampleClip(clip, t, new Float32Array(28)), hands: t / clip.dur})
}
const W = 380, H = 420
const c = createCanvas(W * shots.length, H)
const x = c.getContext('2d')
x.fillStyle = '#e9eef2'; x.fillRect(0, 0, c.width, c.height)
shots.forEach((s, i) => {
  const g = solveFighter3D(s.pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
  x.save(); x.translate(190 + i * W, 340); x.scale(3.1, 3.1)
  drawFighter3D(x as unknown as CanvasRenderingContext2D, g, PLAYER_STYLE, {hands: handGestures('unarmed', s.hands, false)})
  x.restore()
  x.fillStyle = '#12222f'; x.font = 'bold 22px sans-serif'; x.fillText(s.label, 20 + i * W, 40)
})
writeFileSync(out, c.toBuffer('image/png'))
console.log('wrote', out)
