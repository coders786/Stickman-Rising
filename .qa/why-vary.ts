/** Why does an attack's cleave depth change with frame rate? Trace which body
 * is missed and at what tick the window opens. */
import { cleave } from './blade-cleave'
for (const id of process.argv.slice(2)) {
  for (const hz of [30, 60, 240]) {
    const r = cleave(id, 5, 26, 0, 1 / hz)
    console.log(id.padEnd(10), `${hz}hz`.padStart(5), `cut ${r.cut}`, `dmg ${r.dmg.join(' ')}`)
  }
}
