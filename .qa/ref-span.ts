/** Vertical SPAN (head-top → foot-sole) of each reference frame, as a proxy
 * for how much the stance sinks or rises across a move. */
import sharp from 'sharp'
async function span(file: string, row: number, rows: number, cols: number) {
  const { width, height } = await sharp(file).metadata()
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true })
  const rh = Math.floor(height! / rows), cw = Math.floor(width! / cols)
  const out: string[] = []
  let prevMid = NaN
  for (let c = 0; c < cols; c++) {
    let top = 1e9, bot = -1, n = 0, sx = 0
    for (let y = row * rh + 2; y < (row + 1) * rh - 2; y++)
      for (let x = c * cw + 2; x < (c + 1) * cw - 2; x++)
        if (data[y * width! + x] < 90) { if (y < top) top = y; if (y > bot) bot = y; n++; sx += x - c * cw }
    const mid = sx / n
    out.push(`${(bot - top)}${isNaN(prevMid) ? '' : `(${(mid - prevMid).toFixed(0)})`}`)
    prevMid = mid
  }
  return out
}
async function main() {
  const jobs: Array<[string, number, number, number, string]> = [
    ['research/refs/sheet-composite-4row.png', 0, 4, 12, 'composite R1 jab-chain'],
    ['research/refs/sheet-composite-4row.png', 2, 4, 12, 'composite R3 run+kick'],
    ['research/refs/sheet-boxing-12.jpg', 0, 3, 4, 'boxing R1'],
    ['research/refs/sheet-duel-jab-contact.png', 0, 3, 4, 'duel R1'],
  ]
  for (const [f, r, rows, cols, label] of jobs)
    console.log(label.padEnd(22), (await span(f, r, rows, cols)).join(' '))
}
main()
