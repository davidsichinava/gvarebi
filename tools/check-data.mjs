// Checks the payload and the metric logic without a browser: the parts a
// headless run cannot verify are the map's pixels, not its arithmetic.
//   node tools/check-data.mjs [dir]
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { areaSeries, areaProfile, lq, rate } from '../src/lib/metrics.js'
import { scaleFor } from '../src/lib/colors.js'

const DIR = process.argv[2] ?? 'public/data'
const read = (p) => JSON.parse(readFileSync(join(DIR, p), 'utf8'))

let failures = 0
const ok = (cond, label, detail = '') => {
  if (!cond) failures++
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

const meta = read('meta.json')
const areas = read('areas.json')
const idxRaw = read('index.json')
const at = Object.fromEntries(idxRaw.columns.map((c, i) => [c, i]))
const list = idxRaw.rows.map((r) => ({
  ka: r[at.ka], latin: r[at.latin], suffix: r[at.suffix], stem: r[at.stem],
  voters: r[at.voters], rank: r[at.rank], voters1997: r[at.voters_1997],
  rank1997: r[at.rank_1997], bucket: r[at.bucket],
}))
const index = { list, byLatin: new Map(list.map((s) => [s.latin, s])), byKa: new Map(list.map((s) => [s.ka, s])) }
const buckets = Object.fromEntries(
  readdirSync(join(DIR, 'agg')).map((f) => [f.replace('.json', ''), read(`agg/${f}`)])
)

console.log(`\npayload: ${list.length} surnames · ${areas.mun.length} mun · ${areas.dis.length} dis\n`)

// ---------------------------------------------------------------- integrity
console.log('integrity')
ok(list.every((s) => buckets[s.bucket]?.[s.ka]), 'every indexed surname resolves in its bucket')
// The Georgian form is the route key and the join key everywhere in the
// pipeline, so this is the uniqueness that has to hold. Transliterations are
// deliberately NOT asserted unique: across the full roll 1,519 latin strings
// cover 3,054 distinct surnames, which is why the URL carries the Georgian.
ok(new Set(list.map((s) => s.ka)).size === list.length, 'surnames are unique (they are the route key)')
const latinDupes = list.length - new Set(list.map((s) => s.latin)).size
if (latinDupes) console.log(`       ${latinDupes} surnames share a transliteration — expected; URLs use the Georgian form`)
for (const geo of ['mun', 'dis']) {
  const gj = read(`geo/${geo}.geo.json`)
  const codes = new Set(areas[geo].map((a) => a.code))

  // properties.code is the join, not the top-level `id`. MapView declares
  // promoteId:'code', and maplibre resolves a feature id as
  // `promoteId ? feature.properties[promoteId] : feature.id` — so with promoteId
  // set, a top-level id is never consulted. Checking it would fail exports that
  // work perfectly well, which is the opposite of useful.
  const noCode = gj.features.filter((f) => !f.properties?.code)
  ok(noCode.length === 0, `${geo}: every feature carries properties.code`, `${noCode.length} without`)
  const feat = new Set(gj.features.map((f) => f.properties?.code))
  ok(feat.size === gj.features.length, `${geo}: feature codes unique`,
     `${gj.features.length - feat.size} duplicated`)
  ok([...codes].every((c) => feat.has(c)), `${geo}: every area has geometry`,
     [...codes].filter((c) => !feat.has(c)).join(',') || '')
  ok([...feat].every((c) => codes.has(c)), `${geo}: no orphan geometry`,
     [...feat].filter((c) => !codes.has(c)).join(',') || '')

  // A fill layer draws nothing on a point. Centroids in place of boundaries
  // load without error, pass every join check above, and render an empty map —
  // so the geometry type is worth asserting rather than assuming.
  const notArea = gj.features.filter(
    (f) => f.geometry?.type !== 'Polygon' && f.geometry?.type !== 'MultiPolygon'
  )
  ok(notArea.length === 0, `${geo}: geometry is polygonal, not points`,
     notArea.length ? `${notArea.length} of ${gj.features.length} are ${[...new Set(notArea.map((f) => f.geometry?.type))].join('/')}` : '')

  // Tooltips read these straight off the feature; the app has no fallback to
  // areas.json for them, so a blank name renders as an empty popup.
  const noName = gj.features.filter((f) => !f.properties?.name_ka || !f.properties?.name_en)
  ok(noName.length === 0, `${geo}: every feature has name_ka and name_en`,
     noName.slice(0, 4).map((f) => f.properties?.code).join(',') || '')
}
// Zero is legitimate: Abkhazia and the Tskhinvali region are real areas with no
// electorate. rate() and lq() already return null rather than Infinity for a
// zero denominator, so they read as "no data". Missing is still wrong.
ok(areas.mun.every((a) => a.voters != null && a.voters >= 0), 'every area has a denominator')
const zeroDen = areas.mun.filter((a) => a.voters === 0)
if (zeroDen.length) console.log(`       ${zeroDen.length} area(s) with no electorate: ${zeroDen.map((a) => a.name_en).join(', ')}`)

// ---------------------------------------------------------------- suppression
console.log('\nsuppression')
const k = meta.suppression.k
let leaks = 0, suppressedCells = 0, shapeBad = 0
for (const [, payload] of Object.entries(buckets)) {
  for (const [, rec] of Object.entries(payload)) {
    for (const field of ['mun', 'dis', 'mun97']) {
      for (const v of Object.values(rec[field] ?? {})) if (v < k) leaks++
      const supp = rec.suppressed?.[field]
      if (supp !== undefined && !Array.isArray(supp)) shapeBad++
      suppressedCells += (Array.isArray(supp) ? supp : supp === undefined ? [] : [supp]).length
    }
  }
}
ok(leaks === 0, `no published cell is below k=${k}`, leaks ? `${leaks} leaks` : '')
// A one-element list that jsonlite unboxed into a scalar reaches the app as a
// number, and metrics.js calls .map() on it. Shape, not just content.
ok(shapeBad === 0, 'every suppressed field is an array, never a bare value',
   shapeBad ? `${shapeBad} unboxed to a scalar` : '')
ok(suppressedCells > 0, 'suppression actually fires on this data', `${suppressedCells} cells withheld`)
// Any indexed surname will do; the first one is guaranteed to exist.
const fixture = list[0]
const anyRec = buckets[fixture.bucket][fixture.ka]
ok(
  (anyRec.suppressed.mun ?? []).every((id) => !(id in anyRec.mun)),
  'a suppressed area never also carries a count'
)

// ---------------------------------------------------------------- metrics
console.log('\nmetrics')
ok(Math.abs(rate(50, 1000) - 50) < 1e-9, 'rate is per 1,000')
ok(Math.abs(lq(100, 1000, 1000, 100000) - 10) < 1e-9, 'location quotient: 10% local vs 1% national = 10×')
ok(lq(0, 1000, 1000, 100000) === 0, 'zero count gives a quotient of zero, not NaN')
ok(lq(10, 0, 1000, 100000) === null, 'a zero denominator gives null rather than Infinity')

const entry = fixture
const record = buckets[entry.bucket][entry.ka]
for (const [src, geo] of [['voters', 'mun'], ['voters', 'dis'], ['book1997', 'mun'], ['change', 'mun']]) {
  const rows = areaSeries({ record, entry, areas, geo, src, meta })
  ok(rows.length === areas[geo].length, `${src}/${geo}: one row per area`, `${rows.length}`)
  ok(rows.some((r) => r.suppressed) || src !== 'voters', `${src}/${geo}: suppressed rows survive into the series`)
  ok(rows.filter((r) => !r.suppressed).every((r) => r.count >= 0), `${src}/${geo}: no negative counts`)
}
ok(areaSeries({ record, entry, areas, geo: 'dis', src: 'book1997', meta }).length === 0,
   'the 1997 book yields nothing by district, as it must')

const munRows = areaSeries({ record, entry, areas, geo: 'mun', src: 'voters', meta })
const small = munRows.filter((r) => !r.suppressed && r.count < meta.suppression.min_count_for_lq)
ok(small.every((r) => r.lq === null), `counts below ${meta.suppression.min_count_for_lq} get no quotient`)

// district totals must reconcile with municipal totals
const disRows = areaSeries({ record, entry, areas, geo: 'dis', src: 'voters', meta })
const sum = (rs) => rs.filter((r) => !r.suppressed).reduce((a, r) => a + r.count, 0)
ok(Math.abs(sum(munRows) - sum(disRows)) / sum(munRows) < 0.02,
   'municipal and district totals agree within 2%', `${sum(munRows)} vs ${sum(disRows)}`)

// ---------------------------------------------------------------- scales
console.log('\nscales')
for (const metric of ['count', 'rate', 'lq']) {
  const values = munRows.map((r) => (metric === 'count' ? r.count : metric === 'rate' ? r.rate : r.lq))
  const s = scaleFor(metric, values)
  ok(typeof s.color(values.find((v) => v != null)) === 'string', `${metric}: scale returns a colour`)
  ok(s.color(null) !== undefined, `${metric}: null maps to the no-data colour`)
  const expr = ['match', ['get', 'code']]
  for (const r of munRows) expr.push(r.area.code, s.color(r.value ?? null))
  expr.push('#e9e5dd')
  ok(expr.length === munRows.length * 2 + 3, `${metric}: match expression is well formed`, `${expr.length} items`)
}

// ---------------------------------------------------------------- region view
console.log('\nregion profile')
const area = areas.mun.find((a) => a.name_en === 'Kharagauli') ?? areas.mun[0]
const profile = areaProfile({ buckets, index, area, geo: 'mun', meta })
ok(profile.common.length > 0, `${area.name_en}: has surnames`, `${profile.common.length}`)
ok(profile.common[0].count >= profile.common.at(-1).count, 'most common is sorted by count')
ok(profile.distinctive.every((r, i, a) => i === 0 || a[i - 1].lq >= r.lq), 'most distinctive is sorted by quotient')
ok(profile.distinctive[0].lq > 1, 'the top distinctive surname is over-represented',
   `${profile.distinctive[0].entry.ka} ${profile.distinctive[0].lq.toFixed(1)}×`)

// ---------------------------------------------------------------- kde
console.log('\ndensity grids')
const g = meta.kde.grid
let cells = 0, oob = 0, badVal = 0, withKde = 0
for (const s of list) {
  const f = join(DIR, 'kde', `${s.bucket}.json`)
  if (!existsSync(f)) continue
  const arr = read(`kde/${s.bucket}.json`)[s.ka]
  if (!arr) continue
  withKde++
  for (const [i, v] of arr) {
    cells++
    if (i < 0 || i >= g.cols * g.rows) oob++
    if (v < 1 || v > 255) badVal++
  }
}
ok(withKde > 0, 'surnames have density grids', `${withKde}/${list.length}`)
ok(oob === 0, `every cell index is inside the ${g.cols}×${g.rows} grid`, oob ? `${oob} out of bounds` : '')
ok(badVal === 0, 'every value is a uint8 in 1..255')
ok(g.bbox[0] < g.bbox[2] && g.bbox[1] < g.bbox[3], 'grid bbox is west,south,east,north')
console.log(`       ${cells} cells across ${withKde} surnames, ${(cells / withKde).toFixed(0)} avg`)

// ---------------------------------------------------------------- i18n
console.log('\ntranslations')
const en = read('i18n/en.json'), ka = read('i18n/ka.json')
const keys = (o) => Object.keys(o).filter((x) => x !== '_meta')
ok(keys(en).length === keys(ka).length, 'key sets are the same size')
ok(keys(en).every((x) => x in ka), 'every English key exists in Georgian')
ok(keys(ka).every((x) => x in en), 'no Georgian key is missing from English')
ok(keys(en).every((x) => typeof en[x] === 'string' && en[x]), 'English has no empty values')
const filled = keys(ka).filter((x) => ka[x]).length
console.log(`       ${filled}/${keys(ka).length} Georgian keys filled; the rest fall back to English`)
const ph = (s) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',')
const mismatched = keys(ka).filter((x) => ka[x] && ph(ka[x]) !== ph(en[x]))
ok(mismatched.length === 0, 'placeholders match between locales', mismatched.join(', '))

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`)
process.exit(failures ? 1 : 0)
