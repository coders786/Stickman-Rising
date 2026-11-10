(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__stabTest2 = { ids: [], hits: -1, done: false, err: null, firedAt: null, dist: null }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const a = g.player.action
      const id = a && a.def ? a.def.id : null
      if (id && !T.ids.includes(id)) T.ids.push(id)
      if (id === 'stabs' && !T.firedAt) T.firedAt = { animT: +g.player.animator.getTime().toFixed(2) }
    } catch (e) {}
  }, 20)
  ;(async () => {
    try {
      await sleep(300)
      // dynamic approach: steer toward nearest living enemy until in reach
      for (let i = 0; i < 60; i++) {
        const p = g.player
        const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
        if (!es.length) break
        const ne = es.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a))
        const dx = ne.x - p.x
        T.dist = Math.abs(dx)
        if (Math.abs(dx) < 70) break
        const goRight = dx > 0
        KEY(goRight ? 'KeyD' : 'KeyA', 'keydown')
        KEY(goRight ? 'KeyA' : 'KeyD', 'keyup')
        await sleep(60)
      }
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      await sleep(150)
      // face the enemy with the held direction key (guarantees ax sign === face)
      const p = g.player
      const es = (g.enemies || []).filter((e) => !e.dead && !e.spawning)
      if (es.length) {
        const ne = es.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a))
        KEY(ne.x > p.x ? 'KeyD' : 'KeyA', 'keydown')
      }
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // opener l1
      await sleep(660)                                // l2 is active now, cancel 0.31 passed
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // chain tap WITH direction held -> stabs
      await sleep(700)                                // stabs runs (0.78s clip)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')   // chain out of stabs
      await sleep(1500)
      KEY('KeyD', 'keyup'); KEY('KeyA', 'keyup')
      T.hits = g.combo.hits
      T.done = true
      clearInterval(iv)
    } catch (e) { T.err = String(e); T.done = true; clearInterval(iv) }
  })()
  return 'STABTEST2 STARTED'
})()
