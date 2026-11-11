/**
 * 3D STAGE → 2D SPRITE SHEET.
 *
 * The fighter rig is already volumetric: every joint comes out of
 * `solveFighter3D` as a projected (x, y) plus a real depth `z`
 * (`proj()` scales by FOCUS / (FOCUS − z)). So the character can be
 * unprojected back into true 3D, placed in a lit environment, and shot with a
 * real perspective camera — and the frames that come out of that camera are
 * the sprite sheet.
 *
 *   · anatomy is untouched — the rig, the channels, the limits, the sarc
 *     proportions are the game's; nothing here re-poses a joint.
 *   · "no physics": no cloth/verlet/secondary simulation, no integrator. Every
 *     frame is the authored pose sampled from the baked clip at its own time.
 *   · anime rules that survive the conversion: hold → snap → brace timing
 *     (already baked into the clips), silhouette staging, arcs, overlapping
 *     limb action, screen-direction consistency, and a camera that only moves
 *     on the beats that deserve it.
 *
 *   npx tsx scripts/render-3d.ts stage     # model in the environment
 *   npx tsx scripts/render-3d.ts sheet     # the animation captured to sprites
 */
import {createCanvas, type Canvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {MOVES, UNARMED_GUARD} from '../src/game/combat/moveset'
import {sampleClip} from '../src/game/anim/animator'
import {solveFighter3D, makeFighterGeom, FOCUS, type FighterGeom} from '../src/game/anim/rig3d'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'

const geom = makeFighterGeom()
const CH = 28

type V3 = {x: number; y: number; z: number}
const v3 = (x: number, y: number, z: number): V3 => ({x, y, z})

/* ───────────────────────────── 3D plumbing ───────────────────────────── */

/** Unproject a solved joint: the rig stores screen-plane (x,y) + depth z. */
function unproject(j: {x: number; y: number; z: number}): V3 {
  const k = (FOCUS - j.z) / FOCUS
  // local y grows downward; world Y is up.
  return v3(j.x / k, -j.y / k, j.z)
}

interface Cam { yaw: number; pitch: number; dist: number; ty: number; fov: number }

/** world → camera space (x right, y up, z forward) */
function toCam(p: V3, c: Cam): V3 {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw)
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch)
  const x0 = p.x
  const y0 = p.y - c.ty
  const z0 = p.z
  // yaw about Y
  const x1 = x0 * cy - z0 * sy
  const z1 = x0 * sy + z0 * cy
  // pitch about X
  const y2 = y0 * cp - z1 * sp
  const z2 = y0 * sp + z1 * cp
  return v3(x1, y2, z2 + c.dist)
}

interface Proj { x: number; y: number; z: number; s: number }

function project(p: V3, c: Cam, w: number, h: number): Proj {
  const q = toCam(p, c)
  const zc = Math.max(1, q.z)
  const f = (h / 2) / Math.tan((c.fov * Math.PI) / 360)
  const s = f / zc
  return {x: w / 2 + q.x * s, y: h / 2 - q.y * s, z: zc, s}
}

/** Frame from the rig's own bounds, solved by measurement rather than by
 * plugging into the pinhole formula: pitch moves the endpoints in depth, so a
 * closed-form distance lands short and crops the feet. Three passes converge. */
function autoCam(h: number, fov: number, groundY: number, topY: number, fill = 0.78): Cam {
  const mid = (groundY + topY) / 2
  const want = h * fill
  const cam: Cam = {yaw: 0, pitch: 0.11, dist: (topY - groundY) * 2.2, ty: mid, fov}
  for (let i = 0; i < 4; i++) {
    const a = project(v3(0, groundY, 0), cam, h, h)
    const b = project(v3(0, topY, 0), cam, h, h)
    const span = Math.abs(a.y - b.y) || 1
    cam.dist *= span / want
  }
  return cam
}

const fog = (z: number, near: number, far: number): number =>
  Math.max(0, Math.min(1, (z - near) / (far - near)))

/* ───────────────────────────── the scene ───────────────────────────── */

