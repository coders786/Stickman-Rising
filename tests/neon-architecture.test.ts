import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { lightFacade } from '../src/game/lighting/facade'

test('tower luminaires stay on their facade and alternate cyan and warm banks', () => {
  const render = (index: number) => {
    const g = createCanvas(260, 280).getContext('2d')
    lightFacade(
      g as unknown as CanvasRenderingContext2D,
      20,
      255,
      220,
      220,
      index,
    )
    const data = g.getImageData(0, 0, 260, 280).data
    let red = 0,
      blue = 0
    for (let y = 0; y < 280; y++)
      for (let x = 0; x < 260; x++) {
        const i = 4 * (260 * y + x),
          coverage = data[i + 3] / 255
        if (x < 20 || x >= 240 || y < 35 || y >= 255) assert.equal(coverage, 0)
        red += data[i] * coverage
        blue += data[i + 2] * coverage
      }
    return { red, blue }
  }
  const ice = render(0),
    ember = render(1)
  assert.ok(ice.blue > ice.red * 2 && ember.red > ember.blue * 2)
})
