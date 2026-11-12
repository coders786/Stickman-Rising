/** Which technique from the seven uploaded sheets has NO move in the kit?
 *
 * "Compose these as they are" is a coverage question as much as a timing
 * one: if a sheet shows a move the roster cannot perform, that sheet is not
 * composed. This maps every transcribed technique (research/SPRITE-SHEETS.md
 * section 2) onto the closest existing unarmed def by matching on the
 * STRIKING JOINT and the kind, then reports anything with no home.
 */
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { unarmedAttack } from '../src/game/combat/unarmed'

const defs: any[] = []
const seen = new Set<string>()
for (const id of Object.keys(MOVES)) {
  const a: any = unarmedAttack((ATTACKS as any)[id] ?? (MOVES as any)[id])
  if (!a || seen.has(a.id)) continue
  seen.add(a.id); defs.push(a)
}
const has = (label: string) => defs.some((d) => d.label.toUpperCase().includes(label))

/** technique, which sheet it comes from, and the roster term that would
 *  serve it. Matched case-insensitively against def labels. */
const SHEET: [string, string, string[]][] = [
  // 01-katana-4rows: R1 punches, R2 kicks, R3 run+sweep, R4 draw-slash
  ['lead jab', '01 R1', ['JAB']],
  ['straight cross', '01 R1', ['CROSS']],
  ['hook', '01 R1', ['HOOK']],
  ['mid kick chamber', '01 R2', ['STOP KICK', 'MAE-GERI']],
  ['high roundhouse', '01 R2', ['ROUNDHOUSE']],
  ['run-in', '01 R3', ['TACKLE', 'RAM', 'DASH']],
  ['low sweep', '01 R3', ['SWEEP']],
  ['spinning kick', '01 R3', ['SPINNING']],
  // 04-taekwondo-12
  ['front kick', '04', ['STOP KICK', 'MAE-GERI']],
  ['side kick', '04', ['TIGER SLIDE', 'SIDE']],
  ['high side kick', '04', ['AXE', 'SIDE']],
  ['back kick', '04', ['TORNADO', 'BACK']],
  ['spinning hook kick', '04', ['SPINNING HOOK']],
  // 07-boxing-12
  ['slip', '07', ['SLIP']],
  ['uppercut', '07', ['RISING DRAGON', 'UPPER']],
  ['double hook', '07', ['HOOK']],
  ['bob/weave', '07', ['SLIP', 'SWEEP']],
  // 06-run-thrust
  ['lunge thrust', '06', ['CROSS', 'PIERCE', 'RAM']],
  // 05-lightning-raise
  ['charged overhead raise', '05', ['SHINRA', 'SKY HAMMER', 'HAMMER']],
  // 02/03 duel sheets
  ['slipping counter after contact', '02/03', ['COUNTER', 'SLIP']],
]

console.log('sheet technique                 source   roster home')
let missing = 0
for (const [tech, sheet, terms] of SHEET) {
  const hit = terms.find(has)
  if (!hit) missing++
  console.log(tech.padEnd(31), sheet.padEnd(8), hit ? `YES (${hit})` : '** MISSING **')
}
console.log(`\n${SHEET.length - missing}/${SHEET.length} sheet techniques have a roster move`)
console.log('unarmed defs:', defs.length)
