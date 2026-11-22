/** Matched native viaduct bake: construction CPU time and exact atlas pixels.
 * Optional SR_SOURCE points to the frozen control. No readbacks in timings.
 */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

const source = process.env.SR_SOURCE || 'src'
const from = (file: string) => import(pathToFileURL(resolve(source, file)).href)
const { Viaduct } = await from('game/stage/viaduct.ts')
const { moodForSeed } = await from('game/world/mood.ts')
const { ART_GRADES } = await from('game/world/art-grade.ts')
const timeMs: number[] = []
const pixels: Record<string, string> = {}
for (let i = -2; i < 10; i++) {
  const seed = 42 + (i + 2) % 3
  const stores: ReturnType<typeof createCanvas>[] = []
  const before = performance.now()
  new Viaduct(seed, -1174, 4948, moodForSeed(seed), (w: number, h: number) => {
    const c = createCanvas(w, h)
    stores.push(c)
    return { c, g: c.getContext('2d') }
  }, ART_GRADES['deep-noir'].asphalt)
  const elapsed = performance.now() - before
  if (i >= 0) timeMs.push(elapsed)
  if (i >= 0 && !pixels[seed]) {
    const hash = createHash('sha256')
    for (const c of stores) hash.update(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)
    pixels[seed] = hash.digest('hex')
  }
}
console.log(JSON.stringify({ source, timeMs, pixels }, null, 2))
