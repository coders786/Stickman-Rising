(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const Q = window.__srQA = { defs: {}, matrix: [] };
  const orig = g.hitEnemy.bind(g);
  let hitCount = 0;
  g.hitEnemy = function (id, blade, atk) { hitCount++; return orig(id, blade, atk); };
  const inp = g.input;
  const tap = (a, ms) => new Promise((res) => { inp.setVirtual(a, true); setTimeout(() => { inp.setVirtual(a, false); res() }, ms || 60) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const waitAttack = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 1500)) {
      if (p.state === 'attack' && p.action) { Q.defs[p.action.def.id] = p.action.def; return p.action.def.id }
      await sleep(40);
    }
    return null;
  };
  (async () => {
    try {
      g.waves.update = () => {};
      g.enemies.length = 0;
      const neutral = async () => {
        p.action = null; p.state = 'move'; p.charging = false;
        for (let i = 0; i < 40 && !p.grounded; i++) await sleep(80);
        setV('left', false); setV('right', false); setV('up', false); setV('down', false);
        p.face = 1;
        await sleep(150);
      };
      // ---- air chain harvest: a1 -> a2 -> a3 in one jump (floats extend airtime)
      await neutral();
      await tap('jump', 90); await sleep(130); await tap('light', 50); await waitAttack();
      await sleep(300); await tap('light', 50); await waitAttack();
      await sleep(320); await tap('light', 50); await waitAttack();
      await sleep(1200); await neutral();
      // ---- slam harvest: a1 then heavy in air
      await tap('jump', 90); await sleep(130); await tap('light', 50); await waitAttack();
      await sleep(300); await tap('heavy', 50); await waitAttack();
      await sleep(1400); await neutral();
      // ---- retreat harvest: pinned enemy far enough to not strike, hold back + light
      g.enemies.length = 0;
      g.spawnEnemy('grunt', p.x + 215, 1);
      await sleep(1000);
      const re = g.enemies[g.enemies.length - 1];
      if (re) {
        re.update = () => {};
        const d0 = Math.abs(re.x - p.x);
        setV('left', true); await sleep(140); await tap('light', 50);
        await waitAttack();
        setV('left', false);
        Q.retreatDist = Math.round(d0);
        await sleep(900);
      }
      // ---- matrix for the newly harvested defs ----
      const order = ['a2', 'a3', 'slam', 'retreat'];
      for (const id of order) {
        const def = Q.defs[id];
        if (!def) { Q.matrix.push({ id, hit: -1, note: 'not-harvested' }); continue }
        for (const dist of [80, 115]) {
          g.enemies.length = 0;
          await neutral();
          g.spawnEnemy('grunt', p.x + dist, 1);
          await sleep(1000);
          const e = g.enemies[g.enemies.length - 1];
          if (!e || e.dead) { Q.matrix.push({ id, dist, hit: -1, note: 'spawn-failed' }); continue }
          e.update = () => {};
          const d0 = Math.round(Math.abs(e.x - p.x));
          const hp0 = e.hp;
          hitCount = 0;
          p.startAttack(def, g.worldRef);
          await sleep(1400);
          Q.matrix.push({ id, dist, realDist: d0, hit: hitCount > 0 || e.dead ? 1 : 0, hits: hitCount, dmg: Math.round(hp0 - e.hp), dead: e.dead });
        }
      }
      g.enemies.length = 0;
      window.__qaDone = true;
      window.__qaResult = {
        ok: true,
        harvested: Object.keys(Q.defs),
        retreatDist: Q.retreatDist,
        matrix: Q.matrix,
        summary: {
          tested: Q.matrix.filter((m) => m.hit >= 0).length,
          passed: Q.matrix.filter((m) => m.hit === 1).length,
          missed: Q.matrix.filter((m) => m.hit === 0).map((m) => `${m.id}@${m.dist}`),
          notHarvested: Q.matrix.filter((m) => m.hit === -1).map((m) => m.id),
        },
        errors: window.__qaErr,
      };
    } catch (err) {
      window.__qaDone = true;
      window.__qaResult = { ok: false, error: String((err && err.stack) || err) };
    }
  })();
})()
