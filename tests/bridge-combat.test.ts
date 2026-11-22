import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { Game } from '../src/game/game'
import type { WorldRef } from '../src/game/core/types'
import { Enemy, PLAYER_X_REF } from '../src/game/entities/enemy'
import { Projectile } from '../src/game/entities/projectiles'
import { ATTACKS, makeRuntimeInfo } from '../src/game/combat/attacks'
import { separateCrowd, type CrowdActor } from '../src/game/combat/crowd-spacing'
import { FlowTracker, STYLES, styleForHits } from '../src/game/combat/style'
import { BridgeRoute, type RouteShelter } from '../src/game/stage/route'
import { SERVICE_HOLD, SERVICE_BUFF_TIME, ServiceTerminal } from '../src/game/world/service'
import { RunPickups } from '../src/game/world/run-pickups'
import { addRibbonSample, drawRibbon, newRibbon, RIBBON_LIFETIME, trimRibbon } from '../src/game/fx/ribbon'

interface RouteGame {
  route: BridgeRoute
  worldRef: WorldRef
  service: ServiceTerminal
  setPhase(phase: 'playing'): void
  step(dt: number): void
  handleMetaInput(): void
  findExecuteTarget(): Enemy | null
  canOverdrive(): boolean
  enemyStrikePlayer(dmg: number, dir: number, heavy: boolean, x: number): boolean
  frame(now: number): void
  lastFrame: number
  hitstopT: number
  updateService(dt: number): void
  updateCinematics(dt: number): void
}
const game = () => {
  const g = new Game(), internals = g as unknown as RouteGame
  internals.setPhase('playing')
  g.input.setEnabled(true)
  return [g, internals] as const
}
const shelter = (r: BridgeRoute) => r.chunk(0).shelter!
const bay = (r: BridgeRoute): RouteShelter => [...r.between(0, 8000)].find(c => c.shelter?.kind === 'service')!.shelter!

test('shelter rejects melee, projectile sweeps and newly arriving enemies at both eaves', () => {
  const [g, q] = game(), s = shelter(q.route)
  g.player.reset(s.terminal)
  g.player.hp = 82
  assert.equal(q.enemyStrikePlayer(36, 1, true, s.left - 22), false)
  assert.equal(g.player.hp, 82)
  const b = new Projectile()
  b.spawn({ kind: 'bullet', x: s.left - 10, y: -50, vx: 1_500, vy: 0, life: 1, dmg: 19 }, false)
  assert.equal(b.update(1 / 60, q.worldRef), false)
  b.spawn({ kind: 'bullet', x: s.right + 10, y: -50, vx: -1_500, vy: 0, life: 1, dmg: 19 }, true)
  assert.equal(b.update(1 / 60, q.worldRef), false)
  const grp: CrowdActor[] = [
    { id: 1, x: s.left - 19, y: 0, vx: 120, scale: 1, state: 'chase', spawning: false, dead: false },
    { id: 2, x: s.left - 12, y: 0, vx: 120, scale: 1, state: 'chase', spawning: false, dead: false },
  ]
  for (let i = 0; i < 65; i++) separateCrowd(grp, 1 / 60, 16, Infinity, [], q.worldRef.enemyTravel)
  assert.ok(grp.every(e => e.x <= s.left - 12))
  assert.ok(grp[1].x - grp[0].x >= 25)
  for (let i = 0; i < 90; i++) q.step(1 / 60)
  assert.equal(g.enemies.length, 0)
  assert.equal(g.player.hp, 82)
})

test('Flow uses the seven thresholds, holds without pressure, and retains best after decay', () => {
  const f = new FlowTracker()
  for (const row of STYLES) {
    assert.notEqual(styleForHits(row.at - 1).rank, row.rank)
    while (f.hits < row.at) f.onHit()
    assert.equal(f.lastRank, row.rank)
    assert.equal(f.bestRank, row.rank)
  }
  f.update(60, true)
  assert.equal(f.timer, 2.6)
  f.update(2.599)
  assert.equal(f.hits, 80)
  f.update(.002)
  assert.equal(f.lastRank, '')
  assert.equal(f.hits, 0)
  assert.equal(f.best, 80)
  assert.equal(f.bestRank, 'SSS')
})

test('real terminal cancels incomplete hold, then pays Flow for HP, shield and one timed buff', () => {
  const [g, q] = game(), s = bay(q.route)
  g.player.reset(s.terminal)
  g.player.hp = 32
  for (let i = 0; i < 20; i++) g.combo.onHit()
  g.input.setVirtual('execute', true)
  q.updateService(SERVICE_HOLD - .02)
  assert.equal(g.player.hp, 32)
  g.input.setVirtual('execute', false)
  q.updateService(.04)
  assert.equal(q.service.progress, 0)
  g.input.setVirtual('execute', true)
  q.updateService(SERVICE_HOLD)
  assert.equal(g.player.hp, 72)
  assert.equal(g.player.shield, 50)
  assert.equal(g.combo.hits, 0)
  assert.equal(g.combo.bestRank, 'A')
  assert.equal(q.service.buff, s.buff)
  assert.equal(q.service.remaining, SERVICE_BUFF_TIME)
  assert.ok(q.service.isUsed(s.id))
  q.updateService(SERVICE_BUFF_TIME)
  assert.equal(q.service.buff, null)
  assert.equal(g.player.hp, 72)
  g.player.x = s.right + 90
  q.enemyStrikePlayer(22, 1, false, s.right + 150)
  assert.equal(g.player.shield, 28)
  assert.equal(g.player.hp, 72)
})

