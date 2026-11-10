// Browser QA: external Playwright/Chromium bundle supplied via SR_BROWSER_TOOLS.
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const tools=createRequire(path.join(process.env.SR_BROWSER_TOOLS||'/home/user/browser-tools','package.json'));
const {chromium:pw}=tools('playwright-core'),chromium=tools('@sparticuz/chromium').default;
(async()=>{const b=await pw.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true});try{
 const page=await b.newPage({viewport:{width:1000,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 console.log('loading');await page.goto(process.env.SR_QA_URL||'http://127.0.0.1:3001',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'ENGAGE',exact:true}).click();
 console.log('engaged');const result=await page.evaluate(()=>{
  const g=window.__sr;cancelAnimationFrame(g.raf);g.autoQuality=false;g.waves.update=()=>{};g.enemies.length=0;g.inspect.draw=()=>{};
  g.applySettings({...g.settings,quality:'high',showFps:false});g.dprTarget=1;g.resize();
  const camera=g.updateCamera.bind(g);g.updateCamera=dt=>{camera(dt);g.cam.zoom=2;g.cam.x=g.player.x+40;g.cam.y=-80};
  let drawTick=0;const draw=g.renderer.draw.bind(g.renderer);g.renderer.draw=(...args)=>{if(drawTick++%4===0||[20,30,108,116,145,210,270,300].includes(drawTick-1))draw(...args)};const frames=[],states=[];g.player.reset(700);g.player.swordDrawn=true;g.player.vx=480;
  g.input.setEnabled(false);g.input.setEnabled(true);
  for(let tick=0;tick<420;tick++){
   if(tick===0)g.input.setVirtual('light',true);if(tick===1)g.input.setVirtual('light',false);
   if(tick===100){g.player.y=-60;g.player.vy=700;g.player.vx=350;g.player.grounded=false}
   if(tick===140)g.input.setVirtual('parry',true);if(tick===141)g.input.setVirtual('parry',false);
   if(tick===170)g.input.setVirtual('dash',true);if(tick===235)g.input.setVirtual('dash',false);
   const old=g.player.vx;g.frame(g.lastFrame+1000/120);cancelAnimationFrame(g.raf);
   const p=g.player;states.push({tick,state:p.state,x:p.x,y:p.y,vx:p.vx,dv:Math.abs(p.vx-old),pitch:p.pose[2],grounded:p.grounded,finite:[p.x,p.y,p.vx,p.vy,...p.pose].every(Number.isFinite),load:p.landingLoad.impulse,parryOpen:p.parryWindowOpen});
   if([20,30,108,116,145,210,270,300].includes(tick))frames.push({tick,data:g.canvas.toDataURL()});
  }
  return{states,frames};
 });
 assert.equal(errors.length,0);assert.ok(result.states.every(s=>s.finite));
 const attack=result.states.filter(s=>s.state==='attack');assert.ok(attack.length>0);assert.ok(Math.max(...attack.map(s=>s.dv))<=65);
 assert.ok(result.states.some(s=>s.tick>100&&s.tick<170&&s.grounded&&s.load>0));
 assert.ok(result.states.some(s=>s.tick>235&&s.y< -5&&s.pitch>1.45));
 assert.ok(result.states.filter(s=>s.state==='dashLoad').every(s=>s.grounded));
 assert.ok(result.states.some(s=>s.tick===140&&s.parryOpen),'parry opens on input');
 const dir=path.join(process.cwd(),'.cache/player-motor-browser');fs.mkdirSync(dir,{recursive:true});for(const f of result.frames)fs.writeFileSync(`${dir}/${f.tick}.png`,Buffer.from(f.data.split(',')[1],'base64'));
 const report={errors,updates:420,simulationHz:120,quality:'high',renderSampling:'every fourth simulation tick plus requested landmarks; not a performance benchmark',parryOpensImmediately:true,allFinite:true,attackMaxDeltaV:Math.max(...attack.map(s=>s.dv)),attackEndX:attack.at(-1).x,landingCaptured:true,dashLoadPlanted:true,chargeReleaseHorizontalFlight:true,screenshots:result.frames.map(f=>`${dir}/${f.tick}.png`)};
 fs.writeFileSync(path.join(process.cwd(),'research/player-motor-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
