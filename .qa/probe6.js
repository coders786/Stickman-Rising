(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const tap = async (c) => { key(c); await sleep(90); keyup(c); await sleep(25) }
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 1.5 } }, 200)
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    let es = live()
    if (!es.length) { clearInterval(god); return 'NO_ENEMIES' }
    // run the chain quickly first (L1..L4 to build context)
    for (const wait of [550, 550, 600, 700]) {
      const e = live()[0]
      if (!e) break
      const pinX = e.x
      const pin = setInterval(() => { if (!e.dead) { e.x = pinX; e.vx = 0 } }, 16)
      g.player.x = e.x - 55; g.player.face = 1; g.player.vx = 0
      await tap('KeyJ')
      await sleep(wait)
      clearInterval(pin)
    }
    // L5
    const e5 = live()[0]
    if (e5) {
      const pinX = e5.x
      const pin = setInterval(() => { if (!e5.dead) { e5.x = pinX; e5.vx = 0 } }, 16)
      g.player.x = e5.x - 55; g.player.face = 1; g.player.vx = 0
      await tap('KeyJ')
      await sleep(800)
      clearInterval(pin)
    }
    // H1 with detailed dump
    const e6 = live()[0]
    if (!e6) { clearInterval(god); window.__probe6 = log; return 'NO_ENEMY_FOR_H1' }
    const pinX = e6.x
    const pin = setInterval(() => { if (!e6.dead) { e6.x = pinX; e6.vx = 0 } }, 16)
    g.player.x = e6.x - 55; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    key('KeyK')
    for (let i = 0; i < 12; i++) {
      const p = g.player
      const a = p.action
      log.push({
        t: i * 100, pstate: p.state,
        atk: a ? a.def.id : null, animT: a ? +a.animT.toFixed(3) : null,
        hw: a ? (a.animT >= a.def.hit.start && a.animT <= a.def.hit.end) : false,
        chargeT: p.charging ? +((p.chargeRatio * 0.55)).toFixed(2) : null,
        eState: e6.dead ? 'DEAD' : e6.state,
        hits: g.combo.hits, px: +p.x.toFixed(0), ex: +e6.x.toFixed(0),
        grounded: p.grounded,
      })
      await sleep(100)
      if (i === 0) keyup('KeyK')
    }
    clearInterval(pin); clearInterval(god)
    window.__probe6 = log
    return 'DONE'
  }
  window.__probe6 = null
  run()
  return 'P6_STARTED'
})()