test('touch channel is a real 1.5s transaction and leaving range cancels it', () => {
  const s = bay(new BridgeRoute(42)), t = new ServiceTerminal()
  assert.equal(t.update(.1, s, s.terminal, 0, false, true), null)
  assert.equal(t.update(.7, s, s.terminal + 72, 0, false, false), null)
  assert.equal(t.progress, 0)
  assert.equal(t.update(1.5, s, s.terminal, 0, false, false), null)
  assert.equal(t.update(.75, s, s.terminal, 0, false, true), null)
  assert.equal(t.update(.75, s, s.terminal, 0, false, false), s.buff)
  assert.equal(t.update(2, s, s.terminal, 0, true, true), null)
})

test('contact pickups require a useful resource, grounded reach, and do not reappear', () => {
  const r = new BridgeRoute(42), c = r.chunk(1), x = c.propSockets[1], k = new RunPickups(r)
  assert.equal(k.take(x, -85, () => true), null)
  assert.equal(k.take(x + 30, 0, () => true), null)
  assert.equal(k.take(x, 0, () => false), null)
  assert.ok(k.take(x, 0, () => true))
  assert.equal(k.take(x, 0, () => true), null)
})

test('one-way platform catches the descending rig and down+jump drops without replaying the buffer', () => {
  const [g, q] = game(), walk = [...q.route.between(900, 6000)].find(c => c.platform)!.platform!, p = g.player
  const x = (walk.left + walk.right) / 2
  const step = () => { q.worldRef.time += 1 / 60; p.update(1 / 60, q.worldRef); g.input.endFrame(1 / 60) }
  p.reset(x)
  g.input.setVirtual('jump', true)
  step(); g.input.setVirtual('jump', false)
  let apex = 0
  for (let i = 0; i < 90; i++) { step(); apex = Math.min(apex, p.y) }
  assert.ok(apex < walk.y - .5 && apex >= -290)
  assert.equal(p.floorY, walk.y)
  assert.equal(p.y, walk.y)
  assert.equal(p.grounded, true)
  for (const toe of [p.geom.toeL, p.geom.toeR]) assert.ok(p.hipY + toe.y * p.scale <= walk.y + 2.5)
  g.input.setVirtual('down', true); g.input.setVirtual('jump', true)
  step(); g.input.setVirtual('jump', false)
  assert.ok(p.vy > 0)
  for (let i = 0; i < 40; i++) { step(); assert.ok(p.y >= walk.y) }
  assert.equal(p.y, 0)
  assert.equal(p.grounded, true)
})

test('a held jump can reach both deck tops and readably cap ascent from each support', () => {
  const [g, q] = game(), p = g.player
  const step = () => { q.worldRef.time += 1 / 60; p.update(1 / 60, q.worldRef); g.input.endFrame(1 / 60) }
  for (const height of [-96, -142]) {
    const walk = [...q.route.between(0, 25_000)].find(c => c.platform?.y === height)!.platform!
    // Carry horizontally onto the support, not just straight up through it.
    p.reset(walk.left - 35)
    g.input.setVirtualAxis(1, 0)
    g.input.setVirtual('jump', true)
    for (let i = 0; i < 38; i++) step()
    g.input.setVirtualAxis(0, 0); g.input.setVirtual('jump', false)
    for (let i = 0; i < 45; i++) step()
    assert.equal(p.y, height)
    assert.equal(p.floorY, height)
    assert.ok(p.grounded && p.x >= walk.left && p.x < walk.right)
    g.input.setVirtual('jump', true); step(); g.input.setVirtual('jump', false)
    for (let i = 0; i < 10; i++) step()
    g.input.setVirtual('jump', true); step()
    let apex = p.y
    for (let i = 0; i < 50; i++) { step(); apex = Math.min(apex, p.y) }
    g.input.setVirtual('jump', false)
    assert.ok(apex < height - 150 && apex >= height - 290, `apex ${apex} over ${height}`)
  }
})

