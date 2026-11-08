/* QA: soak — 20s of random inputs, polling for limit violations, hip
 * collapse, NaN, and elbow inversions. The stability gate. */
(() => {
  const g = window.__sr;
  const p = g.player;
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (a, v) => inp.setVirtual(a, v);
  const D = window.__soak = { frames: 0, violations: 0, hipMin: -999, hipMax: 0, nan: 0, elbowSideFlips: 0, worst: [] };
  const acts = ['left', 'right', 'up', 'light', 'heavy', 'dash', 'jump'];

  const poll = () => {
    if (D.done) return;
    D.frames++;
    if (!Number.isFinite(p.hipY) || !Number.isFinite(p.x)) D.nan++;
    if (p.hipY > D.hipMin) D.hipMin = p.hipY;
    if (p.hipY < D.hipMax) D.hipMax = p.hipY;
    const elR = p.pose[15], elL = p.pose[12], knR = p.pose[9], knL = p.pose[6];
    if (elR > 0.02 || elL > 0.02 || knR > 0.02 || knL > 0.02) {
      D.violations++;
      if (D.worst.length < 8) D.worst.push({ elR: +(elR * 57.3).toFixed(1), elL: +(elL * 57.3).toFixed(1), state: p.state, loco: p.loco });
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  const run = async () => {
    for (let i = 0; i < 26; i++) {
      const a = acts[(Math.random() * acts.length) | 0];
      setV(a, true);
      await sleep(180 + Math.random() * 380);
      setV(a, false);
      await sleep(60 + Math.random() * 200);
    }
    setV('left', false); setV('right', false); setV('up', false);
    await sleep(800);
    D.done = true;
  };
  run();
  return 'soak started';
})()
