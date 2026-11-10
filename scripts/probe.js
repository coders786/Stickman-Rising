(() => {
  const g = window.__sr
  const T = window.__probe = { frames: [], err: null, done: false }
  g.startRun('katana')
  const KEY = (c, t) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const p = g.player, a = p.action
      T.frames.push([
        a && a.def ? a.def.id : null,
        a ? +p.animator.getTime().toFixed(2) : null,
        +g.worldRef.input.axisX(), p.face, p.grounded,
        g.worldRef.input.buffered('light'),
      ])
    } catch (e) {}
  }, 20)
  ;(async () => {
    await sleep(300)
    KEY('KeyD', 'keydown')
    await sleep(900)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
    await sleep(160)
    KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
    await sleep(1100)
    KEY('KeyD', 'keyup')
    clearInterval(iv)
    T.done = true
  })()
  return 'PROBE STARTED'
})()
