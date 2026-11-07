(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const Q = window.__srQA = { defs: {}, matrix: [], errors: window.__qaErr };
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
      await sleep(60);
    }
    return null;
  };
  const clearEnemies = () => { g.enemies.length = 0 };
  const neutral = async () => {
    p.action = null; p.state = 'move'; p.charging = false;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(80);
    setV('left', false); setV('right', false); setV('up', false); setV('down', false);
    p.face = 1;
    await sleep(120);
  };
  (async () => {
    try {
      // freeze the wave director — deterministic arena
      g.waves.update = () => {};
      clearEnemies();
      // ---------- HARVEST defs via natural inputs ----------
      await neutral();
      for (let i = 0; i < 5; i++) { await tap('light', 50); await waitAttack(); await sleep(430) }
      for (let i = 0; i < 3; i++) { await tap('heavy', 50); await waitAttack(); await sleep(650) }
      await tap('heavy', 1300); await waitAttack(2200); await sleep(900);
      await neutral();
      setV('down', true); await sleep(80); await tap('light', 50); await waitAttack(); await sleep(800); setV('down', false);
      await neutral();
      setV('up', true); await sleep(80); await tap('light', 50); await waitAttack(); await sleep(800); setV('up', false);
      await neutral();
      setV('left', true); await sleep(80); await tap('light', 50); await waitAttack(); await sleep(800); setV('left', false);
      await neutral();
      // air cycle a1-a3
      for (let i = 0; i < 3; i++) { await tap('jump', 70); await sleep(260); await tap('light', 50); await waitAttack(); await sleep(900); await neutral() }
      // dive
      await tap('jump', 70); await sleep(260); setV('down', true); await tap('light', 50); await waitAttack(); await sleep(1100); setV('down', false); await neutral();
      // slam
      await tap('jump', 70); await sleep(260); await tap('heavy', 50); await waitAttack(); await sleep(1100); await neutral();
      // dash attacks
      await tap('dash', 60); await sleep(90); await tap('light', 50); await waitAttack(); await sleep(900); await neutral();
      await tap('dash', 60); await sleep(90); await tap('heavy', 50); await waitAttack(); await sleep(900); await neutral();
      // riposte
      await neutral();
      p.riposteT = 1;
      await tap('light', 50); await waitAttack(); await sleep(900);
      // ---------- MATRIX: def x distance ----------
      const order = ['l1', 'l2', 'l3', 'l4', 'l5', 'spin', 'retreat', 'launcher', 'h1', 'h2', 'h3', 'charged', 'riposte', 'dashSlash', 'dashHeavy', 'a1', 'a2', 'a3', 'dive', 'slam'];
      for (const id of order) {
        const def = Q.defs[id];
        if (!def) { Q.matrix.push({ id, dist: -1, hit: -1, note: 'def-not-harvested' }); continue }
        for (const dist of [75, 115]) {
          clearEnemies();
          await neutral();
          g.spawnEnemy('grunt', p.x + dist, 1);
          await sleep(1000); // pod lands + settles
          const e = g.enemies[g.enemies.length - 1];
          if (!e || e.dead) { Q.matrix.push({ id, dist, hit: -1, note: 'spawn-failed' }); continue }
          e.update = () => {}; // pin: no walk, no attacks
          const d0 = Math.round(Math.abs(e.x - p.x));
          const hp0 = e.hp;
          hitCount = 0;
          p.startAttack(def, g.worldRef);
          await sleep(1250);
          const dmg = hp0 - e.hp;
          Q.matrix.push({ id, dist, realDist: d0, hit: hitCount > 0 || e.dead ? 1 : 0, hits: hitCount, dmg: Math.round(dmg), dead: e.dead });
          if (e.update) e.update = e.update; // stays pinned
        }
      }
      clearEnemies();
      window.__qaDone = true;
      window.__qaResult = {
        ok: true,
        harvested: Object.keys(Q.defs),
        matrix: Q.matrix,
        summary: {
          tested: Q.matrix.filter((m) => m.hit >= 0).length,
          passed: Q.matrix.filter((m) => m.hit === 1).length,
          missed: Q.matrix.filter((m) => m.hit === 0).map((m) => `${m.id}@${m.dist}`),
        },
        errors: Q.errors,
      };
    } catch (err) {
      window.__qaDone = true;
      window.__qaResult = { ok: false, error: String((err && err.stack) || err) };
    }
  })();
})()