function drawStage(
  ctx: CanvasRenderingContext2D, w: number, h: number, cam: Cam,
  opts: {groundY: number; time: number},
): void {
  // sky / backdrop
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#0b1017')
  sky.addColorStop(0.55, '#151d27')
  sky.addColorStop(1, '#0a0e13')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // a moon disc, parallax-fixed (it is "infinitely" far)
  ctx.save()
  ctx.globalAlpha = 0.55
  const mx = w * 0.84, my = h * 0.13
  const moon = ctx.createRadialGradient(mx, my, 2, mx, my, Math.min(w, h) * 0.085)
  moon.addColorStop(0, 'rgba(226,238,248,0.80)')
  moon.addColorStop(0.28, 'rgba(150,180,205,0.22)')
  moon.addColorStop(1, 'rgba(150,180,205,0)')
  ctx.fillStyle = moon
  ctx.fillRect(mx - 80, my - 80, 160, 160)
  ctx.restore()

  // floor grid — real 3D, so the horizon and the spacing are earned
  const G = opts.groundY
  const S = 90, N = 14
  ctx.lineWidth = 1
  for (let i = -N; i <= N; i++) {
    for (const axis of [0, 1]) {
      const a = axis === 0 ? v3(i * S, G, -N * S) : v3(-N * S, G, i * S)
      const b = axis === 0 ? v3(i * S, G, N * S) : v3(N * S, G, i * S)
      const pa = project(a, cam, w, h), pb = project(b, cam, w, h)
      if (pa.z <= 1 || pb.z <= 1) continue
      const f = fog((pa.z + pb.z) / 2, cam.dist * 0.6, cam.dist * 2.6)
      ctx.strokeStyle = `rgba(126,178,208,${0.34 * (1 - f)})`
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke()
    }
  }

  // two gate pillars, staged behind the fighter to frame the action
  for (const px of [-260, 260]) {
    const base = project(v3(px, G, -230), cam, w, h)
    const top = project(v3(px, G + 210, -230), cam, w, h)
    if (base.z <= 1 || top.z <= 1) continue
    const f = fog(base.z, cam.dist * 0.6, cam.dist * 2.2)
    const wide = Math.max(6, 22 * base.s)
    ctx.fillStyle = `rgba(${22 + 18 * f},${30 + 20 * f},${36 + 22 * f},0.9)`
    ctx.fillRect(base.x - wide / 2, top.y, wide, base.y - top.y)
    ctx.fillStyle = `rgba(90,140,170,${0.12 * (1 - f)})`
    ctx.fillRect(base.x - wide / 2, top.y, Math.max(1.5, wide * 0.12), base.y - top.y)
  }

  // a pool of moonlight on the floor, centred on the fighter's mark
  const pool = project(v3(0, G + 0.4, 0), cam, w, h)
  if (pool.z > 1) {
    const pr = Math.max(40, 95 * pool.s)
    const g2 = ctx.createRadialGradient(pool.x, pool.y, 1, pool.x, pool.y, pr)
    g2.addColorStop(0, 'rgba(120,170,205,0.16)')
    g2.addColorStop(0.55, 'rgba(90,140,180,0.06)')
    g2.addColorStop(1, 'rgba(90,140,180,0)')
    ctx.save(); ctx.translate(pool.x, pool.y); ctx.scale(1, 0.34)
    ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // horizon haze so the grid dissolves instead of ending in a hard line
  const haze = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.72)
  haze.addColorStop(0, 'rgba(18,26,34,0)')
  haze.addColorStop(0.5, 'rgba(16,23,31,0.55)')
  haze.addColorStop(1, 'rgba(10,14,19,0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, h * 0.42, w, h * 0.3)
}

/* ───────────────────────────── the model ───────────────────────────── */

type Part = {a: V3; b: V3; ra: number; rb: number; z: number; kind: string}

function bodyParts(g: FighterGeom): Part[] {
  const hip = unproject(g.hip), waist = unproject(g.waist), chest = unproject(g.chest)
  const neck = unproject(g.neckTop), head = unproject(g.headC)
  const shR = unproject(g.shoulderR), shL = unproject(g.shoulderL)
  const elR = unproject(g.elbR), elL = unproject(g.elbL)
  const wrR = unproject(g.handR), wrL = unproject(g.handL)
  const hpR = unproject(g.hipPtR), hpL = unproject(g.hipPtL)
  const knR = unproject(g.kneeR), knL = unproject(g.kneeL)
  const anR = unproject(g.ankleR), anL = unproject(g.ankleL)
  const toR = unproject(g.toeR), toL = unproject(g.toeL)
  const P = (a: V3, b: V3, ra: number, rb: number, kind: string): Part =>
    ({a, b, ra, rb, z: (a.z + b.z) / 2, kind})
  return [
    // torso as three stacked segments — pelvis girdle, waist, ribcage
    P(hip, waist, 5.2, 4.5, 'torso'),
    P(waist, chest, 4.5, 9.2, 'torso'),
    P(chest, neck, 8.4, 2.9, 'torso'),
    // head + jaw
    P(neck, head, 2.7, 6.2, 'head'),
    // arms (near limb reads first thanks to the depth sort)
    P(shR, elR, 3.4, 1.75, 'arm'),
    P(elR, wrR, 2.3, 1.2, 'arm'),
    P(shL, elL, 3.4, 1.75, 'arm'),
    P(elL, wrL, 2.3, 1.2, 'arm'),
    // fists
    P(wrR, v3(wrR.x + (wrR.x - elR.x) * 0.22, wrR.y + (wrR.y - elR.y) * 0.22, wrR.z), 2.1, 1.6, 'fist'),
    P(wrL, v3(wrL.x + (wrL.x - elL.x) * 0.22, wrL.y + (wrL.y - elL.y) * 0.22, wrL.z), 2.1, 1.6, 'fist'),
    // legs
    P(hpR, knR, 4.2, 3.0, 'leg'),
    P(knR, anR, 2.75, 1.4, 'leg'),
    P(hpL, knL, 4.2, 3.0, 'leg'),
    P(knL, anL, 2.75, 1.4, 'leg'),
    P(anR, toR, 1.5, 1.1, 'foot'),
    P(anL, toL, 1.5, 1.1, 'foot'),
  ]
}

/** Vertical extent of the solved body in world units. */
function bounds(pose: Float32Array): {groundY: number; topY: number} {
  const g = solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
  let lo = Infinity, hi = -Infinity
  for (const p of bodyParts(g)) {
    lo = Math.min(lo, p.a.y, p.b.y)
    hi = Math.max(hi, p.a.y, p.b.y)
  }
  return {groundY: lo, topY: hi}
}

const guardPose = (): Float32Array => {
  const p = new Float32Array(CH)
  for (let i = 0; i < CH; i++) p[i] = UNARMED_GUARD[i]
  return p
}
const FRAME = bounds(guardPose())

function drawModel(
  ctx: CanvasRenderingContext2D, w: number, h: number, cam: Cam, parts: Part[],
  opts: {alpha?: number; rim?: number},
): void {
  const alpha = opts.alpha ?? 1
  const rim = opts.rim ?? 1

  // A tapered capsule per segment (half-cap at each end), polygon-sampled so
  // differing radii never produce a degenerate arc.
  const caps = (A: Proj, B: Proj, ra: number, rb: number) => {
    const ang = Math.atan2(B.y - A.y, B.x - A.x)
    const CAP = 7
    const pts: {x: number; y: number}[] = []
    // Cap at B must sweep the FORWARD side (through ang), the cap at A the
    // BACKWARD side (through ang+PI). Sample them the other way round and the
    // outline folds back across the segment, which under the nonzero winding
    // rule punches a lens-shaped hole out of every joint — the "ball joint
    // discs" that kept appearing at every knee and elbow.
    for (let i = 0; i <= CAP; i++) {
      const a = ang - Math.PI / 2 + (i / CAP) * Math.PI
      pts.push({x: B.x + Math.cos(a) * rb, y: B.y + Math.sin(a) * rb})
    }
    for (let i = 0; i <= CAP; i++) {
      const a = ang + Math.PI / 2 + (i / CAP) * Math.PI
      pts.push({x: A.x + Math.cos(a) * ra, y: A.y + Math.sin(a) * ra})
    }
    return pts
  }

  const drawn = parts
    .map((part) => {
      const A = project(part.a, cam, w, h), B = project(part.b, cam, w, h)
      if (A.z <= 1 || B.z <= 1) return null
      const ra = Math.max(0.5, part.ra * A.s), rb = Math.max(0.5, part.rb * B.s)
      return {part, A, B, ra, rb, pts: caps(A, B, ra, rb)}
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)

  if (!drawn.length) return
  // Two depth bands, each filled as ONE path. Filling per-part leaves the
  // shared cap of every joint overlapped twice at two different tones, which
  // reads as a ball joint bolted onto the limb.
  const zs = drawn.map((d) => d.part.z)
  const mid = (Math.min(...zs) + Math.max(...zs)) / 2
  const bands: typeof drawn[] = [[], []]
  for (const d of drawn) bands[d.part.z > mid ? 0 : 1].push(d) // 0 = far, 1 = near
  const toneOf = [26, 6]
  bands.forEach((band, bi) => {
    if (!band.length) return
    const tone = toneOf[bi]
    // Same colour, one fill PER part. Batching them into a single path makes
    // overlapping subpaths cancel under the nonzero winding rule, which is
    // what punched a light disc through every knee and elbow.
    ctx.fillStyle = `rgba(${tone},${tone + 3},${tone + 7},${alpha})`
    for (const d of band) {
      ctx.beginPath()
      ctx.moveTo(d.pts[0].x, d.pts[0].y)
      for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i].x, d.pts[i].y)
      ctx.closePath()
      ctx.fill()
    }
  })

  // Form: one edge light per segment on the moon side only — no outline, so
  // no seams where two caps meet.
  if (rim > 0) {
    for (const d of drawn) {
      const {A, B, ra, rb, part} = d
      const dx = B.x - A.x, dy = B.y - A.y
      const len = Math.hypot(dx, dy) || 1
      const nx = dy / len, ny = -dx / len
      const sgn = ny <= 0 ? 1 : -1
      const depth = Math.max(0, Math.min(1, (A.z - (cam.dist - 60)) / 120))
      const far = part.z > mid
      ctx.strokeStyle = `rgba(${150 + depth * 40},${192 + depth * 26},${222},${(far ? 0.16 : 0.46) * (1 - depth * 0.7) * rim * alpha})`
      ctx.lineWidth = Math.max(0.7, 0.8 * Math.min(1.6, A.s * 0.24))
      ctx.beginPath()
      ctx.moveTo(A.x + nx * ra * sgn, A.y + ny * ra * sgn)
      ctx.lineTo(B.x + nx * rb * sgn, B.y + ny * rb * sgn)
      ctx.stroke()
    }
  }

  // head: skull with a jaw taper, not a pasted circle
  const head = drawn.find((d) => d.part.kind === 'head')
  if (head) {
    const p = head.B
    // head.rb on a drawn entry is ALREADY projected — multiplying by p.s
    // again gives a 40x skull (it did, and it ate the whole frame).
    const r = Math.max(2, head.rb * 0.72)
    const ang = Math.atan2(p.y - head.A.y, p.x - head.A.x)
    ctx.save()
    ctx.translate(p.x, p.y); ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(-r * 0.1, -r)
    ctx.bezierCurveTo(r * 0.95, -r * 0.95, r * 1.0, r * 0.35, r * 0.35, r * 0.95)
    ctx.bezierCurveTo(r * 0.1, r * 1.15, -r * 0.6, r * 1.05, -r * 0.95, r * 0.55)
    ctx.bezierCurveTo(-r * 1.15, r * 0.05, -r * 1.05, -r * 0.75, -r * 0.1, -r)
    ctx.closePath()
    ctx.fillStyle = `rgba(6,8,11,${alpha})`; ctx.fill()
    ctx.restore()
  }
}

