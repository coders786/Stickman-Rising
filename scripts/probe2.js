(() => {
  const g = window.__sr
  if (!g) return 'NO __sr'
  const T = window.__probe2 = { calls: [], frames: [], done: false, err: null }
  g.startRun('katana')
  const orig = g.player.startAttack.bind(g.player)
  g.player.startAttack = (def, w, fp) => {
    try {
      T.calls.push([def ? def.id : 'NULL', +w.input.axisX(), g.player.face, g.player.grounded, !!fp])
    } catch (e) {}
    return orig(def, w, fp)
  }
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const p = g.player, a = p.action
      T.frames.push([
        a && a.def ? a.def.id : null,
        a ? +(p.animator.getTime()).toFixed(2) : null,
        +g.worldRef.input.axisX(), p.face, p.grounded,
        g.worldRef.input.buffered('light'),
        a && a.def ? a.def.chain.join(',') : null,
      ])
    } catch (e) {}
  }, 10)
  ;(async () => {
    try {
      await sleep(300)
      KEY('KeyD', 'keydown')                          // hold forward the whole time
      await sleep(700)                                // enemies chase -> in range by now
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')    // T0: opener l1
      await sleep(660)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')    // chain tap during l2 window
      await sleep(2000)
      KEY('KeyD', 'keyup')
      clearInterval(iv)
      T.done = true
    } catch (e) { T.err = String(e); T.done = true; clearInterval(iv) }
  })()
  return 'PROBE2 STARTED'
})()
