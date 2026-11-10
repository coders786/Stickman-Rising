(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabTest5 = { ids: [], calls: [], maxHits: 0, done: false, err: null, fired: null }
  g.startRun('katana')
  const orig = g.player.startAttack.bind(g.player)
  g.player.startAttack = (def, w, fp) => {
    try { T.calls.push(def ? def.id : 'NULL') } catch (e) {}
    return orig(def, w, fp)
  }
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
      g.player.armorT = Math.max(g.player.armorT, 3)
    } catch (e) {}
  }, 15)
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
      KEY(holdKey, 'keydown')                          // forward held through everything
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')     // T0: opener l1
      await sleep(180)                                 // buffered -> consumed by l1 chain @0.32
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')     // -> l2 starts
      await sleep(320)                                 // T0+500: inside l2, buffered
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')     // -> consumed by l2 chain @0.31 -> FORWARD BRANCH
      await sleep(850)                                 // stabs plays (0.78s)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')     // chain out of stabs
      await sleep(1200)
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      T.done = true
      clearInterval(iv)
    } catch (e) { T.err = String(e); T.done = true; clearInterval(iv) }
  })()
  return 'STABTEST5 STARTED'
})()
