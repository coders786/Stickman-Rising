(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabHit2 = { hpAtFire: null, hpAfter: null, fired: false, done: false, hitsMax: 0, dist: null }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const sum = () => (g.enemies || []).filter((e) => !e.dead).reduce((s, e) => s + e.hp, 0)
  const iv = setInterval(() => {
    try {
      g.player.armorT = Math.max(g.player.armorT, 3)
      const a = g.player.action
      const id = a && a.def ? a.def.id : null
      const h = g.combo.hits
      if (h > T.hitsMax) T.hitsMax = h
      if (id === 'stabs' && !T.fired) {
        T.fired = true
        const es = (g.enemies || []).filter((e) => !e.dead)
        const ne = es.reduce((a, b) => (Math.abs(b.x - g.player.x) < Math.abs(a.x - g.player.x) ? b : a))
        T.dist = Math.round(ne.x - g.player.x)
        T.hpAtFire = sum()
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
    // PIN the nearest enemy right in front of the player (deterministic reach)
    const p = g.player
    const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
    if (es.length) {
      const ne = es.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a))
      ne.x = p.x + 72
      ne.vx = 0
      if (ne.vy) ne.vy = 0
    }
    KEY('KeyD', 'keydown')   // face + hold forward
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // l1
    await sleep(180)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // -> l2
    await sleep(320)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // -> stabs (forward held)
    await sleep(900)
    T.hpAfter = sum()
    KEY('KeyD', 'keyup')
    T.done = true
    clearInterval(iv)
  })()
  return 'STABHIT2 STARTED'
})()
