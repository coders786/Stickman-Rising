(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabTest3 = { ids: [], hits: -1, done: false, err: null, fired: null, snap: [], dist: null }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const a = g.player.action
      const id = a && a.def ? a.def.id : null
      if (id && !T.ids.includes(id)) T.ids.push(id)
      if (id === 'stabs' && !T.fired) {
        T.fired = { animT: +g.player.animator.getTime().toFixed(2) }
        T.snap.push({ ax: +g.worldRef.input.axisX(), face: g.player.face, grounded: g.player.grounded, chain: a.def.chain })
      }
    } catch (e) {}
  }, 20)
  ;(async () => {
    try {
      await sleep(300)
      // wait until an enemy is fully active
      for (let i = 0; i < 80; i++) {
        const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
        if (es.length) break
        await sleep(100)
      }
      // steer toward nearest ACTIVE enemy until within 60px
      for (let i = 0; i < 80; i++) {
        const p = g.player
        const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
        if (!es.length) break
        const ne = es.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a))
        const dx = ne.x - p.x
        T.dist = Math.round(Math.abs(dx))
        if (Math.abs(dx) < 60) break
        const key = dx > 0 ? 'KeyD' : 'KeyA'
        const off = dx > 0 ? 'KeyA' : 'KeyD'
        KEY(key, 'keydown'); KEY(off, 'keyup')
        await sleep(50)
      }
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      await sleep(120)
      // hold direction TOWARD nearest enemy through the whole sequence
      const p0 = g.player
      const es0 = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
      let holdKey = 'KeyD'
      if (es0.length) {
        const ne = es0.reduce((a, b) => (Math.abs(b.x - p0.x) < Math.abs(a.x - p0.x) ? b : a))
        holdKey = ne.x >= p0.x ? 'KeyD' : 'KeyA'
      }
      KEY(holdKey, 'keydown')
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // opener l1
      await sleep(660)                                // now inside l2 (cancel passed)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // chain tap + forward held -> stabs
      await sleep(720)                                // stabs clip is 0.78s
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // chain out of stabs
      await sleep(1600)
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      T.hits = g.combo.hits
      T.hp = g.enemies.map((e) => ({ dead: e.dead, hp: Math.round(e.hp) }))
      T.done = true
      clearInterval(iv)
    } catch (e) { T.err = String(e); T.done = true; clearInterval(iv) }
  })()
  return 'STABTEST3 STARTED'
})()
