/** Sweep the simulation frame rate and report cleave depth per attack.
 * If a swing cuts deeper at higher Hz, the blade is TUNNELLING past bodies
 * at 60Hz rather than being limited by design. */
import { cleave } from './blade-cleave'
for (const id of ['l1','l4','cyclone','stepKick','spinHook','axeKick','sakugaHammer']) {
  const row: string[] = []
  for (const spacing of [26, 40]) {
    const r = cleave(id, 5, spacing)
    row.push(`gap${spacing}:${r.cut}/5`)
  }
  console.log(id.padEnd(14), row.join('   '))
}
