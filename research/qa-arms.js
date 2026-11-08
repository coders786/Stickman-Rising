/* QA: ARM FORENSICS v3 — dedicated arms run.
 * Captures live states (idle-safe / idle-threat / walk / run / sprint) at
 * high zoom with full arm telemetry, then flips the inspect view to SHEET
 * for the character sheet capture. Shot handshake: __qaReadyForShot /
 * __qaShotTaken (driver screenshots between them).
 */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });

  // solo inspect view FIRST (light panel, zoom 2.4, skeleton overlay off —
  // we want the pure silhouette read for VLM anatomy analysis)
  window.__srInspect.setView('solo');
  window.__srInspect.showBones = false;
  window.__srInspect.showLabels = false;

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
      animT: +((p.animator.getTime?.() ?? 0) % 10).toFixed(3),
      twoHandW: +(p.twoHandW ?? 0).toFixed(2),
      relaxW: +(p.relaxW ?? 0).toFixed(2),
      ch: {
        shL: deg(pose[11]), elL: deg(pose[12]), wrL: deg(pose[13]),
        shR: deg(pose[14]), elR: deg(pose[15]), wrR: deg(pose[16]),
        armLz: deg(pose[22]), armRz: deg(pose[23]),
        foreLz: deg(pose[26]), foreRz: deg(pose[27]),
        girdle: deg(pose[19]), pelvis: deg(pose[18]),
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
      // depth of joints (z toward camera) — the projection suspects
      z: {
        shL: +gm.shoulderL.z.toFixed(1), elL: +gm.elbL.z.toFixed(1), handL: +gm.handL.z.toFixed(1),
        shR: +gm.shoulderR.z.toFixed(1), elR: +gm.elbR.z.toFixed(1), handR: +gm.handR.z.toFixed(1),
      },
    };
  };

  const recenter = async () => {
    setV('left', false); setV('right', false);
    p.x = 640; p.vx = 0;
    p.action = null; p.state = 'move'; p.charging = false;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    p.face = 1;
    p.swordDrawn = true;
    p.peaceT = 0;
    p.sheathAct = null;
    await sleep(350);
  };

  const shots = (window.__qaArmShots = {});
  const burst = async (prefix, n, iv, hold = false) => {
    for (let i = 0; i < n; i++) {
      const name = prefix + '-p' + i;
      shots[name] = readout();
      window.__qaReadyForShot = name;
      const t0 = Date.now();
      while ((window.__qaShotTaken || '') !== window.__qaReadyForShot && Date.now() - t0 < 3000) await sleep(25);
      await sleep(Math.max(0, iv - (Date.now() - t0)));
      if (hold) {
        // keep the runner centered: teleport back + snap the camera so the
        // arena wall never ends the locomotion burst mid-capture
        p.x = 640;
        g.cam.snapTo(640, -150);
      }
    }
  };

  const A = window.__qaArm = { phase: 'boot', results: {}, errors: window.__qaErr, done: false };

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;

      // ---- 1. SAFE IDLE (relax carry + hang) ----
      A.phase = 'idleSafe';
      await recenter();
      await sleep(900);
      await burst('idleSafe', 5, 500);

      // ---- 2. THREAT IDLE (two-hand grip) ----
      A.phase = 'idleThreat';
      {
        p.swordDrawn = true; p.peaceT = 0; p.sheathAct = null;
        const dummy = { x: p.x + 210, y: 0, dead: false, spawning: false, id: 'qa-dummy' };
        g.enemies.push(dummy);
        await sleep(1000);
        p.swordDrawn = true; p.peaceT = 0;
        await burst('idleThreat', 5, 500);
        g.enemies.length = 0;
        await sleep(400);
      }

      // ---- 3. WALK (partial axis ~ 0.45 → ~155px/s) ----
      A.phase = 'walk';
      await recenter();
      inp.setVirtualAxis(0.45, 0);
      await sleep(900);
      await burst('walk', 8, 140);
      inp.setVirtualAxis(0, 0);
      await sleep(500);

      // ---- 4. RUN (full axis → 350) ----
      A.phase = 'run';
      await recenter();
      setV('right', true);
      await sleep(1100);
      await burst('run', 10, 90, true);
      setV('right', false);
      await sleep(500);

      // ---- 5. SPRINT (latch + full axis → 480) ----
      A.phase = 'sprint';
      await recenter();
      p.sprintLatch = true;
      setV('right', true);
      await sleep(1200);
      await burst('sprint', 10, 70, true);
      setV('right', false);
      p.sprintLatch = false;

      // ---- 5b. SHEATHED IDLE REST (the pommel-rest pose under test) ----
      A.phase = 'sheathRest';
      await recenter();
      p.swordDrawn = false; // force-sheathe: rest pose engages after damping
      p.peaceT = 0;
      await sleep(1400);
      await burst('sheathRest', 3, 600);
      p.swordDrawn = true;

      // ---- 6. CHARACTER SHEET (deterministic contact sheet) ----
      A.phase = 'sheet';
      await sleep(400);
      window.__srInspect.setView('sheet');
      await sleep(200);
      window.__qaReadyForShot = 'charsheet';
      const t0 = Date.now();
      while ((window.__qaShotTaken || '') !== 'charsheet' && Date.now() - t0 < 5000) await sleep(50);
      window.__srInspect.setView('solo');

      A.results = shots;
      A.done = true;
      A.phase = 'done';
    } catch (err) {
      A.errors.push(String(err && err.stack || err));
      A.done = true;
    }
  })();
})();
