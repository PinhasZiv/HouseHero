// Generates the PWA icons as real PNG files.
//
// A manifest icon has to be a PNG for Android to use it on the home screen and
// in the notification tray, and pulling in an image library just to draw a
// house-and-star mark would be a heavy dependency for something this simple.
// Node's zlib is enough to write a valid PNG by hand.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encodes RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // 10-12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type; 0 means "none", which keeps
  // the encoder trivial and still compresses well for flat artwork.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PURPLE = [91, 79, 196]
const WHITE = [255, 255, 255]

function mix(base, over, alpha) {
  return base.map((channel, i) => Math.round(channel * (1 - alpha) + over[i] * alpha))
}

/**
 * A little house with a star above the roofline - "hero of the house". Drawn
 * as a roof triangle plus a body rectangle with a door cutout, in a 0-100
 * unit square, with 3x3 supersampling so the edges stay smooth.
 */
function houseCoverage(x, y, size) {
  const unit = size / 100
  const px = x / unit
  const py = y / unit

  // Roof: a triangle from the apex down to the two eaves.
  const apex = { x: 50, y: 22 }
  const eaveY = 52
  if (py >= apex.y && py <= eaveY) {
    const t = (py - apex.y) / (eaveY - apex.y)
    const leftX = apex.x - 34 * t
    const rightX = apex.x + 34 * t
    if (px >= leftX && px <= rightX) return 1
  }

  // Body: a rectangle below the eaves, with a door-shaped gap back to the
  // background so the silhouette does not read as a plain block.
  if (py > eaveY && py <= 82 && px >= 24 && px <= 76) {
    const inDoor = px >= 44 && px <= 56 && py >= 64 && py <= 82
    return inDoor ? 0 : 1
  }

  // A five-pointed star above the roof, for "hero".
  const star = starCoverage(px - 50, py - 10, 9)
  if (star) return 1

  return 0
}

/** 1 inside a 5-pointed star centred at the origin, else 0. */
function starCoverage(x, y, outerRadius) {
  const innerRadius = outerRadius * 0.42
  const angle = Math.atan2(y, x) - -Math.PI / 2 // rotate so a point faces up
  const distance = Math.hypot(x, y)
  const sector = ((angle % (2 * Math.PI)) + 2 * Math.PI) % ((2 * Math.PI) / 5)
  const half = Math.PI / 5
  const t = sector < half ? sector / half : (2 * half - sector) / half
  const edgeRadius = innerRadius + (outerRadius - innerRadius) * (1 - t)
  return distance <= edgeRadius ? 1 : 0
}

function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4)
  const centre = size / 2
  // A maskable icon is cropped to a circle by the launcher, so the artwork has
  // to sit inside the safe zone and the background has to bleed to the edges.
  const bgRadius = maskable ? size : size * 0.5
  const scale = maskable ? 0.72 : 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let mark = 0
      let inside = 0
      // 3x3 supersample for antialiasing.
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3
          const py = y + (sy + 0.5) / 3
          if (Math.hypot(px - centre, py - centre) <= bgRadius) inside++
          const lx = (px - centre) / scale + centre
          const ly = (py - centre) / scale + centre
          mark += houseCoverage(lx, ly, size)
        }
      }

      const at = (y * size + x) * 4
      const bgAlpha = inside / 9
      const [r, g, b] = mix(PURPLE, WHITE, mark / 9)
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = Math.round(bgAlpha * 255)
    }
  }

  return encodePng(size, size, rgba)
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['badge-96.png', 96, { maskable: false }],
]

for (const [name, size, options] of targets) {
  writeFileSync(join(OUT_DIR, name), render(size, options))
  console.log(`wrote ${name} (${size}x${size})`)
}
