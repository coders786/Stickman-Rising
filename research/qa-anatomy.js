/* QA: anatomy inspection — freeze the player at key animation phases,
 * expose joint readouts, and gate screenshots. Usage:
 *   agent-browser eval "$(cat research/qa-anatomy.js)"  (or paste)
 * Then poll: window.__qaAnat.phase, take screenshot, then call
 *   window.__qaAnat.next()  to advance to the next phase.
 */
(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const tap = (a, ms) => new Promise((res) => { inp.setVirtual(a, true); setTimeout(() => { inp.setVirtual(a, false); res() }, ms || 60) });
  const freeze = () => g.addSlowmo(0.0, 60000);
  const unfreeze = () => { g.slowmoT = 0 };

  const A = window.__qaAnat = {
    phase: 'boot',
    idx: -1,
    jointReadout: null,
    errors: window.__qaErr,
    next: null,
    done: false,
  };

  // ---- joint readout: dump solved joints in WORLD px for pixel forensics ----
  const readJoints = () => {
    const gm = p.geom;
    const cam = g.cam;
    // world→screen helper from the game's own renderer contract:
    // player draws at (p.x - cam.x, p.hipY - cam.y) with SCALE, mirrored by face
    const S = 1.32; // SCALE used by renderer
    const read = (j3) => ({ x: +(j3.x * p.face * S).toFixed(1), y: +(j3.y * S).toFixed(1), z: +j3.z.toFixed(1) });
    return {
      state: p.state, loco: p.loco, face: p.face, vx: Math.round(p.vx), animT: +(p.animator.t || 0).toFixed(3),
      poseShR: +(p.pose[14] * 57.3).toFixed(1), poseElR: +(p.pose[15] * 57.3).toFixed(1),
      poseShL: +(p.pose[11] * 57.3).toFixed(1), poseElL: +(p.pose[12] * 57.3).toFixed(1),
      poseHipL: +(p.pose[5] * 57.3).toFixed(1), poseKneeL: +(p.pose[6] * 57.3).toFixed(1),
      poseHipR: +(p.pose[8] * 57.3).toFixed(1), poseKneeR: +(p.pose[9] * 57.3).toFixed(1),
      pelvisYaw: +(p.pose[18] * 57.3).toFixed(1), chestYaw: +(p.pose[19] * 57.3).toFixed(1),
      armLz: +(p.pose[22] * 57.3).toFixed(1), armRz: +(p.pose[23] * 57.3).toFixed(1),
      hipLz: +(p.pose[20] * 57.3).toFixed(1), hipRz: +(p.pose[21] * 57.3).toFixed(1),
      joints: {
        hip: read(gm.hip), waist: read(gm.waist), chest: read(gm.chest), neckTop: read(gm.neckTop),
        headC: read(gm.headC), shoulderR: read(gm.shoulderR), shoulderL: read(gm.shoulderL),
        elbR: read(gm.elbR), handR: read(gm.handR), elbL: read(gm.elbL), handL: read(gm.handL),
        kneeR: read(gm.kneeR), ankleR: read(gm.ankleR), toeR: read(gm.toeR),
        kneeL: read(gm.kneeL), ankleL: read(gm.ankleL), toeL: read(gm.toeL),
        grip: read(gm.grip), tip: read(gm.tip),
      },
    };
  };

  const recenter = async (x = 640) => {
    setV('left', false); setV('right', false); setV('up', false); setV('down', false);
    p.x = x; p.vx = 0;
    p.action = null; p.state = 'move'; p.charging = false;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    p.face = 1;
    await sleep(300);
  };

  // phases: [name, setup()]
  const phases = [
    ['idle', async () => { await recenter(); await sleep(900); }],
    ['walkA', async () => {
      await recenter(); setV('right', true); await sleep(700);
      freeze(); A.jointReadout = readJoints();
    }],
    ['walkB', async () => {
      unfreeze(); setV('right', true); await sleep(260);
      freeze(); A.jointReadout = readJoints();
    }],
    ['runA', async () => {
      unfreeze(); setV('right', false); await sleep(400);
      await recenter(); setV('right', true); await sleep(600);
      freeze(); A.jointReadout = readJoints();
    }],
    ['runB', async () => {
      unfreeze(); setV('right', true); await sleep(140);
      freeze(); A.jointReadout = readJoints();
    }],
    ['sprintA', async () => {
      unfreeze(); setV('right', false); await sleep(500);
      await recenter(); await tap('right', 90); await sleep(60); await tap('right', 90);
      setV('right', true); await sleep(800);
      freeze(); A.jointReadout = readJoints();
    }],
    ['sprintB', async () => {
      unfreeze(); setV('right', true); await sleep(120);
      freeze(); A.jointReadout = readJoints();
    }],
    ['dash', async () => {
      unfreeze(); setV('right', false); await sleep(600);
      await recenter(); setV('right', true); await sleep(300);
      inp.setVirtual('dash', true);
      setTimeout(() => inp.setVirtual('dash', false), 70);
      await sleep(90);
      freeze(); A.jointReadout = readJoints();
    }],
    ['attackL1', async () => {
      unfreeze(); setV('right', false); await sleep(600);
      await recenter();
      inp.setVirtual('atk1', true);
      setTimeout(() => inp.setVirtual('atk1', false), 70);
      await sleep(140);
      freeze(); A.jointReadout = readJoints();
    }],
    ['attackL2', async () => {
      unfreeze();
      inp.setVirtual('atk1', true);
      setTimeout(() => inp.setVirtual('atk1', false), 70);
      await sleep(150);
      freeze(); A.jointReadout = readJoints();
    }],
  ];

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;
      A.next = async () => {
        A.idx++;
        if (A.idx >= phases.length) { A.done = true; A.phase = 'done'; unfreeze(); return }
        const [name, setup] = phases[A.idx];
        A.phase = name;
        A.jointReadout = null;
        await setup();
        A.phase = name + ':ready';
      };
      await A.next();
    } catch (e) {
      A.errors.push(String(e && e.stack || e));
    }
  })();
})();
