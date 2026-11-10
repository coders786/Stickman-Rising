(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabTest4 = { ids: [], maxHits: 0, done: false, err: null, fired: null, hp0: null, hp1: null }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const a = g.player.action
      const id = a && a.def ? a.def.id : null
      if (id && !T.ids.includes(id)) T.ids.push(id)
      if (id === 'stabs' && !T.fired) T.fired = { animT: +g.player.animator.getTime().toFixed(2) }
      const h = g.combo.hits
      if (h > T.maxHits) T.maxHits = h
      g.player.armorT = Math.max(g.player.armorT, 3) // hyper-armor: no hurt interrupts
    } catch (e) {}
  }, 20)
  ;(async () => {
    try {
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
        if (Math.abs(dx) < 60) break
        KEY(dx > 0 ? 'KeyD' : 'KeyA', 'keydown')
        KEY(dx > 0 ? 'KeyA' : 'KeyD', 'keyup')
        await sleep(50)
      }
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      await sleep(120)
      const p0 = g.player
      const es0 = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
      let holdKey = 'KeyD'
      if (es0.length) {
        const ne = es0.reduce((a, b) => (Math.abs(b.x - p0.x) < Math.abs(a.x - p0.x) ? b : a))
        holdKey = ne.x >= p0.x ? 'KeyD' : 'KeyA'
      }
      T.hp0 = g.enemies.map((e) => Math.round(e.hp))
      KEY(holdKey, 'keydown')
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // opener l1
      await sleep(660)                                // inside l2's chain window
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // forward + light -> RENZOKU TSUKI
      await sleep(720)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // chain out of stabs
      await sleep(900)
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      T.hp1 = g.enemies.map((e) => ({ dead: e.dead, hp: Math.round(e.hp) }))
      T.hitsEnd = g.combo.hits
      T.done = true
      clearInterval(iv)
    } catch (e) { T.err = String(e); T.done = true; clearInterval(iv) }
  })()
  return 'STABTEST4 STARTED'
})()
