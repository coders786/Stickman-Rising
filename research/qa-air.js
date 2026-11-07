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
      await sleep(50);
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
      // ---------- HARVEST air + retreat + dashHeavy ----------
      // air cycle a1-a3: light pressed well inside air time
      for (let i = 0; i < 3; i++) {
        await neutral();
        await tap('jump', 90); await sleep(130); await tap('light', 50); await waitAttack(); await sleep(1000);
      }
      // dive: jump + down + light
      await neutral();
      await tap('jump', 90); await sleep(130); setV('down', true); await tap('light', 50); await waitAttack(); await sleep(1200); setV('down', false);
      // slam: jump + heavy
      await neutral();
      await tap('jump', 90); await sleep(130); await tap('heavy', 50); await waitAttack(); await sleep(1200);
      // dashHeavy: dash then heavy quickly
      await neutral();
      await tap('dash', 50); await sleep(40); await tap('heavy', 50); await waitAttack(); await sleep(900);
      // retreat: enemy in front (soft aim), hold back, light
      await neutral();
      g.spawnEnemy('grunt', p.x + 110, 1);
      await sleep(1000);
      const re = g.enemies[g.enemies.length - 1];
      if (re) { re.update = () => {}; setV('left', true); await sleep(120); await tap('light', 50); await waitAttack(); await sleep(900); setV('left', false) }
      // ---------- MATRIX ----------
      const order = ['a1', 'a2', 'a3', 'dive', 'slam', 'dashHeavy', 'retreat'];
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
