(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabHit = { hpAtFire: null, hpAfter: null, fired: false, done: false, ticks: [] }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const sum = () => (g.enemies || []).filter((e) => !e.dead).reduce((s, e) => s + e.hp, 0)
  const iv = setInterval(() => {
    try {
      g.player.armorT = Math.max(g.player.armorT, 3)
      const a = g.player.action
      const id = a && a.def ? a.def.id : null
      if (id === 'stabs') {
        if (!T.fired) { T.fired = true; T.hpAtFire = sum() }
        else T.ticks.push(Math.round((g.player.animator.getTime() + Number.EPSILON) * 100) / 100)
      }
    } catch (e) {}
  }, 10)
  ;(async () => {
    await sleep(300)
    for (let i = 0; i < 80; i++) {
      const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
      if (es.length) break
      await sleep(100)
    }
    for (let i = 0; i < 80; i++) {
      const p = g.player
      const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
      if (!es.length) break
      const ne = es.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a))
      const dx = ne.x - p.x
      if (Math.abs(dx) < 58) break
      KEY(dx > 0 ? 'KeyD' : 'KeyA', 'keydown')
      KEY(dx > 0 ? 'KeyA' : 'KeyD', 'keyup')
      await sleep(50)
    }
    KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
    await sleep(100)
    const p0 = g.player
    const es0 = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
    let holdKey = 'KeyD'
    if (es0.length) {
      const ne = es0.reduce((a, b) => (Math.abs(b.x - p0.x) < Math.abs(a.x - p0.x) ? b : a))
      holdKey = ne.x >= p0.x ? 'KeyD' : 'KeyA'
    }
    KEY(holdKey, 'keydown')
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
    await sleep(180)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
    await sleep(320)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
    // stabs now active for ~0.78s; wait for it to finish then read hp
    await sleep(900)
    T.hpAfter = sum()
    KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
    T.done = true
    clearInterval(iv)
  })()
  return 'STABHIT STARTED'
})()
