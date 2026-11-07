(() => {
  const g = window.__sr
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
  const keyup = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  const tap = async (c) => { key(c); await sleep(90); keyup(c); await sleep(25) }
  const live = () => g.enemies.filter(e => !e.dead && !e.spawning)
  const log = []
  const god = setInterval(() => { if (g.player) { g.player.hp = g.player.maxHp; g.player.iframes = 1.5 } }, 200)
  async function chainTap(label, code, wait) {
    const es = live()
    if (!es.length) { log.push({ step: label, err: 'no enemies' }); return }
    const e = es[0]
    const pinX = e.x
    const pin = setInterval(() => { if (!e.dead) { e.x = pinX; e.vx = 0 } }, 16)
    g.player.x = e.x - 55; g.player.face = 1; g.player.vx = 0; g.player.y = 0
    const before = g.combo.hits
    await tap(code)
    await sleep(wait)
    clearInterval(pin)
    log.push({ step: label, before, after: g.combo.hits, eDead: e.dead, eHp: e.dead ? 0 : +e.hp.toFixed(0), live: live().length, sword: g.player.sword.id, atkSpeed: g.player.sword.stats.spd })
  }
  async function run() {
    for (let i = 0; i < 40 && live().length === 0; i++) await sleep(300)
    if (!live().length) { clearInterval(god); return 'NO_ENEMIES' }
    await chainTap('L1', 'KeyJ', 550)
    await chainTap('L2', 'KeyJ', 550)
    await chainTap('L3', 'KeyJ', 600)
    await chainTap('L4', 'KeyJ', 700)
    await chainTap('L5', 'KeyJ', 800)
    await chainTap('H1', 'KeyK', 950)
    clearInterval(god)
    window.__probe5 = log
    return 'DONE'
  }
  window.__probe5 = null
  run()
  return 'P5_STARTED'
})()
