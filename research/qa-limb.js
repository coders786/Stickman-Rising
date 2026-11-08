/* QA: LIMB FORENSICS v2 — LIVE burst captures + numeric readouts.
 * The game keeps running (no freeze — freezing pauses the whole loop, so
 * manual clip-time stepping never re-samples). Instead we emit shot
 * requests at a fixed cadence spanning full cycles of idle/walk/run/
 * sprint, buffering the joint readout for each shot name.
 */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });

  // zoom FIRST, then no-op the game loop's per-frame setZoom
  g.cam.setZoom(2.7);
  g.cam.setZoom = () => {};

  const S = 1.32;
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);

  const deg = (r) => +(r * 57.2958).toFixed(1);

  function chain(s, e, h) {
    const v1x = s.x - e.x, v1y = s.y - e.y;
    const v2x = h.x - e.x, v2y = h.y - e.y;
    const ux = e.x - s.x, uy = e.y - s.y;
    const fx = h.x - e.x, fy = h.y - e.y;
    const cross = ux * fy - uy * fx;
    const dot = v1x * v2x + v1y * v2y;
    const interior = Math.acos(Math.max(-1, Math.min(1, dot / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1e-6))));
    return { cross: +cross.toFixed(1), flip: cross < 0, interior: deg(interior) };
  }

  const readout = () => {
    const gm = p.geom;
    const pose = p.pose;
    return {
      state: p.state, loco: p.loco, vx: Math.round(p.vx),
      animT: +((p.animator.time ?? 0) % 10).toFixed(3),
      twoHandW: +(p.twoHandW ?? 0).toFixed(2),
      ch: {
        shL: deg(pose[11]), elL: deg(pose[12]),
        shR: deg(pose[14]), elR: deg(pose[15]),
        wrL: deg(pose[13]), wrR: deg(pose[16]),
        armLz: deg(pose[22]), armRz: deg(pose[23]),
        foreLz: deg(pose[26]), foreRz: deg(pose[27]),
      },
      blade: {
        ang: deg(gm.bladeAngle % 6.2832),
        proj: deg(gm.bladeProjAngle),
        tipZ: +gm.bladeTipZ.toFixed(2),
        handY: +(gm.handR.y).toFixed(1),
        tipY: +(gm.tip.y).toFixed(1),
      },
      elbowL: chain(gm.shoulderL, gm.elbL, gm.handL),
      elbowR: chain(gm.shoulderR, gm.elbR, gm.handR),
    };
  };

  const recenter = async () => {
    setV('left', false); setV('right', false);
    p.x = 640; p.vx = 0;
    p.action = null; p.state = 'move'; p.charging = false;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    p.face = 1;
    // keep the blade OUT: the 3.5s auto-sheathe would otherwise own the
    // idle arms (pommel-rest layer) instead of the grip system under test
    p.swordDrawn = true;
    p.peaceT = 0;
    p.sheathAct = null;
    await sleep(350);
  };

  /** emit burst shots every `iv` ms for `n` shots */
  const shots = (window.__qaLimbShots = {})
  const burst = async (prefix, n, iv) => {
    for (let i = 0; i < n; i++) {
      const name = prefix + '-p' + i
      shots[name] = readout();
      window.__qaReadyForShot = name;
      const t0 = Date.now();
      while ((window.__qaShotTaken || '') !== window.__qaReadyForShot && Date.now() - t0 < 3000) await sleep(25);
      await sleep(Math.max(0, iv - (Date.now() - t0)));
    }
  };

  const A = window.__qaLimb = { phase: 'boot', results: {}, errors: window.__qaErr, done: false };

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;

      // ---- SAFE IDLE burst (relax carry + hang) ----
      await recenter();
      await sleep(600);
      await burst('idleSafe', 4, 450);

      // ---- THREAT IDLE burst (two-hand grip: spawn a dummy threat) ----
      {
        p.swordDrawn = true; p.peaceT = 0; p.sheathAct = null;
        const dummy = { x: p.x + 200, y: 0, dead: false, spawning: false, id: 'qa-dummy' };
        g.enemies.push(dummy);
        await sleep(900);
        p.swordDrawn = true; p.peaceT = 0;
        await burst('idleThreat', 4, 450);
        g.enemies.length = 0;
        await sleep(400);
      }

      // ---- WALK burst (tap-hold short: stays under run threshold) ----
      await recenter();
      setV('right', true);
      await burst('walk', 5, 130);
      setV('right', false);

      // ---- RUN burst ----
      await recenter();
      setV('right', true);
      await sleep(900);
      await burst('run', 6, 90);
      setV('right', false);
      await sleep(300);

      // ---- STOP transient (run → brake → idle): where flips lurk ----
      setV('right', true);
      await sleep(900);
      setV('right', false);
      await burst('stop', 5, 120);
      await sleep(400);

      // ---- SPRINT burst ----
      await recenter();
      setV('right', true); await sleep(120); setV('right', false); await sleep(80);
      setV('right', true);
      await sleep(1300);
      await burst('sprint', 6, 70);
      setV('right', false);

      A.done = true;
      window.__qaReadyForShot = '';
    } catch (e) {
      A.errors.push(String((e && e.stack) || e));
      A.done = true;
    }
  })();
})()
