/** Matched software-render reference, not a browser performance benchmark.
 * node --import tsx scripts/capture-ultra.ts [output directory] */
import sharp from 'sharp'
import { mulberry32 } from '../src/game/core/utils'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, Path2D } from '@napi-rs/canvas'
import { ART_GRADES, BRIDGE_ART, type ArtGrade } from '../src/game/world/art-grade'
import { Input } from '../src/game/core/input'
import type { WorldRef } from '../src/game/core/types'
import { Camera } from '../src/game/core/camera'
import { Player } from '../src/game/entities/player'
import { Enemy, PLAYER_X_REF } from '../src/game/entities/enemy'
import { ProjectilePool } from '../src/game/entities/projectiles'
import { FX } from '../src/game/fx/fx'
import { HUD, type HudState } from '../src/game/render/hud'
import { Renderer } from '../src/game/render/renderer'
import { CyberBackground } from '../src/game/world/background'
import { PropField } from '../src/game/world/props'
import { makeProfile } from '../src/game/world/profile'

Object.defineProperty(globalThis, 'document', { value: { createElement: () => createCanvas(1, 1) } })
Object.defineProperty(globalThis, 'Path2D', { value: Path2D })
const motion = process.argv.includes('--motion')
const rollout = motion || process.argv.includes('--live-art')
const specimen = !rollout && process.argv.includes('--amber')
const grades = specimen || process.argv.includes('--grades')
const out = process.argv.slice(2).find(a => !a.startsWith('--')) ?? (rollout ? 'out/ultra-live' : specimen ? 'out/ultra-amber' : grades ? 'out/ultra-grades' : 'out/ultra-reference')
mkdirSync(out, { recursive: true })
const rows: Record<string, string | number | boolean>[] = []
const motionWrites: Promise<unknown>[] = []
function awaitFrame(png: Buffer, width: number, height: number) {
  return sharp(png).resize(width, height).removeAlpha().raw().toBuffer()
}
function writeMotion(file: string, frames: Promise<Buffer>[], width: number, height: number) {
  motionWrites.push(Promise.all(frames).then(pixels => sharp(Buffer.concat(pixels), {
    raw: { width, height: height * frames.length, pageHeight: height, channels: 3 },
  }).webp({ lossless: true, delay: 50, loop: 0 }).toFile(file)))
}
const hudState: HudState = {
  hp: 100, maxHp: 100, energy: 30, maxEnergy: 100, stamina: 80, maxStamina: 100,
  dashCharge: 0, slashCharge: 0, swordDrawn: false, fistStrike: 'punch', staminaCooldown: 0,
  meter: 0, swordName: 'RONIN', swordColor: '#b9e4ff', abilityName: 'DASH', abilityCost: 20,
  combo: { hits: 0, mult: 1, rank: '', timer: 0, timerMax: 0, rankUpT: 0, lastHitT: 0 },
  wave: 1, enemiesLeft: 0, kills: 0, score: 0, boss: null, banner: null, executePrompt: null,
  ultReady: false, abilityReady: false, fps: 0, showFps: false, particleLevel: 0, runTime: 0, attract: false,
}
const profiles = Array.from({ length: 128 }, (_, i) => makeProfile(i + 1)).sort((a, b) => a.clouds.coverage - b.clouds.coverage)
const setups = [
  ['clear', profiles[0], 1280, 720, 1],
  ['hazy', profiles[64], 1920, 1080, 1],
  ['covered', profiles[127], 390, 844, 2],
] as const
const gradeIds = rollout || specimen ? ['deep-noir' as const] : grades ? Object.keys(ART_GRADES) as ArtGrade[] : [undefined]
for (const grade of gradeIds) for (const [label, profile, w, h, dpr] of grades || rollout ? setups.slice(0, 1) : setups) {
  const seed = profile.seed
  for (const [quality, forward] of [['high', false], ['ultra', false], ['ultra', true]] as const) {
    const canvas = createCanvas(w * dpr, h * dpr)
    const g = canvas.getContext('2d'); g.scale(dpr, dpr)
    const ctx = g as unknown as CanvasRenderingContext2D
    const renderer = new Renderer(); renderer.setQuality(quality); renderer.setDesktopLighting(forward)
    const bg = new CyberBackground(quality, undefined, rollout ? BRIDGE_ART : { grade, clean: grades, amberSpecimen: specimen })
    bg.setRunSeed(seed); bg.resize(w, h)
    const cam = new Camera(), player = new Player(), props = new PropField(), fx = new FX(), hud = new HUD()
    props.reset(seed); fx.setQuality(quality)
    if (grade) hud.setMoodLabel(ART_GRADES[grade].palette.name)
    const projectiles = new ProjectilePool()
    if (motion) {
      player.reset(730)
      const input = new Input()
      const poseWorld = { cam, fx, input, enemies: [], projectiles, time: 0,
        timeScale: 1, quality, gore: 'energy', arenaMinX: -150, arenaMaxX: 2750,
        audio: { play: () => {} } } as unknown as WorldRef
      const width = 480, height = 270, frames: Promise<Buffer>[] = []
      Math.random = mulberry32(seed)
      input.setVirtualAxis(1, 0)
      for (let step = 1; step <= 120; step++) {
        const dt = 1 / 60
        poseWorld.time = step * dt
        input.setVirtual('jump', step === 64)
        player.update(dt, poseWorld)
        input.endFrame(dt)
        cam.x = 830 + (player.x - 830) * .42; cam.y = -122; cam.zoom = 1.1
        cam.rot = step > 67 && step < 83 ? Math.sin((step - 67) * Math.PI / 16) * .018 : 0
        bg.storm.setView(cam); bg.storm.update(dt); bg.update(dt); fx.update(dt, dt)
        if (step % 3 !== 0) continue
        renderer.draw(ctx, { cam, player, props, fx, bg, enemies: [], hud, hudState, projectiles, time: poseWorld.time }, w, h, dt)
        frames.push(awaitFrame(canvas.toBuffer('image/png'), width, height))
      }
      const file = `crossing-${quality}-${forward ? 'forward' : 'capture'}.webp`
      writeMotion(join(out, file), frames, width, height)
      rows.push({ file, seed, w: width, h: height, dpr: 1, quality, forward, frames: frames.length, shot: 'walk-jump-roll', weather: true })
      continue
    }
    for (const [shot, pan, height, roll, count] of [
      ['idle', 830, 0, 0, 0], ['pan', 1420, 0, 0, 0], ['jump', 830, 84, 0, 1],
      ['crowd', 830, 0, 0, 4], ['impact', 830, 0, .021, 2], ['lightning', 830, 0, 0, 2],
    ] as const) {
      if (grades && !specimen && (shot === 'lightning' || shot === 'pan' || shot === 'impact')) continue
      if (specimen && shot === 'lightning') continue
      Math.random = mulberry32(seed ^ pan ^ count) // capture process only: matched fixture poses
      player.reset(pan - 42)
      player.y -= height; player.grounded = height === 0
      cam.x = pan; cam.y = -122; cam.zoom = w < 500 ? .81 : 1.08; cam.rot = roll
      PLAYER_X_REF.x = player.x; PLAYER_X_REF.y = player.y
      const enemies = Array.from({ length: count }, (_, i) => {
        const enemy = new Enemy(rollout ? (['grunt', 'assassin', 'heavy', 'grunt'] as const)[i] : 'grunt', pan + 42 + i * 59, 1)
        enemy.state = 'chase'; enemy.spawning = false
        enemy.y = 0; enemy.vy = 0
        return enemy
      })
      const poseWorld = { cam, fx, input: new Input(), enemies, projectiles, time: 0,
        timeScale: 1, quality, gore: 'energy', arenaMinX: -150, arenaMaxX: 2750,
        audio: { play: () => {} } } as unknown as WorldRef
      for (let step = 1; step <= 6; step++) {
        poseWorld.time = step / 60
        player.update(1 / 60, poseWorld)
        for (const enemy of enemies) enemy.update(1 / 60, poseWorld)
      }
      fx.update(0, 1)
      if (shot === 'impact') fx.screenFlash('190,205,255', .09)
      if (!grades) {
        bg.storm.setView(cam)
        const ticks = shot === 'lightning' ? Math.max(0, 53 - Math.round(bg.storm.snapshot.time * 60)) : (rollout && shot === 'idle' ? 39 : 0)
        for (let i = 0; i < ticks; i++) { bg.storm.update(1 / 60); bg.update(1 / 60) }
      }
      const before = performance.now()
      renderer.draw(ctx, { cam, player, props, fx, bg, enemies, hud, hudState: { ...hudState, enemiesLeft: count }, projectiles, time: poseWorld.time }, w, h, 1 / 60)
      const softwareDrawMs = performance.now() - before
      const file = `${grade ? `${grade}-` : ''}${label}-${seed}-${shot}-${quality}-${forward ? 'forward' : 'capture'}.png`
      writeFileSync(join(out, file), canvas.toBuffer('image/png'))
      if (grades) {
        const pixels = g.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = Math.round(.2126 * pixels.data[i] + .7152 * pixels.data[i + 1] + .0722 * pixels.data[i + 2])
          pixels.data.fill(gray, i, i + 3)
        }
        g.putImageData(pixels, 0, 0)
        writeFileSync(join(out, file.replace('.png', '-gray.png')), canvas.toBuffer('image/png'))
      }
      rows.push({ grade: grade ?? 'seeded', weather: !grades, particles: false, file, seed, w, h, dpr, shot, quality, forward, softwareDrawMs })
    }
  }
}
Promise.all(motionWrites).then(() => {
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(rows, null, 2))
  console.log(`Wrote ${rows.length} matched renderer references to ${out}`)
}).catch(error => { console.error(error); process.exitCode = 1 })
