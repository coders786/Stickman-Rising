import test from 'node:test'
import assert from 'node:assert/strict'
import {CHARGED_KICK,CHARGED_PUNCH,UNARMED_CHARGE} from '../src/game/combat/unarmed'
import {MOVES} from '../src/game/combat/moveset'

test('charged punch and kick are newly authored clips, not library aliases',()=>{
 assert.notEqual(CHARGED_PUNCH.clip,CHARGED_KICK.clip)
 assert.notEqual(CHARGED_PUNCH.clip,UNARMED_CHARGE)
 assert.notEqual(CHARGED_KICK.clip,UNARMED_CHARGE)
 assert.equal(CHARGED_PUNCH.clip.name,'abc_chargedPunch')
 assert.equal(CHARGED_KICK.clip.name,'abcHuntingHawk')
 // A/B/C/D exposure law: four held drawings, no synthesized in-betweens
 assert.equal(CHARGED_PUNCH.clip.frames.length,4)
 assert.equal(CHARGED_KICK.clip.frames.length,4)
 assert.equal(CHARGED_PUNCH.clip.interpolation,'step')
 assert.equal(CHARGED_KICK.clip.interpolation,'step')
})

test('charged lanes retain hand/foot contact and heavyweight payoff',()=>{
 assert.equal(MOVES.chargedPunch.strikeJoint,'hand')
 assert.equal(MOVES.chargedKick.strikeJoint,'foot')
 assert.ok(MOVES.chargedPunch.hit.heavy&&MOVES.chargedKick.hit.heavy)
 assert.ok(MOVES.chargedPunch.hit.dmg>=38)
 assert.ok(MOVES.chargedKick.hit.dmg>=42)
 assert.ok((MOVES.chargedPunch.hit.launch??0)>0)
})
