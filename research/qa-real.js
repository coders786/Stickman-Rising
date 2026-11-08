/* QA: REAL-VIEW arm verification — the actual game render (with saya + sword)
 * zoomed on the player. States: sheathed rest, drawn idle, run, sprint. */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });

  // real game view (no solo overlay) + high zoom
  window.__srInspect.setView('off');
  g.cam.setZoom(3.0);
  g.cam.setZoom = () => {};

  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);

  const A = window.__qaReal = { phase: 'boot', done: false, errors: window.__qaErr };
  const shot = (name) => {
    window.__qaReadyForShot = name;
  };

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;

      // 1. SHEATHED REST (the pommel pose, real render with saya)
      A.phase = 'sheath';
      setV('left', false); setV('right', false);
      p.x = 640; p.vx = 0;
      p.action = null; p.state = 'move';
      for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
      p.face = 1;
      p.swordDrawn = false;
      p.peaceT = 0;
      p.sheathAct = null;
      g.cam.snapTo(640, -150);
      await sleep(1600);
      shot('real-sheathRest');
      await sleep(1200);
      shot('real-sheathRest2');

      // 2. DRAWN SAFE IDLE
      A.phase = 'idle';
      p.swordDrawn = true; p.peaceT = 0;
      await sleep(1000);
      shot('real-idleDrawn');
      await sleep(900);
      shot('real-idleDrawn2');

      // 3. RUN (full cycle)
      A.phase = 'run';
      setV('right', true);
      await sleep(1100);
      for (let i = 0; i < 6; i++) {
        p.x = 640; g.cam.snapTo(640, -150);
        shot('real-run-' + i);
        await sleep(140);
      }
      setV('right', false);
      await sleep(500);

      // 4. SPRINT
      A.phase = 'sprint';
      p.sprintLatch = true;
      setV('right', true);
      await sleep(1200);
      for (let i = 0; i < 6; i++) {
        p.x = 640; g.cam.snapTo(640, -150);
        shot('real-sprint-' + i);
        await sleep(110);
      }
      setV('right', false);
      p.sprintLatch = false;

      A.done = true;
      A.phase = 'done';
    } catch (err) {
      A.errors.push(String(err && err.stack || err));
      A.done = true;
    }
  })();
})();
