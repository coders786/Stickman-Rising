import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
const noop=()=>{}
// measure pure advance with NO enemy in the world (so no clamp fires)
function advance(speed:number){
  const input=new Input(),p=new Player(),fx=new FX()
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx,audio:{play:noop},cam:{addTrauma:noop},
    hitEnemy:()=>'miss' as any,enemyStrikePlayer:()=>'miss'} as any
  p.reset(400);p.swordDrawn=false
  const base=unarmedAttack((ATTACKS as any)['l3']) as any
  const def={...base,moveX:speed,moveXAt:0.08,groundDrive:{duration:0.12,acceleration:2400}}
  const x0=p.x;p.startAttack(def,w)
  for(let f=0;f<60;f++){w.time+=1/60;p.update(1/60,w);input.endFrame(1/60)}
  return p.x-x0
}
console.log('speed  advance  advance/speed')
for(const s of [40,60,80,100,120,150,180,200,240]){const a=advance(s)
  console.log(String(s).padStart(5),a.toFixed(1).padStart(8),(a/s).toFixed(3).padStart(13))}
