/* QA: screenshot states — idle / run / stop / attack, frozen and camera-
 * centered on the player, for VLM visual verification. */
(() => {
  const g = window.__sr;
  const p = g.player;
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const S = window.__qaShots = { phase: 'boot', ready: false };

  const run = async () => {
    // settle
    setV('left', false); setV('right', false); setV('up', false); setV('down', false);
    p.x = 640; p.vx = 0;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    await sleep(1500);
    S.phase = 'idle'; S.ready = true; await sleep(350);

    // draw the sword for guard verification
    setV('light', true); await sleep(90); setV('light', false);
    await sleep(1200);
    S.phase = 'guard-idle'; await sleep(350);

    // run
    setV('right', true); await sleep(900);
    S.phase = 'run'; await sleep(200);
    setV('right', true); await sleep(250);
    S.phase = 'run2'; await sleep(150);

    // stop
    setV('right', false);
    await sleep(420);
    S.phase = 'stopped'; await sleep(250);

    // attack from guard
    setV('light', true); await sleep(70); setV('light', false);
    await sleep(160);
    S.phase = 'attack'; await sleep(120);
    await sleep(700);

    // second attack (heavy for a different arc)
    setV('heavy', true); await sleep(70); setV('heavy', false);
    await sleep(200);
    S.phase = 'attack2'; await sleep(100);
    await sleep(800);
    S.phase = 'done';
  };
  run();
  return 'shot sequence started';
})()
