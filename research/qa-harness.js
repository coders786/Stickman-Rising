(() => {
  const g = window.__sr;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const Q = window.__srQA = {
    errors: window.__qaErr,
    hits: {},
    kills: 0,
    comboMax: 0,
    arcActive: 0,
    arcWindow: 0,
    attackStates: {},
    poseNaN: 0,
    bladeSample: null,
  };
  const orig = g.hitEnemy.bind(g);
  g.hitEnemy = function (id, blade, atk) {
    Q.hits[atk.id] = (Q.hits[atk.id] || 0) + 1;
    return orig(id, blade, atk);
  };
  const sampler = () => {
    const p = g.player;
    Q.attackStates[p.state] = (Q.attackStates[p.state] || 0) + 1;
    if (p.state === 'attack' && p.action) {
      const h = p.action.def.hit;
      const t = p.action.animT;
      if (t >= h.start && t <= h.end) {
        Q.arcWindow++;
        if (p.swordArc && p.swordArc.weight > 0.5) Q.arcActive++;
      }
      for (let i = 0; i < p.pose.length; i++) {
        if (!isFinite(p.pose[i])) { Q.poseNaN++; break }
      }
      Q.bladeSample = [p.blade.bx, p.blade.by, p.blade.tx, p.blade.ty].map((v) => Math.round(v));
    }
    Q.comboMax = Math.max(Q.comboMax, g.combo.hits);
    Q.kills = g.stats.kills;
    if (!window.__qaDone) requestAnimationFrame(sampler);
  };
  requestAnimationFrame(sampler);
  const inp = g.input;
  const tap = (a, ms) => new Promise((res) => {
    inp.setVirtual(a, true);
    setTimeout(() => { inp.setVirtual(a, false); res() }, ms);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    try {
      const steer = setInterval(() => {
        const p = g.player;
        let best = null, bd = 1e9;
        for (const e of g.enemies) {
          if (e.dead || e.spawning) continue;
          const d = Math.abs(e.x - p.x);
          if (d < bd) { bd = d; best = e }
        }
        if (best) {
          const d = best.x - p.x;
          inp.setVirtual('right', Math.abs(d) > 55 && d > 0);
          inp.setVirtual('left', Math.abs(d) > 55 && d < 0);
        }
      }, 100);
      await sleep(2200);
      await tap('light', 60); await sleep(420);
      await tap('light', 60); await sleep(420);
      await tap('light', 60); await sleep(420);
      await tap('light', 60); await sleep(460);
      await tap('light', 60); await sleep(500);
      await tap('heavy', 60); await sleep(700);
      await tap('heavy', 60); await sleep(700);
      await tap('heavy', 1300); await sleep(900);
      await tap('light', 60); await sleep(420);
      await tap('light', 60); await sleep(420);
      await tap('light', 60); await sleep(500);
      await tap('jump', 80); await sleep(320);
      await tap('light', 60); await sleep(400);
      await tap('light', 60); await sleep(600);
      clearInterval(steer);
      inp.setVirtual('right', false); inp.setVirtual('left', false);
      await sleep(600);
      window.__qaDone = true;
      window.__qaResult = {
        ok: true,
        hits: Q.hits,
        totalHits: Object.values(Q.hits).reduce((a, b) => a + b, 0),
        kills: Q.kills,
        comboMax: Q.comboMax,
        arcCoverage: Q.arcWindow > 0 ? +(Q.arcActive / Q.arcWindow).toFixed(2) : 0,
        arcWindow: Q.arcWindow,
        poseNaN: Q.poseNaN,
        enemiesAlive: g.enemies.filter((e) => !e.dead).length,
        phase: g.phase,
        playerHp: g.player.hp,
        states: Q.attackStates,
        bladeSample: Q.bladeSample,
        errors: Q.errors,
      };
    } catch (err) {
      window.__qaDone = true;
      window.__qaResult = { ok: false, error: String((err && err.stack) || err) };
    }
  })();
})()
