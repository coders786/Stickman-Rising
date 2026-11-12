/** How much does the fighter ADVANCE across a reference row?
 * Every uploaded sheet shows a stepping fighter; if the silhouette centroid
 * drifts rightward frame-to-frame, the move travels. Measure it, don't guess.
 */
import sharp from 'sharp'
async function rowDrift(file: string, row: number, rows: number, cols: number) {
  const img = sharp(file).greyscale()
  const { width, height } = await img.metadata()
  const { data } = await img.raw().toBuffer({ resolveWithObject: true })
  const rh = Math.floor(height! / rows), cw = Math.floor(width! / cols)
  const out: number[] = []
  for (let c = 0; c < cols; c++) {
    // ink = pixels darker than the page background
    let sx = 0, n = 0, minX = 1e9, maxX = -1
    for (let y = row * rh + 4; y < (row + 1) * rh - 4; y++) {
      for (let x = c * cw + 4; x < (c + 1) * cw - 4; x++) {
        if (data[y * width! + x] < 90) { sx += x - c * cw; n++; if (x - c * cw < minX) minX = x - c * cw; if (x - c * cw > maxX) maxX = x - c * cw }
      }
    }
    out.push(n ? sx / n : NaN)
  }
  return out
}
async function main() {
  const jobs: Array<[string, number, number, number]> = [
    ['research/refs/sheet-composite-4row.png', 0, 4, 12],   // jab chain
    ['research/refs/sheet-composite-4row.png', 2, 4, 12],   // run-in + deep kick
    ['research/refs/sheet-boxing-12.jpg', 0, 3, 4],         // guard/jab
    ['research/refs/sheet-karate-kicks.jpg', 0, 3, 4],      // karate
  ]
  for (const [f, r, rows, cols] of jobs) {
    const d = await rowDrift(f, r, rows, cols)
    const first = d.find((v) => !isNaN(v))!
    const last = [...d].reverse().find((v) => !isNaN(v))!
    console.log(`${f.split('/').pop()} row${r + 1}:`, d.map((v) => isNaN(v) ? '  -' : v.toFixed(0).padStart(3)).join(' '),
      ` drift=${(last - first).toFixed(0)}px over ${cols} frames`)
  }
}
main()