function drawShadow(
  ctx: CanvasRenderingContext2D, w: number, h: number, cam: Cam,
  g: FighterGeom, groundY: number, contact: number,
): void {
  const feet = [unproject(g.ankleL), unproject(g.ankleR)]
  const cx = (feet[0].x + feet[1].x) / 2, cz = (feet[0].z + feet[1].z) / 2
  const base = project(v3(cx, groundY + 0.5, cz), cam, w, h)
  if (base.z <= 1) return
  const spread = Math.hypot(feet[0].x - feet[1].x, feet[0].z - feet[1].z) * 0.5
  const rx = Math.max(10, (14 + spread) * base.s)
  const ry = Math.max(3, rx * 0.28)
  const grad = ctx.createRadialGradient(base.x, base.y, 1, base.x, base.y, rx)
  grad.addColorStop(0, `rgba(0,0,0,${0.55 + contact * 0.2})`)
  grad.addColorStop(0.65, 'rgba(0,0,0,0.25)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.translate(base.x, base.y)
  ctx.scale(1, ry / rx)
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/* ───────────────────────────── frame assembly ───────────────────────────── */

interface Shot { id: string; t: number }

function poseOf(clip: {dur: number} & object, t: number, out: Float32Array): Float32Array {
  return sampleClip(clip as never, Math.min(t, clip.dur), out)
}

function frame(
  w: number, h: number, cam: Cam, pose: Float32Array, groundY: number, contact: number,
): Canvas {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D
  drawStage(ctx, w, h, cam, {groundY, time: 0})
  const g = solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
  drawShadow(ctx, w, h, cam, g, groundY, contact)
  drawModel(ctx, w, h, cam, bodyParts(g), {})
  return c
}

/* ───────────────────────────── deliverables ───────────────────────────── */

const BASE_CAM: Cam = {yaw: -0.62, pitch: 0.13, dist: 300, ty: -34, fov: 42}

function stage(): void {
  const W = 1500, H = 700
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D
  ctx.fillStyle = '#0a0e13'; ctx.fillRect(0, 0, W, H)

  const angles: {label: string; yaw: number; pose: Float32Array}[] = []
  const guard = guardPose()
  const contact = sampleClip(MOVES.omegaPalm.clip as never, MOVES.omegaPalm.hit.start, new Float32Array(CH))
  const wrap = sampleClip(MOVES.viperPalm.clip as never, MOVES.viperPalm.hit.start, new Float32Array(CH))
  angles.push({label: 'FRONT 3/4 · guard', yaw: -0.5, pose: guard})
  angles.push({label: 'PROFILE · omega palm contact', yaw: -1.45, pose: contact})
  angles.push({label: 'REAR 3/4 · viper palm', yaw: 2.2, pose: wrap})
  angles.push({label: 'LOW HERO · guard', yaw: 0.55, pose: guard})

  if (process.env.DBG3D) {
    const g0 = solveFighter3D(guard, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
    const c0 = {...autoCam(H, 42, FRAME.groundY, FRAME.topY, 0.80), yaw: -0.5}
    const foot = project(v3(0, FRAME.groundY, 0), c0, H, H)
    const head = project(v3(0, FRAME.topY, 0), c0, H, H)
    const ankle = project(unproject(g0.ankleR), c0, H, H)
    const skull = project(unproject(g0.headC), c0, H, H)
    console.log('FRAME', FRAME, 'cam', c0, 'axisFootY', foot.y.toFixed(0), 'axisHeadY', head.y.toFixed(0))
    console.log('ankleY', ankle.y.toFixed(0), 'skullY', skull.y.toFixed(0))
  }
  const cell = W / angles.length
  angles.forEach((a, i) => {
    const sub = createCanvas(cell, H)
    const sctx = sub.getContext('2d') as unknown as CanvasRenderingContext2D
    const cam: Cam = {...autoCam(H, 42, FRAME.groundY, FRAME.topY, 0.80), yaw: a.yaw,
      pitch: i === 3 ? 0.02 : 0.12}
    drawStage(sctx, cell, H, cam, {groundY: FRAME.groundY, time: 0})
    // model, shifted into this cell's own projection centre
    const g = solveFighter3D(a.pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
    drawShadow(sctx, cell, H, cam, g, FRAME.groundY, 0)
    drawModel(sctx, cell, H, cam, bodyParts(g), {})
    ctx.drawImage(sub as unknown as CanvasImageSource, i * cell, 0)
    ctx.fillStyle = '#8fb6cf'; ctx.font = 'bold 17px sans-serif'
    ctx.fillText(a.label, i * cell + 22, 34)
  })
  ctx.fillStyle = '#e8f1f7'; ctx.font = 'bold 30px sans-serif'
  ctx.fillText('SHADOW RONIN — real-3D stage, 4 camera solves, unmodified game rig', 24, H - 26)
  writeFileSync('research/stage-3d.png', c.toBuffer('image/png'))
  console.log('wrote research/stage-3d.png')
}

function sheet(): void {
  // A full combo, captured at the display rate the game actually plays at.
  const combo: Shot[] = []
  const chain: {id: string; until?: number}[] = [
    {id: 'l1'}, {id: 'l2'}, {id: 'l3'}, {id: 'viperPalm'}, {id: 'cyclone'}, {id: 'omegaPalm'},
  ]
  for (const m of chain) {
    const clip = MOVES[m.id].clip
    const n = Math.ceil(clip.dur * 24)
    for (let i = 0; i < n; i++) combo.push({id: m.id, t: i / 24})
  }
  const COLS = 8, CELL = 236
  const rows = Math.ceil(combo.length / COLS)
  const HEAD = 118
  const W = COLS * CELL, H = HEAD + rows * CELL + 54
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D
  ctx.fillStyle = '#0a0e13'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#e8f1f7'; ctx.font = 'bold 30px sans-serif'
  ctx.fillText('2D SPRITE SHEET — captured from the 3D stage at 24 fps', 24, 42)
  ctx.fillStyle = '#7fa6bf'; ctx.font = '17px sans-serif'
  ctx.fillText('l1 jab → l2 cross → l3 hook → viper palm → cyclone backfist → omega palm   ·   hold · snap · brace timing baked in, no physics', 24, 70)
  ctx.fillText('each cell = one displayed frame · camera drifts with the combo and punches in on the finisher', 24, 94)

  const pose = new Float32Array(CH)
  combo.forEach((shot, idx) => {
    const col = idx % COLS, row = Math.floor(idx / COLS)
    const x0 = col * CELL, y0 = HEAD + row * CELL
    const clip = MOVES[shot.id].clip
    const prog = idx / combo.length
    // staging: the camera slow-drifts, then pushes in for the finisher
    const finisher = shot.id === 'omegaPalm'
    const base = autoCam(CELL, 42, FRAME.groundY, FRAME.topY, 0.82)
    const cam: Cam = {
      ...base,
      yaw: BASE_CAM.yaw + Math.sin(prog * 2.2) * 0.10 + (finisher ? -0.10 : 0),
      dist: base.dist * (finisher ? 0.96 : 1) - Math.sin(prog * Math.PI) * 5,
      pitch: base.pitch + (finisher ? 0.02 : 0),
    }
    poseOf(clip, shot.t, pose)
    const g = solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
    const inWindow = shot.t >= MOVES[shot.id].hit.start - 1e-6 && shot.t <= MOVES[shot.id].hit.end + 1e-6
    const sub = createCanvas(CELL, CELL)
    const sctx = sub.getContext('2d') as unknown as CanvasRenderingContext2D
    drawStage(sctx, CELL, CELL, cam, {groundY: FRAME.groundY, time: 0})
    drawShadow(sctx, CELL, CELL, cam, g, FRAME.groundY, inWindow ? 1 : 0)
    drawModel(sctx, CELL, CELL, cam, bodyParts(g), {})
    ctx.drawImage(sub as unknown as CanvasImageSource, x0, y0)
    ctx.strokeStyle = inWindow ? 'rgba(255,70,70,0.85)' : 'rgba(90,130,155,0.22)'
    ctx.lineWidth = inWindow ? 2 : 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, CELL - 1, CELL - 1)
    ctx.fillStyle = inWindow ? '#ff6b6b' : '#5f7d92'
    ctx.font = '13px sans-serif'
    ctx.fillText(`${shot.id} f${Math.round(shot.t * 24)}`, x0 + 8, y0 + CELL - 8)
  })
  ctx.fillStyle = '#7fa6bf'; ctx.font = '16px sans-serif'
  ctx.fillText(`${combo.length} frames · 24 fps · ${(combo.length / 24).toFixed(2)}s of contact-chained combat · red border = hitbox open`, 24, H - 22)
  writeFileSync('research/sprite-sheet-3d.png', c.toBuffer('image/png'))
  // The atlas: a sprite sheet nobody can slice is a poster.
  const atlas = {
    image: 'sprite-sheet-3d.png',
    cols: COLS,
    cell: CELL,
    head: HEAD,
    fps: 24,
    frames: combo.map((shot, idx) => {
      const m = MOVES[shot.id]
      return {
        id: shot.id,
        t: Math.round(shot.t * 1000) / 1000,
        x: (idx % COLS) * CELL,
        y: HEAD + Math.floor(idx / COLS) * CELL,
        w: CELL,
        h: CELL,
        hit: shot.t >= m.hit.start - 1e-6 && shot.t <= m.hit.end + 1e-6,
      }
    }),
    moves: chain.map((m) => {
      const d = MOVES[m.id]
      return {id: m.id, label: d.label, dur: d.clip.dur, hitStart: d.hit.start, hitEnd: d.hit.end}
    }),
  }
  writeFileSync('research/sprite-sheet-3d.json', JSON.stringify(atlas, null, 1))
  console.log(`wrote research/sprite-sheet-3d.png (${combo.length} frames)`)
}

const mode = process.argv[2] ?? 'sheet'
if (mode === 'stage') stage()
else sheet()
