// The density surface arrives as sparse [cellIndex, value] pairs over a fixed
// grid and is painted here, in the browser. That is what makes the colour ramp,
// the opacity and the normalisation interface controls rather than build-time
// decisions — and it is why nothing precinct-shaped has to ship.

import { heat } from './colors.js'

/**
 * Paint sparse cells into a data URL sized to the grid.
 * Deliberately not upsampled: at ~2 km cells the pixels are the honest
 * resolution of the estimate, and smoothing them would imply precision the
 * suppression rules do not allow.
 */
export function paintKde(cells, grid) {
  const { cols, rows } = grid
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)

  for (const [idx, v] of cells) {
    const t = v / 255
    const [r, g, b] = heat(t)
    const o = idx * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    // fade the tail out rather than ending on a hard edge
    img.data[o + 3] = Math.round(255 * Math.min(1, t * 1.6 + 0.15))
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** MapLibre image-source corner order: NW, NE, SE, SW. */
export function bboxCoordinates([w, s, e, n]) {
  return [[w, n], [e, n], [e, s], [w, s]]
}
