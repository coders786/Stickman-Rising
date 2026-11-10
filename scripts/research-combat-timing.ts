import {writeFileSync} from 'node:fs'
import {ATTACKS} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'
import {SWORDS} from '../src/game/combat/swords'
// Analytical screen only: no collision/reach/AI, no guarantee of a true combo.
const pairs=[['l1','l2'],['l2','l3'],['l3','l4'],['l4','l5'],['l1','h1'],['h1','h2'],['h2','h3']] as const
const rows:{stance:string;weapon:string;from:string;to:string;speed:number;earlyGapMs:number;lateGapMs:number;classification:string}[]=[]
for(const stance of ['sword','unarmed'])for(const sword of Object.values(SWORDS))for(const [a,b] of pairs){
 const prev=stance==='sword'?ATTACKS[a]:unarmedAttack(ATTACKS[a]),next=stance==='sword'?ATTACKS[b]:unarmedAttack(ATTACKS[b])
 const speed=stance==='sword'?sword.stats.spd:1
 const nextContact=(prev.cancel+next.hit.start)/speed
 const stun=Math.max(.18,prev.hit.stagger)
 const earlyGap=nextContact-prev.hit.start/speed-stun
 const lateGap=nextContact-prev.hit.end/speed-stun
 rows.push({stance,weapon:sword.id,from:a,to:b,speed,earlyGapMs:earlyGap*1000,lateGapMs:lateGap*1000,
 classification:lateGap>0?'gap even after late contact':earlyGap>0?'depends on contact timing':'timing permits; reach untested'})
}
const apex=[1350,1900,3250].map(g=>({gravity:g,launch:-640,idealApexPixels:640**2/(2*g),idealTimeToApex:640/g}))
const result={assumptions:'Earliest cancel followed by next startup; symmetric hitstop excluded; no armor, vulnerability, collision, reach, travel, slowed world or moving target. Late-contact bound uses end of active window. Stun floor .18 from Enemy.hit. Not playable combo proof.',rows,apex}
writeFileSync('research/combat-timing-study.json',JSON.stringify(result,null,2)+'\n')
writeFileSync('research/COMBAT_TIMING_STUDY.md','# Analytical timing study\n\n'+result.assumptions+'\n\nPositive gap means the enemy can finish nominal stun before the next contact; negative means only that timing could permit a link. All figures are calculated estimates, not measured gameplay. Unarmed rows repeat across weapons intentionally because its attack playback speed is 1.\n\n| Stance | Weapon | Route | Early-contact gap ms | Late-contact gap ms | Reading |\n|---|---|---|---:|---:|---|\n'+rows.map(r=>`| ${r.stance} | ${r.weapon} | ${r.from}→${r.to} | ${r.earlyGapMs.toFixed(1)} | ${r.lateGapMs.toFixed(1)} | ${r.classification} |`).join('\n')+'\n\n## Gravity sensitivity (ideal ballistic model)\n\n'+apex.map(a=>`- g=${a.gravity}: upward 640 launch → apex ${a.idealApexPixels.toFixed(1)}px at ${a.idealTimeToApex.toFixed(3)}s.`).join('\n')+'\n\nThese ballistic figures ignore floor threshold, changing states, dt discretization and new juggle hits. They illustrate why consolidating duplicate gravity requires retuning, not why any particular gravity is correct.\n')
console.log(rows.filter(r=>r.weapon==='katana'));console.log(apex)
