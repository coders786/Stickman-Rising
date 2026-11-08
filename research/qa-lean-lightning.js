(() => {
  const g = window.__sr;
  const p = g.player;
  window.__qaErr = [];
  window.addEventListener('error', (e) => { window.__qaErr.push(String(e.message)) });
  const Q = window.__srQA = { lean: {}, bolts: null, chargeBolts: 0, rushBolts: 0, errors: window.__qaErr };
  const inp = g.input;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = (a, ms) => new Promise((res) => { inp.setVirtual(a, true); setTimeout(() => { inp.setVirtual(a, false); res() }, ms || 60) });
  const setV = (a, v) => inp.setVirtual(a, v);

  // QA helper: stretch active bolt lifetimes so screenshots can catch them
  const stretchBolts = (s) => { for (const b of g.fx.lightning.bolts) if (b.active) b.life = Math.max(b.life, s) };

  const shotGate = (name, maxWaitMs = 6000) => new Promise(async (res) => {
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
    await sleep(250);
  };

  const sampleLean = () => ({
    pitch: +(((p.pose[2] + p.pose[3]) * 180) / Math.PI).toFixed(1),
    state: p.state, loco: p.loco, vx: Math.round(p.vx), leanS: +p.dashLeanS.toFixed(3),
    pelvisYaw: +p.pose[18].toFixed(2), chestYaw: +p.pose[19].toFixed(2),
  });
  const collect = async (ms) => {
    const out = [];
    const iv = setInterval(() => out.push(sampleLean()), 40);
    await sleep(ms);
    clearInterval(iv);
    return out;
  };
  const avg = (arr) => arr.reduce((a, b) => a + b.pitch, 0) / Math.max(1, arr.length);
  const peak = (arr) => Math.max(...arr.map((s) => Math.abs(s.pitch)));

  (async () => {
    try {
      g.qaMode = true;
      g.waves.update = () => {};
      g.startRun('thunder');
      await sleep(700);
      g.enemies.length = 0;

      // ---------- RUN (arena-center, no wall) ----------
      await recenter(700);
      setV('right', true);
      await sleep(450);
      const run = await collect(700);
      Q.lean.run = { avg: +avg(run).toFixed(1), peak: +peak(run).toFixed(1), vx: run[run.length - 1].vx, loco: run[3] && run[3].loco };
      setV('right', false);
      await sleep(450);

      // ---------- SPRINT (double-tap latch + hold) ----------
      await recenter(700);
      await tap('right', 90);
      await sleep(70);
      await tap('right', 90);
      setV('right', true);
      await sleep(750); // build toward SPRINT_MAX
      const sprint = await collect(700);
      Q.lean.sprint = {
        avg: +avg(sprint).toFixed(1), peak: +peak(sprint).toFixed(1),
        vx: sprint[sprint.length - 1].vx, loco: sprint[3] && sprint[3].loco,
        pelvisYaw: sprint[3] && sprint[3].pelvisYaw, chestYaw: sprint[3] && sprint[3].chestYaw,
      };
      await shotGate('sprint');
      setV('right', false);
      await sleep(500);

      // ---------- DASH (interval starts BEFORE the press) ----------
      await recenter(700);
      setV('right', true);
      await sleep(300);
      const dashPromise = collect(460);
      await tap('dash', 70);
      const dash = await dashPromise;
      Q.lean.dash = {
        avg: +avg(dash).toFixed(1), peak: +peak(dash).toFixed(1),
        maxLeanS: Math.max(...dash.map((s) => s.leanS)),
        maxVx: Math.max(...dash.map((s) => Math.abs(s.vx))),
        variant: p.dashVariant, state: dash[0] && dash[0].state,
      };
      await shotGate('dash');
      setV('right', false);
      await sleep(700);

      // ---------- THUNDER ON-HIT RAY BOUNCE (stretched bolt for the shot) ----------
      await recenter(700);
      g.enemies.length = 0;
      g.spawnEnemy('grunt', p.x + 95, 1);
      g.spawnEnemy('grunt', p.x + 215, 1);
      g.spawnEnemy('grunt', p.x + 340, 1);
      await sleep(1100);
      for (const e of g.enemies) e.update = () => {};
      const boltSamples = [];
      const boltIv = setInterval(() => { boltSamples.push(g.fx.lightning.count); stretchBolts(2.4) }, 40);
      await tap('light', 60);
      await sleep(200);
      await shotGate('lightning');
      await sleep(500);
      clearInterval(boltIv);
      Q.bolts = {
        max: Math.max(0, ...boltSamples),
        framesWithBolts: boltSamples.filter((n) => n > 0).length,
        enemiesAlive: g.enemies.filter((e) => !e.dead).length,
        hp: g.enemies.map((e) => Math.round(e.hp)),
      };
      await sleep(2200);
      g.enemies.length = 0;

      // ---------- CHARGE TESLA CRAWL ----------
      await recenter(700);
      setV('heavy', true);
      await sleep(900);
      Q.chargeBolts = g.fx.lightning.count;
      await shotGate('charge');
      setV('heavy', false);
      await sleep(1000);

      // ---------- THUNDER RUSH (ability) ----------
      await recenter(700);
      p.energy = 100;
      g.spawnEnemy('grunt', p.x + 130, 1);
      g.spawnEnemy('grunt', p.x + 260, 1);
      g.spawnEnemy('grunt', p.x + 400, 1);
      await sleep(1000);
      for (const e of g.enemies) e.update = () => {};
      const rushBolts = [];
      const rushIv = setInterval(() => { rushBolts.push(g.fx.lightning.count); stretchBolts(2.6) }, 40);
      await tap('ability', 80);
      await sleep(260);
      await shotGate('rush');
      await sleep(400);
      clearInterval(rushIv);
      Q.rushBolts = {
        max: Math.max(0, ...rushBolts),
        framesWithBolts: rushBolts.filter((n) => n > 0).length,
        enemiesAlive: g.enemies.filter((e) => !e.dead).length,
        hp: g.enemies.map((e) => Math.round(e.hp)),
        playerX: Math.round(p.x),
      };
      await sleep(2400);

      window.__qaDone = true;
      window.__qaResult = { ok: true, lean: Q.lean, bolts: Q.bolts, chargeBolts: Q.chargeBolts, rushBolts: Q.rushBolts, errors: Q.errors };
    } catch (err) {
      window.__qaDone = true;
      window.__qaResult = { ok: false, error: String((err && err.stack) || err) };
    }
  })();
})()
