import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const imageDir = join(root, 'apps', 'mobile', 'assets', 'images')
mkdirSync(imageDir, { recursive: true })

// Faceted Diamond Shine mark, matched to the web brand reference.
const BRAND_BG = [238, 238, 249, 255]
const FACETS = [
  { points: [[.18, 0], [.50, 0], [.32, .33], [0, .33]], color: [90, 142, 205, 255] },
  { points: [[.50, 0], [.32, .33], [.68, .33]], color: [147, 221, 246, 255] },
  { points: [[.50, 0], [.82, 0], [1, .33], [.68, .33]], color: [107, 173, 235, 255] },
  { points: [[0, .33], [.32, .33], [.50, 1]], color: [76, 106, 197, 255] },
  { points: [[.32, .33], [.68, .33], [.50, 1]], color: [137, 171, 235, 255] },
  { points: [[.68, .33], [1, .33], [.50, 1]], color: [98, 147, 222, 255] },
]

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 4 + 1)
    rows[offset] = 0
    rgba.copy(rows, offset + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND'),
  ])
}

function insidePolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    const crosses = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function render({ size, scale, background = null, monochrome = false }) {
  const pixels = Buffer.alloc(size * size * 4)
  if (background) {
    for (let i = 0; i < size * size; i += 1) pixels.set(background, i * 4)
  }
  if (!scale) return png(size, size, pixels)

  const width = size * scale
  const height = width * .72
  const x0 = (size - width) / 2
  const y0 = (size - height) / 2
  const outline = [[.18, 0], [.82, 0], [1, .33], [.5, 1], [0, .33]]
  const facets = monochrome ? [{ points: outline, color: [255, 255, 255, 255] }] : FACETS
  const samples = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]]
  const minX = Math.max(0, Math.floor(x0) - 1)
  const maxX = Math.min(size - 1, Math.ceil(x0 + width) + 1)
  const minY = Math.max(0, Math.floor(y0) - 1)
  const maxY = Math.min(size - 1, Math.ceil(y0 + height) + 1)

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const accum = [0, 0, 0, 0]
      let covered = 0
      for (const [sx, sy] of samples) {
        const nx = (x + sx - x0) / width
        const ny = (y + sy - y0) / height
        const facet = facets.find((entry) => insidePolygon(nx, ny, entry.points))
        if (!facet) continue
        covered += 1
        for (let channel = 0; channel < 4; channel += 1) accum[channel] += facet.color[channel]
      }
      if (!covered) continue
      const offset = (y * size + x) * 4
      const alpha = covered / samples.length
      const base = background ?? [0, 0, 0, 0]
      for (let channel = 0; channel < 3; channel += 1) {
        const foreground = accum[channel] / covered
        pixels[offset + channel] = Math.round(foreground * alpha + base[channel] * (1 - alpha))
      }
      pixels[offset + 3] = background ? 255 : Math.round(255 * alpha)
    }
  }
  return png(size, size, pixels)
}

const assets = [
  ['icon.png', { size: 1024, scale: .60, background: BRAND_BG }],
  ['android-icon-foreground.png', { size: 1024, scale: .46 }],
  ['android-icon-background.png', { size: 1024, scale: 0, background: BRAND_BG }],
  ['android-icon-monochrome.png', { size: 1024, scale: .46, monochrome: true }],
  ['favicon.png', { size: 256, scale: .82 }],
  ['splash-icon.png', { size: 1024, scale: .50 }],
]

for (const [name, options] of assets) writeFileSync(join(imageDir, name), render(options))
console.log(`Generated ${assets.length} Diamond Shine mobile brand assets.`)
