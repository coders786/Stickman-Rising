(() => {
  const g = window.__sr
  if (!g) { window.__stabTest = { error: 'NO __sr' }; return 'NO __sr' }
  const T = window.__stabTest = { ids: [], hits: -1, done: false, err: null, actionAtFire: null, phase: g.phase }
  try {
    g.startRun('katana')
  } catch (e) { T.err = String(e); return 'ERR ' + e }
  const KEY = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => {
    try {
      const a = g.player && g.player.action
      const id = a && a.def ? a.def.id : null
      if (id && !T.ids.includes(id)) T.ids.push(id)
      if (id === 'stabs' && T.actionAtFire === null) {
        T.actionAtFire = { at: performance.now(), animT: g.player.animator ? g.player.animator.getTime() : null }
      }
    } catch (e) { /* sampling must never break the run */ }
  }, 25)
  ;(async () => {
    try {
      await sleep(300)
      KEY('KeyD', 'keydown')
      await sleep(1100)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
      await sleep(180)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
      await sleep(500)
      KEY('KeyJ', 'keydown'); KEY('KeyJ', 'keyup')
      await sleep(1600)
      KEY('KeyD', 'keyup')
      T.hits = g.combo.hits
      T.enemyCount = g.enemies ? g.enemies.filter((e) => !e.dead).length : -1
      T.done = true
      clearInterval(iv)
    } catch (e) { T.err = String(e); clearInterval(iv); T.done = true }
  })()
  return 'STABTEST STARTED phase=' + g.phase
})()
