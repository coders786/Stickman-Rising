/* QA — GROUND-CONTACT LEG IK + LIGHTING/SHADOW verification.
 * Drives the live game through: idle → walk → run → sprint → dash → jump →
 * land → enemy chase → storm strobe. Samples RENDERED foot positions
 * against the ground line (planted-sole error, digs, floats, stride
 * alternation) and gates screenshots for visual verification. */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const Q = window.__srQA = { contact: {}, air: null, enemies: null, errors: window.__qaErr };
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = (a, ms) => new Promise((res) => { inp.setVirtual(a, true); setTimeout(() => { inp.setVirtual(a, false); res() }, ms || 60) });
  const setV = (a, v) => inp.setVirtual(a, v);
  const freeze = () => g.addSlowmo(0.0, 600);
  const unfreeze = () => { g.slowmoT = 0 };
  const shotGate = (name, maxWaitMs = 9000) => new Promise(async (res) => {
    window.__qaReadyForShot = name;
    window.__qaShotTaken = '';
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs && window.__qaShotTaken !== name) await sleep(60);
    res();
  });
  const recenter = async (x = 700) => {
    setV('left', false); setV('right', false); setV('up', false); setV('down', false);
    p.x = x; p.vx = 0;
    p.action = null; p.state = 'move'; p.charging = false;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    p.face = 1;
    await sleep(300);
  };

  const SCALE = 1.32;
  // player foot sampler — measures the RENDERED sole line vs the ground
  const samplePlayer = (ms) => new Promise((res) => {
    const S = { frames: 0, planted: 0, sumErr: 0, maxErr: 0, digs: 0, maxDig: 0, maxFloat: 0, ff0: p.gait.footfalls, ff: 0, cadence: 0 };
    const iv = setInterval(() => {
      S.frames++;
      S.ff = p.gait.footfalls - S.ff0;
      S.cadence = p.gait.cadence;
      const aL = p.hipY + SCALE * p.geom.ankleL.y;
      const aR = p.hipY + SCALE * p.geom.ankleR.y;
      const tL = p.hipY + SCALE * p.geom.toeL.y;
      const tR = p.hipY + SCALE * p.geom.toeR.y;
      if (p.gaitW > 0.5) {
        const checks = [];
        if (p.gait.footL.planted) checks.push([aL, tL]);
        if (p.gait.footR.planted) checks.push([aR, tR]);
        for (const [a, t] of checks) {
          S.planted++;
          const sole = Math.max(a, t) + 2.6; // visual wedge bottom ≈ joint + 2.6px
          const err = Math.abs(sole);
          S.sumErr += err;
          if (err > S.maxErr) S.maxErr = err;
          if (sole > 2.5) { S.digs++; S.maxDig = Math.max(S.maxDig, sole) }
          if (sole < -3.5) S.maxFloat = Math.min(S.maxFloat, sole);
        }
      }
      if (p.grounded) {
        for (const t of [tL, tR]) if (t > 2.5) S.digs++;
      }
    }, 33);
    setTimeout(() => {
      clearInterval(iv);
      res({
        frames: S.frames, planted: S.planted, footfalls: S.ff, cadence: +S.cadence.toFixed(2),
        avgErr: +(S.sumErr / Math.max(1, S.planted)).toFixed(2), maxErr: +S.maxErr.toFixed(2),
        digs: S.digs, maxDig: +S.maxDig.toFixed(2), maxFloat: +S.maxFloat.toFixed(2),
      });
    }, ms);
  });

  // enemy foot sampler — same measurement across all walking enemies
  const sampleEnemies = (ms) => new Promise((res) => {
    const S = { frames: 0, planted: 0, sumErr: 0, maxErr: 0, digs: 0, maxFloat: 0, movers: 0 };
    const iv = setInterval(() => {
      S.frames++;
      for (const e of g.enemies) {
        if (e.dead || e.spawning || e.kind === 'drone') continue;
        if (Math.abs(e.vx) > 24) S.movers++;
        const s = e.scale;
        const aL = e.hipY + s * e.geom.ankleL.y;
        const aR = e.hipY + s * e.geom.ankleR.y;
        const tL = e.hipY + s * e.geom.toeL.y;
        const tR = e.hipY + s * e.geom.toeR.y;
        if (e.gaitW > 0.5) {
          const checks = [];
          if (e.gait.footL.planted) checks.push([aL, tL]);
          if (e.gait.footR.planted) checks.push([aR, tR]);
          for (const [a, t] of checks) {
            S.planted++;
            const sole = Math.max(a, t) + 1.8;
            const err = Math.abs(sole);
            S.sumErr += err;
            if (err > S.maxErr) S.maxErr = err;
            if (sole > 2.5) S.digs++;
            if (sole < -4) S.maxFloat = Math.min(S.maxFloat, sole);
          }
        } else if (e.y > -0.5) {
          for (const t of [tL, tR]) if (t > 2.5) S.digs++;
        }
      }
    }, 33);
    setTimeout(() => {
      clearInterval(iv);
      res({
        frames: S.frames, planted: S.planted, movers: S.movers,
        avgErr: +(S.sumErr / Math.max(1, S.planted)).toFixed(2), maxErr: +S.maxErr.toFixed(2),
        digs: S.digs, maxFloat: +S.maxFloat.toFixed(2),
      });
    }, ms);
  });

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;

      // ---------- IDLE (stand) ----------
      await recenter(700);
      Q.contact.idle = await samplePlayer(650);
      freeze();
      await shotGate('idle');
      unfreeze();
      await sleep(250);

      // ---------- WALK ----------
      await recenter(700);
      setV('right', true);
      await sleep(320);
      Q.contact.walk = await samplePlayer(650);
      freeze();
      await shotGate('walk');
      unfreeze();
      setV('right', false);
      await sleep(420);

      // ---------- RUN ----------
      await recenter(700);
      setV('right', true);
      await sleep(500);
      Q.contact.run = await samplePlayer(650);
      freeze();
      await shotGate('run');
      unfreeze();
      setV('right', false);
      await sleep(450);

      // ---------- SPRINT ----------
      await recenter(700);
      await tap('right', 90);
      await sleep(70);
      await tap('right', 90);
      setV('right', true);
      await sleep(700);
      Q.contact.sprint = await samplePlayer(600);
      freeze();
      await shotGate('sprint');
      unfreeze();
      setV('right', false);
      await sleep(500);

      // ---------- DASH ----------
      await recenter(700);
      setV('right', true);
      await sleep(280);
      inp.setVirtual('dash', true);
      setTimeout(() => inp.setVirtual('dash', false), 70);
      await sleep(120);
      freeze();
      await shotGate('dash');
      unfreeze();
      setV('right', false);
      await sleep(650);

      // ---------- JUMP (airborne: no ground contact) ----------
      await recenter(700);
      const air = { frames: 0, plantedWhileAir: 0, digsWhileAir: 0, minFootY: 0 };
      const airIv = setInterval(() => {
        if (!p.grounded) {
          air.frames++;
          if (p.gait.footL.planted || p.gait.footR.planted) air.plantedWhileAir++;
          const tL = p.hipY + SCALE * p.geom.toeL.y;
          const tR = p.hipY + SCALE * p.geom.toeR.y;
          if (tL > 0 || tR > 0) air.digsWhileAir++;
          air.minFootY = Math.min(air.minFootY, Math.min(tL, tR));
        }
      }, 33);
      await tap('jump', 80);
      await sleep(300);
      freeze();
      await shotGate('jump');
      unfreeze();
      await sleep(500);
      clearInterval(airIv);
      Q.air = { frames: air.frames, plantedWhileAir: air.plantedWhileAir, digsWhileAir: air.digsWhileAir };

      // ---------- LAND (squash planted) ----------
      await recenter(700);
      await tap('jump', 80);
      await sleep(430);
      for (let i = 0; i < 40 && p.grounded; i++) await sleep(30); // wait for takeoff
      for (let i = 0; i < 60 && !p.grounded; i++) await sleep(30); // wait for landing
      await sleep(90);
      freeze();
      await shotGate('land');
      unfreeze();
      await sleep(300);

      // ---------- ENEMY CHASE (walking enemies) ----------
      await recenter(700);
      g.enemies.length = 0;
      g.spawnEnemy('grunt', p.x + 260, 1);
      g.spawnEnemy('grunt', p.x + 420, 1);
      g.spawnEnemy('heavy', p.x + 600, 1);
      await sleep(400);
      Q.enemies = await sampleEnemies(1100);
      freeze();
      await shotGate('enemygrid');
      unfreeze();
      await sleep(150);
      g.enemies.length = 0;

      // ---------- STORM STROBE (shadows stretch from the key light) ----------
      await recenter(700);
      setV('right', true);
      await sleep(420);
      g.spawnEnemy('grunt', p.x + 300, 1);
      await sleep(260);
      // force a sky strobe from the RIGHT (az +0.8 → shadows lean LEFT)
      g.bg.ltnT = 0.02;
      g.bg.ltnAz = 0.8;
      g.bg.ltnAmp2 = 0.95;
      freeze();
      await shotGate('storm');
      unfreeze();
      g.bg.ltnT = -1;
      setV('right', false);
      g.enemies.length = 0;
      await sleep(300);

      window.__qaDone = true;
      window.__qaResult = { ok: true, contact: Q.contact, air: Q.air, enemies: Q.enemies, errors: Q.errors };
    } catch (err) {
      window.__qaDone = true;
      window.__qaResult = { ok: false, error: String((err && err.stack) || err) };
    }
  })();
})()
