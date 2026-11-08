/* Diagnostic: measure REAL joint angles from solved geom across states.
 * Computes elbow interior angle (shoulder→elbow→hand), knee interior angle,
 * hip height, torso lean — flags anatomical violations.
 */
(() => {
  const g = window.__sr;
  const p = g.player;
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const D = window.__diag = { samples: [], log: [] };

  const ang = (a, b, c) => { // interior angle at b (radians)
    const u1 = Math.atan2(a.y - b.y, a.x - b.x);
    const u2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(u1 - u2);
    while (d > Math.PI * 2) d -= Math.PI * 2;
    d = Math.min(d, Math.PI * 2 - d);
    return d;
  };

  const sample = (tag) => {
    const gm = p.geom;
    const s = {
      tag, state: p.state, loco: p.loco, vx: Math.round(p.vx), grounded: p.grounded,
      // channels (deg)
      chShR: +(p.pose[14] * 57.3).toFixed(1), chElR: +(p.pose[15] * 57.3).toFixed(1),
      chShL: +(p.pose[11] * 57.3).toFixed(1), chElL: +(p.pose[12] * 57.3).toFixed(1),
      chRootRot: +(p.pose[2] * 57.3).toFixed(1), chSpine: +(p.pose[3] * 57.3).toFixed(1),
      chRootY: +p.pose[1].toFixed(1),
      // solved geometry (world px, y-down; hipY = 0 at hip)
      hipY: Math.round(p.hipY),
      elbInteriorR: +(ang(gm.shoulderR, gm.elbR, gm.handR) * 57.3).toFixed(1),
      elbInteriorL: +(ang(gm.shoulderL, gm.elbL, gm.handL) * 57.3).toFixed(1),
      kneeInteriorR: +(ang(gm.hipPtR, gm.kneeR, gm.ankleR) * 57.3).toFixed(1),
      kneeInteriorL: +(ang(gm.hipPtL, gm.kneeL, gm.ankleL) * 57.3).toFixed(1),
      // elbow cross sign: is elbow above(+) or below(-) shoulder→hand chord
      elbSideR: +(Math.sign((gm.handR.x - gm.shoulderR.x) * (gm.elbR.y - gm.shoulderR.y)
        - (gm.handR.y - gm.shoulderR.y) * (gm.elbR.x - gm.shoulderR.x))).toFixed(0),
      elbSideL: +(Math.sign((gm.handL.x - gm.shoulderL.x) * (gm.elbL.y - gm.shoulderL.y)
        - (gm.handL.y - gm.shoulderL.y) * (gm.elbL.x - gm.shoulderL.x))).toFixed(0),
      // torso lean from vertical: hip→neckTop
      leanDeg: +(Math.atan2(gm.neckTop.x - gm.hip.x, gm.hip.y - gm.neckTop.y) * 57.3 * p.face).toFixed(1),
      // foot contact
      ankleRy: Math.round(p.hipY + 1.32 * gm.ankleR.y), ankleLy: Math.round(p.hipY + 1.32 * gm.ankleL.y),
      toeRy: Math.round(p.hipY + 1.32 * gm.toeR.y), toeLy: Math.round(p.hipY + 1.32 * gm.toeL.y),
    };
    D.samples.push(s);
    return s;
  };

  const run = async () => {
    // settle
    setV('left', false); setV('right', false); setV('up', false); setV('down', false);
    p.x = 640; p.vx = 0; p.state = 'move';
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    await sleep(1200);
    sample('idle1'); await sleep(400); sample('idle2');

    // RUN: hold right
    setV('right', true);
    await sleep(300); sample('runA');
    await sleep(300); sample('runB');
    await sleep(300); sample('runC');
    await sleep(300); sample('runD');
    await sleep(300); sample('runE');

    // STOP: release — watch the settle lean
    setV('right', false);
    await sleep(80); sample('stop+80ms');
    await sleep(150); sample('stop+230ms');
    await sleep(300); sample('stop+530ms');
    await sleep(500); sample('stop+1s');
    await sleep(1000); sample('stop+2s');

    // SPRINT: hold right + shift? check controls — use attack-free sprint via holding right longer
    setV('right', true);
    await sleep(2500); // reach sprint tier
    sample('sprintA'); await sleep(250); sample('sprintB');
    setV('right', false);
    await sleep(600); sample('sprintStop');
    D.log.push('done');
  };
  run();
  return 'diagnostic started';
})()
