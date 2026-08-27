// Cache the basemap for Georgia into public/tiles, so the app needs no network.
//
//   node tools/fetch-tiles.mjs              # z0-11, the default
//   MAXZOOM=12 node tools/fetch-tiles.mjs   # more detail, ~4x the bytes
//
// Tiles outside the Georgia bounding box are never requested, which is what
// keeps this to a few MB rather than the whole planet. The output is gitignored:
// run this once on a fresh clone, then work offline forever.
//
// Esri's World Light Gray Base, not CARTO. CARTO's keyless light_all endpoint
// still answers 200 with a real-looking tile, but every one of them is stamped
// "API KEY REQUIRED" across the middle — a silent failure that only shows up by
// looking at the map. Esri publishes this canvas keyless for use with
// attribution, and grey-canvas is the right style under a choropleth anyway.
//
// The attribution in MapView.svelte is not optional. Keep the two in step.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/tiles')
// Esri addresses tiles as {z}/{row}/{col}, which is {z}/{y}/{x} — the reverse of
// the XYZ order MapLibre uses. Swapping them here is the whole adapter.
const TILE = (z, x, y) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`

// Matches GEORGIA in MapView.svelte, with a margin so panning to the edge of
// the fitted bounds does not run straight off the cached area.
const [W, S, E, N] = [39.4, 40.6, 47.3, 44.0]
const MAXZOOM = Number(process.env.MAXZOOM ?? 11)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6)

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}
const clamp = (v, z) => Math.max(0, Math.min(2 ** z - 1, v))

const jobs = []
for (let z = 0; z <= MAXZOOM; z++) {
  for (let x = clamp(lon2x(W, z), z); x <= clamp(lon2x(E, z), z); x++) {
    // y grows southward, so the north edge is the low index.
    for (let y = clamp(lat2y(N, z), z); y <= clamp(lat2y(S, z), z); y++) jobs.push({ z, x, y })
  }
}
console.log(`${jobs.length} tiles, z0-${MAXZOOM} -> public/tiles`)

let done = 0, skipped = 0, bytes = 0
const failed = []
const worker = async () => {
  for (let job; (job = jobs.pop()); ) {
    const { z, x, y } = job
    const dir = join(OUT, String(z), String(x))
    const file = join(dir, `${y}.jpg`)
    if (existsSync(file)) { skipped++; done++; continue }
    let saved = false
    for (let attempt = 0; attempt < 4 && !saved; attempt++) {
      try {
        const r = await fetch(TILE(z, x, y))
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        // The service is declared MIXED format. Every tile in this bbox comes
        // back JPEG; if that ever changes, stop rather than write a .jpg that
        // is really a PNG and let the server mislabel it.
        const ct = r.headers.get('content-type') ?? ''
        if (!ct.includes('jpeg')) throw new Error(`unexpected content-type ${ct}`)
        const buf = Buffer.from(await r.arrayBuffer())
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, buf)
        bytes += buf.length
        saved = true
      } catch (e) {
        if (attempt === 3) failed.push(`${z}/${x}/${y}: ${e.message}`)
        else await new Promise((ok) => setTimeout(ok, 400 * 2 ** attempt))
      }
    }
    if (++done % 200 === 0) process.stdout.write(`  ${done} tiles\r`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

console.log(`  ${done} tiles (${skipped} already cached), ${(bytes / 1e6).toFixed(1)} MB fetched`)
if (failed.length) {
  console.error(`\n${failed.length} tiles failed. Re-run to fill the gaps — cached tiles are skipped.`)
  for (const f of failed.slice(0, 10)) console.error(`  ${f}`)
  process.exit(1)
}
