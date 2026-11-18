/** Architectural lighting, painted once into the parallax plate. Each bank of
 * ground-mounted uplights has a lens, a grazing beam, and a reflected vertical
 * seam on the glass. Keep the strongest accents away from the fighting lane. */
export function lightFacade(
  g: CanvasRenderingContext2D,
  x: number,
  base: number,
  w: number,
  h: number,
  index: number,
  gain = 1,
) {
  const top = base - h,
    cold = index % 3 !== 1,
    rgb = cold ? '34,203,255' : '255,91,76',
    edge = index % 2 ? x + w - 15 : x + 15,
    side = index % 2 ? -1 : 1,
    foot = base - 46 - (index % 4) * 14
  g.save()
  g.globalAlpha *= gain
  g.beginPath()
  g.rect(x, top, w, h)
  g.clip()
  g.globalCompositeOperation = 'lighter'
  // A raking flood has most of its energy at the mounting point and a soft
  // lateral cut-off. Stretch a radial kernel vertically and shear it sideways.
  for (let i = 0; i < (cold ? 3 : 2); i++) {
    const sx = edge + side * (8 + i * 21),
      height = h * (0.68 + 0.09 * i)
    g.save()
    g.translate(sx, foot)
    g.transform(1, 0, -side * (0.12 + i * 0.025), 1, 0, 0)
    g.scale(20 + i * 4, height)
    const beam = g.createRadialGradient(0, 0, 0.018, 0, 0, 1)
    beam.addColorStop(0, `rgba(${rgb},.78)`)
    beam.addColorStop(0.17, `rgba(${rgb},.43)`)
    beam.addColorStop(0.58, `rgba(${rgb},.19)`)
    beam.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = beam
    g.fillRect(-1, -1, 2, 1.04)
    g.restore()
    g.fillStyle = `rgba(${rgb},.85)`
    g.fillRect(sx - 3, foot - 1, 7, 2)
  }
  // Segmented crown with a luminous corner return. No animated scanlines.
  g.shadowColor = `rgb(${rgb})`
  g.shadowBlur = 10
  g.lineWidth = 1.6
  g.strokeStyle = `rgba(${rgb},.85)`
  g.beginPath()
  g.moveTo(edge + side * w * 0.37, top + 7)
  g.lineTo(edge + side * 10, top + 7)
  g.lineTo(edge, top + 17)
  g.lineTo(edge, top + h * 0.42)
  g.stroke()
  g.shadowBlur = 0
  for (let y = top + h * 0.47; y < foot - 12; y += 16) {
    g.fillStyle = `rgba(${rgb},.58)`
    g.fillRect(edge - 1, y, 1.6, 8)
  }
  if (index % 3 === 2) {
    // A glazed transfer floor breaks the rhythm of the vertical banks.
    const y = top + h * 0.36,
      length = w * 0.55
    const apron = g.createLinearGradient(0, y - 8, 0, y + 19)
    apron.addColorStop(0, `rgba(${rgb},0)`)
    apron.addColorStop(0.36, `rgba(${rgb},.18)`)
    apron.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = apron
    g.fillRect(x + w * 0.13, y - 8, length, 27)
    for (let u = 0; u < length - 7; u += 11) {
      g.fillStyle = `rgba(${rgb},${0.32 + 0.14 * Math.cos(u * 0.13)})`
      g.fillRect(x + w * 0.13 + u, y, 8, 4)
    }
  }
  // Broken floor plates catch the uplight, giving the wash a surface to graze.
  for (let i = 0; i < 6; i++) {
    const y = foot - 12 - i * 19
    if (y < top + 24) break
    for (let j = 0; j < 5; j++) {
      g.fillStyle = `rgba(${rgb},${(0.34 - i * 0.035) * (1 - j * 0.13)})`
      g.fillRect(edge + side * (16 + j * 10), y, 6, 1.5)
    }
  }
  g.restore()
}
