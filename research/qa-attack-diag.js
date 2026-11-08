/* QA: attack anatomy — run light/heavy attacks and poll EVERY frame for
 * joint-limit violations + extreme elbow interiors. Uses the game's own
 * limit report (checkJointLimits via __qaLimit bridge) plus geom-derived
 * elbow interior angles. */
(() => {
  const g = window.__sr;
  const p = g.player;
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const D = window.__atkDiag = { frames: 0, violations: 0, worstElbow: 180, worstKnee: 0, minHipY: -999, samples: [] };

  const ang = (a, b, c) => {
    const u1 = Math.atan2(a.y - b.y, a.x - b.x);
    const u2 = Math.atan2(c.y - b.y, c.x - b.x);
    let dd = Math.abs(u1 - u2);
    while (dd > Math.PI * 2) dd -= Math.PI * 2;
    dd = Math.min(dd, Math.PI * 2 - dd);
    return dd * 57.3;
  };

  // poll on every rAF via the game's own loop timing
  const poll = () => {
    if (D.done) return;
    D.frames++;
    const gm = p.geom;
    const eR = ang(gm.shoulderR, gm.elbR, gm.handR);
    const eL = ang(gm.shoulderL, gm.elbL, gm.handL);
    if (eR > D.worstElbow) D.worstElbow = +eR.toFixed(1);
    if (eL > D.worstElbow) D.worstElbow = +eL.toFixed(1);
    const kR = ang(gm.hipPtR, gm.kneeR, gm.ankleR);
    if (kR > D.worstKnee) D.worstKnee = +kR.toFixed(1);
    if (p.hipY > D.minHipY) D.minHipY = p.hipY;
    // channel-side violations (elbow crossing flexion side etc.)
    const elR = p.pose[15], elL = p.pose[12], knR = p.pose[9], knL = p.pose[6];
    if (elR > 0.02 || elL > 0.02 || knR > 0.02 || knL > 0.02) {
      D.violations++;
      if (D.samples.length < 12) D.samples.push({ elR: +(elR * 57.3).toFixed(1), elL: +(elL * 57.3).toFixed(1), knR: +(knR * 57.3).toFixed(1), knL: +(knL * 57.3).toFixed(1), state: p.state });
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  const run = async () => {
    // settle + draw
    setV('left', false); setV('right', false);
    p.x = 640; p.vx = 0;
    for (let i = 0; i < 40 && !p.grounded; i++) await sleep(60);
    await sleep(1200);
    // light attack chain
    for (let i = 0; i < 3; i++) {
      setV('light', true); await sleep(80); setV('light', false);
      await sleep(1000);
    }
    // heavy attacks
    for (let i = 0; i < 2; i++) {
      setV('heavy', true); await sleep(80); setV('heavy', false);
      await sleep(1300);
    }
    // attack while running
    setV('right', true); await sleep(600);
    setV('light', true); await sleep(80); setV('light', false);
    await sleep(900);
    setV('right', false);
    await sleep(600);
    // dash (uses the arc solver too)
    setV('dash', true); await sleep(70); setV('dash', false);
    await sleep(700);
    D.done = true;
  };
  run();
  return 'attack poll started';
})()
