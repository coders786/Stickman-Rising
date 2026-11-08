/* QA: live combat anatomy check — natural wave spawning, real attacks,
 * dash ghosts, charged strikes. Screenshots are gated on phase names. */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const tap = (a, ms) => new Promise((res) => { inp.setVirtual(a, true); setTimeout(() => { inp.setVirtual(a, false); res() }, ms || 70) });

  const C = window.__qaCombat = { phase: 'boot', errors: window.__qaErr, stats: null };

  (async () => {
    try {
      g.qaMode = false; // real waves
      g.startRun('thunder');
      await sleep(2500); // first wave spawns + approaches

      // ---- L1/L2 swings at the first enemies ----
      C.phase = 'combat-swings';
      await tap('atk1', 70);
      await sleep(280);
      await tap('atk1', 70);
      await sleep(280);
      await tap('atk1', 70);
      await sleep(420);

      // ---- dash THROUGH with ghosts visible ----
      C.phase = 'combat-dash';
      setV('right', true);
      await sleep(120);
      await tap('dash', 70);
      await sleep(140); // mid-glide: ghosts + afterimages live
      setV('right', false);
      await sleep(500);

      // ---- charged heavy into the pack ----
      C.phase = 'combat-charge';
      inp.setVirtual('atk2', true);
      await sleep(900); // charge glow builds
      setTimeout(() => inp.setVirtual('atk2', false), 30);
      await sleep(260); // release swing

      // ---- thunder bolt on-hit (ray bounce) ----
      C.phase = 'combat-thunder';
      await sleep(400);
      await tap('ability', 70);
      await sleep(500);

      C.phase = 'done';
      C.stats = { kills: g.stats.kills, hp: Math.round(p.hp), combo: g.combo.hits, errors: C.errors.length };
    } catch (e) {
      C.errors.push(String(e && e.stack || e));
      C.phase = 'error';
    }
  })();
})();
