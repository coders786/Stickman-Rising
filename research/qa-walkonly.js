(() => {
  const g = window.__sr;
  const p = g.player;
  g.cam.setZoom(2.7);
  g.cam.setZoom = () => {};
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const shots = (window.__qaLimbShots = {});
  const S = 1.32;
  const chain = (s, e, h) => {
    const ux = e.x - s.x, uy = e.y - s.y, fx = h.x - e.x, fy = h.y - e.y;
    return { cross: +(ux * fy - uy * fx).toFixed(1), flip: (ux * fy - uy * fx) < 0 };
  };
  const readout = () => ({
    loco: p.loco, vx: Math.round(p.vx),
    eL: chain(p.geom.shoulderL, p.geom.elbL, p.geom.handL),
    eR: chain(p.geom.shoulderR, p.geom.elbR, p.geom.handR),
    bladeProj: +(p.geom.bladeProjAngle * 57.2958).toFixed(0),
  });
  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;
      setV('left', false); setV('right', false);
      p.x = 640; p.vx = 0; p.face = 1; p.swordDrawn = true; p.peaceT = 0; p.sheathAct = null;
      await sleep(400);
      // WALK: short hold → accelerate through the walk band, capture live
      setV('right', true);
      for (let i = 0; i < 6; i++) {
        shots['walk-p' + i] = readout();
        window.__qaReadyForShot = 'walk-p' + i;
        const t0 = Date.now();
        while ((window.__qaShotTaken || '') !== window.__qaReadyForShot && Date.now() - t0 < 3000) await sleep(20);
        await sleep(105);
      }
      setV('right', false);
      // DECEL walk: capture the walk band on the way down
      await sleep(80);
      for (let i = 6; i < 10; i++) {
        shots['walk-p' + i] = readout();
        window.__qaReadyForShot = 'walk-p' + i;
        const t0 = Date.now();
        while ((window.__qaShotTaken || '') !== window.__qaReadyForShot && Date.now() - t0 < 3000) await sleep(20);
        await sleep(105);
      }
      window.__qaWalkDone = true;
    } catch (e) { window.__qaWalkErr = String(e && e.stack || e); window.__qaWalkDone = true; }
  })();
})()
