import type {Enemy} from '../entities/enemy'
import type {AttackRuntimeInfo} from './attacks'

export type HitOutcome='miss'|'parried'|'blocked'|'guardBreak'|'armored'|'hit'|'killed'
export interface HitResolution {
 readonly targetId:number
 readonly outcome:HitOutcome
 readonly contact:'none'|'body'|'guard'|'armor'
 /** HP actually removed, capped at remaining health (not authored overkill). */
 readonly actualDamage:number
 readonly guardDamage:number
}
export function missedHit(targetId:number):HitResolution{
 return{targetId,outcome:'miss',contact:'none',actualDamage:0,guardDamage:0}
}
export function parriedHit(targetId:number):HitResolution{
 return{targetId,outcome:'parried',contact:'guard',actualDamage:0,guardDamage:0}
}
/** Resolve once. Presentation and reward consumers must not call takeHit again. */
export function resolveEnemyHit(enemy:Enemy,attack:AttackRuntimeInfo,dir:number,fromX:number):HitResolution{
 if(enemy.dead)return missedHit(enemy.id)
 const hp=Math.max(0,enemy.hp),guard=enemy.guardHealth,wasGuarding=enemy.blockUp
 const outcome=enemy.takeHit(attack,dir,fromX)
 const guardDamage=Math.max(0,guard-enemy.guardHealth)
 const guardBreak=wasGuarding&&!enemy.blockUp&&guardDamage>0
 return{targetId:enemy.id,outcome:guardBreak&&outcome==='hit'?'guardBreak':outcome,
  contact:guardDamage>0?'guard':outcome==='armored'?'armor':outcome==='miss'?'none':'body',
  actualDamage:Math.min(hp,Math.max(0,hp-enemy.hp)),guardDamage}
}
/** Chip pressure is not a confirmed strike, even if lethal. Kill rewards are
 * handled separately. Armor takes damage and therefore remains reward-eligible. */
export function rewardsConfirmedHit(result:HitResolution|undefined):boolean{
 return !!result&&result.contact!=='guard'&&result.actualDamage>0&&(result.outcome==='hit'||result.outcome==='guardBreak'
  ||result.outcome==='armored'||result.outcome==='killed')
}