test('road boss sweep is one contact, opens a parry window, and its stomp can be jumped', () => {
  const [, q] = game(), s = 1100, boss = new Enemy('boss', s, 1)
  boss.arriveOnRoute(1); boss.gate = 0
  assert.equal(boss.scale, 1.85)
  assert.equal(new Enemy('boss', s, 1).scale, 3, 'finite arena art stays unchanged')
  const brain = boss as unknown as { patternT: number; patternStep: number; patternIdx: number; strikeHits: number }
  let contacts = 0, parry = false
  q.worldRef.enemyStrikePlayer = () => { contacts++; return parry }
  const place = (y: number) => Object.assign(PLAYER_X_REF, { x: s + 60, y })
  const start = (patternStep: number, patternT = 0) => {
    boss.x = s; boss.vx = 0; boss.state = 'pattern'
    Object.assign(brain, { patternT, patternStep, patternIdx: 2, strikeHits: 1 })
  }
  place(-150); start(2)
  for (let i = 0; i < 5; i++) boss.update(1 / 60, q.worldRef)
  assert.equal(contacts, 0)
  place(0)
  for (let i = 0; i < 5; i++) boss.update(1 / 60, q.worldRef)
  assert.equal(contacts, 1)
  parry = true; start(2); boss.update(1 / 60, q.worldRef)
  assert.equal(boss.state, 'stun'); assert.ok(boss.vulnerableT > 0)
  parry = false; place(-40); start(3, .55); boss.update(1 / 60, q.worldRef)
  assert.equal(contacts, 2)
  place(0); start(3, .55); boss.update(1 / 60, q.worldRef)
  assert.equal(contacts, 3)
})

test('execute choreography stays outside the eaves at the inclusive reach boundary', () => {
  const [g, q] = game(), roof = shelter(q.route)
  const e = new Enemy('grunt', roof.right + 15, 1)
  e.arriveOnRoute(1); e.state = 'stun'; e.hp = 1
  g.enemies.push(e); g.player.reset(e.x + 146)
  assert.equal(q.findExecuteTarget(), e)
  g.input.setVirtual('execute', true); q.handleMetaInput()
  for (let i = 0; i < 190; i++) {
    q.updateCinematics(1 / 60)
    assert.ok(g.player.x >= roof.right + 12, 'execution arc crossed into cover')
  }
  assert.equal(g.stats.kills, 1)
})

test('nearest eligible victim wins; one full Overdrive burns the meter', () => {
  const [g, q] = game(), p = g.player
  p.reset(1100)
  const candidates = [[1212, 'stun'], [1170, 'down'], [1140, 'chase'], [1130, 'stun']] as const
  for (const [x, state] of candidates) {
    const e = new Enemy('grunt', x, 1)
    e.arriveOnRoute(-1); e.hp = e.maxHp * (x === 1130 ? .8 : .45); e.state = state; g.enemies.push(e)
  }
  assert.equal(q.findExecuteTarget(), g.enemies[1])
  g.input.setVirtual('execute', true)
  q.handleMetaInput()
  assert.equal(q.findExecuteTarget(), null)
  const [next, a] = game()
  next.player.reset(1100); next.player.meter = 100
  assert.equal(a.canOverdrive(), true)
  next.input.setVirtual('ult', true)
  a.handleMetaInput()
  assert.equal(next.player.meter, 0)
  assert.equal(a.canOverdrive(), false)
})

test('Guard-Crush Heavy removes frontal guard, unlike ordinary chip pressure', () => {
  const [g, q] = game(), e = new Enemy('shield', 1140, 1)
  g.player.reset(1100); e.arriveOnRoute(-1); e.blockUp = true; g.enemies.push(e)
  const blade = { bx: 1110, by: -60, tx: 1155, ty: -45 }
  const heavy = { ...makeRuntimeInfo(ATTACKS.h1, 1), heavy: true, breakGuard: false }
  assert.equal(q.worldRef.hitEnemy(e.id, blade, heavy).outcome, 'blocked')
  assert.ok(e.blockUp)
  q.service.buff = 'Guard-Crush Heavy'
  assert.equal(q.worldRef.hitEnemy(e.id, blade, heavy).outcome, 'guardBreak')
  assert.ok(!e.blockUp)
})

test('curved ribbon pins the newest tip, caps samples and expires on a 140ms clock', () => {
  const t = newRibbon()
  t.active = t.emitting = true
  for (let i = 0; i < 72; i++) addRibbonSample(t, 49, 88, 170 + i * .5, 80 - i * .55)
  assert.equal(t.count, t.N)
  const ctx = createCanvas(235, 180).getContext('2d'), tips: Array<[number, number]> = []
  const lineTo = ctx.lineTo.bind(ctx)
  ctx.lineTo = (x, y) => { tips.push([x, y]); lineTo(x, y) }
  drawRibbon(ctx as unknown as CanvasRenderingContext2D, t, { bx: 64, by: 75, tx: 220, ty: 40 })
  assert.ok(tips.some(([x, y]) => x === 220 && y === 40))
  assert.ok(tips.length > t.count * 4)
  trimRibbon(t, RIBBON_LIFETIME - .001)
  assert.ok(t.count > 0)
  trimRibbon(t, .002)
  assert.equal(t.count, 0)
})
