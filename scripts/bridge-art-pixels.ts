import type { Canvas } from '@napi-rs/canvas'
import sharp from 'sharp'

/** Straight RGBA from the authoring canvas. canvas.data() is premultiplied;
 * reading that as straight alpha would darken the edges of glass and masts. */
export function bridgeArtPixels(canvas: Canvas) {
  const { width, height } = canvas
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
}
