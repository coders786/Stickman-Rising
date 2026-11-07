(() => {
  const g = window.__sr
  if (!g) return 'NO_GAME'
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const results = []
  const add = (name, pass, detail) => results.push({ name, pass, detail })
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const tap = async (c) => { key(c); await sleep(90); keyup(c); await sleep(25) }
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)

  const god = setInterval(() => {
    if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 3 }
  }, 120)

  async function attackTest(label, code, delay) {
    const es = live()
    if (!es.length) { add(label + '-connects', false, 'no enemies'); return }
    const e = es[0]
    g.player.x = e.x - 55
    g.player.face = 1
    g.player.vx = 0; g.player.vy = 0; g.player.y = 0
    const pinX = e.x
    const pin = setInterval(() => {
      if (!e.dead) { e.x = pinX; e.vx = 0 }
    }, 16)
    const before = g.combo.hits
    await tap(code)
    await sleep(delay)
    clearInterval(pin)
    add(label + '-connects', g.combo.hits > before, `hits ${before} -> ${g.combo.hits}`)
  }

  async function run() {
    add('game-live', g.phase === 'playing', 'phase=' + g.phase)
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    add('enemies-present', live().length > 0, 'count=' + live().length)
    if (!live().length) { clearInterval(god); return results }

    await attackTest('L1', 'KeyJ', 550)
    await attackTest('L2', 'KeyJ', 550)
    await attackTest('L3', 'KeyJ', 600)
    await attackTest('L4', 'KeyJ', 700)
    await attackTest('L5', 'KeyJ', 800)
    await attackTest('H1', 'KeyK', 950)
    await attackTest('H2', 'KeyK', 950)

    const poses = []
    const sampler = setInterval(() => { poses.push({ t: performance.now(), p: Array.from(g.player.pose) }) }, 16)
    await tap('KeyJ')
    await sleep(320)
    await tap('KeyJ')
    await sleep(320)
    await tap('KeyJ')
    await sleep(320)
    await tap('KeyK')
    await sleep(500)
    clearInterval(sampler)
    // rate-normalized: pose velocity in rad (or px) per 60fps frame —
    // timer drift under headless load must not fake a "snap"
    let worst = 0, worstCh = -1, frameIdx = -1
    for (let i = 1; i < poses.length; i++) {
      const gapMs = Math.max(8, poses[i].t - poses[i - 1].t)
      const frames = gapMs / 16.67
      for (let c = 0; c < poses[i].p.length; c++) {
        const lim = (c < 2 ? 14 : 0.72) * frames
        const d = Math.abs(poses[i].p[c] - poses[i - 1].p[c])
        if (d > lim && d / frames > worst) { worst = d / frames; worstCh = c; frameIdx = i }
      }
    }
    add('inbetween-continuity', worstCh < 0 || worstCh < 2 || worst <= 0.72, `worstVel=${worst.toFixed(2)}per-frame ch=${worstCh} frame=${frameIdx}/${poses.length}`)

    const es2 = live()
    if (es2.length) {
      const e2 = es2[0]
      const pinX = e2.x
      const pin = setInterval(() => { if (!e2.dead) { e2.x = pinX; e2.vx = 0 } }, 16)
      g.player.x = e2.x - 55; g.player.face = 1
      let minDist = 999
      const distSampler = () => {
        const b = g.player.blade
        const d = Math.hypot((b.bx + b.tx) / 2 - e2.x, (b.by + b.ty) / 2 - (e2.y - 48 * e2.scale))
        if (d < minDist) minDist = d
        requestAnimationFrame(distSampler)
      }
      requestAnimationFrame(distSampler)
      await tap('KeyJ')
      await sleep(480)
      clearInterval(pin)
      add('blade-reaches-body', minDist < 40, `minBladeCenterDist=${minDist.toFixed(1)}px`)
    }

    let maxTorso = 0
    const torsoSampler = () => {
      const a = Math.abs(Math.atan2(Math.sin(g.player.pose[2]), Math.cos(g.player.pose[2])))
      if (a > maxTorso) maxTorso = a
      requestAnimationFrame(torsoSampler)
    }
    requestAnimationFrame(torsoSampler)
    await tap('KeyK')
    await sleep(650)
    add('torso-angle-sane', maxTorso < 1.1, `maxRootRot=${maxTorso.toFixed(2)}rad`)

    add('player-alive-at-end', g.player.state !== 'dead' && g.phase === 'playing', `state=${g.player.state} phase=${g.phase}`)
    clearInterval(god)
    return results
  }

  window.__qaResult = null
  run().then(r => { window.__qaResult = r })
  return 'QA_STARTED'
})()
