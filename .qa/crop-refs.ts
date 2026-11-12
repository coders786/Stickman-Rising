import sharp from 'sharp'
async function main() {
  const src = 'research/refs/sheet-composite-4row.png'
  const meta = await sharp(src).metadata()
  console.log('size', meta.width, meta.height)
  const rows = 4
  const h = Math.floor(meta.height! / rows)
  for (let r = 0; r < rows; r++) {
    await sharp(src).extract({ left: 0, top: r * h, width: meta.width!, height: h })
      .resize({ width: 1560 }).png().toFile(`/tmp/i1row${r + 1}.png`)
  }
  console.log('done')
}
main()
