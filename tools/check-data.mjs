// Checks the payload and the metric logic without a browser: the parts a
// headless run cannot verify are the map's pixels, not its arithmetic.
//   node tools/check-data.mjs [dir]
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { areaSeries, areaProfile, lq, rate } from '../src/lib/metrics.js'
import { scaleFor } from '../src/lib/colors.js'
import { CATEGORIES } from '../src/lib/suffix.js'

const DIR = process.argv[2] ?? 'public/data'
const read = (p) => JSON.parse(readFileSync(join(DIR, p), 'utf8'))

let failures = 0
const ok = (cond, label, detail = '') => {
  if (!cond) failures++
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
}

const meta = read('meta.json')
// Hoisted: the profile and suffix sections below assert against it too.
const k = meta.suppression.k
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

// ---------------------------------------------------------------- profiles
console.log('\nprofiles')
for (const geo of ['mun', 'dis']) {
  const prof = read(`profiles/${geo}.json`)
  const ids = areas[geo].map((a) => String(a.id))
  ok(ids.every((id) => prof[id]), `${geo}: every area has a profile`,
     ids.filter((id) => !prof[id]).join(',') || '')

  // The same jsonlite unboxing trap as the suppressed lists: a profile holding
  // exactly one row would ship as [ka, n] rather than [[ka, n]], and .map()
  // over it would iterate the characters of a surname.
  const shapes = Object.values(prof).filter(
    (p) => !Array.isArray(p.common) || !Array.isArray(p.distinctive) ||
           p.common.some((r) => !Array.isArray(r)) || p.distinctive.some((r) => !Array.isArray(r))
  )
  ok(shapes.length === 0, `${geo}: common and distinctive are arrays of rows`, `${shapes.length} malformed`)

  const bad = []
  for (const [id, p] of Object.entries(prof)) {
    for (let i = 1; i < p.common.length; i++) if (p.common[i][1] > p.common[i - 1][1]) bad.push(`${id} common`)
    for (let i = 1; i < p.distinctive.length; i++) if (p.distinctive[i][2] > p.distinctive[i - 1][2]) bad.push(`${id} distinctive`)
  }
  ok(bad.length === 0, `${geo}: rankings are sorted`, [...new Set(bad)].slice(0, 3).join(',') || '')

  const unknown = new Set()
  for (const p of Object.values(prof))
    for (const [ka] of [...p.common, ...p.distinctive]) if (!index.byKa.has(ka)) unknown.add(ka)
  ok(unknown.size === 0, `${geo}: every ranked surname is in the index`, [...unknown].slice(0, 3).join(',') || '')

  const leak = Object.values(prof).some((p) =>
    [...p.common, ...p.distinctive].some(([, n]) => n < k))
  ok(!leak, `${geo}: no profile row is below k=${k}`)
}

// ---------------------------------------------------------------- suffixes
console.log('\nsuffixes')
const suf = read('suffix.json')
ok(Array.isArray(suf.families) && suf.families.length > 0, 'families is a non-empty array',
   `${suf.families?.length ?? 0} families`)
ok(suf.families.every((f) => suf.national[f] > 0), 'every family has a national total')
for (const geo of ['mun', 'dis']) {
  const per = suf[geo]
  ok(areas[geo].every((a) => per[String(a.id)] !== undefined), `${geo}: every area has a suffix tally`)
  const stray = new Set()
  let below = 0
  for (const tally of Object.values(per))
    for (const [fam, n] of Object.entries(tally)) {
      if (!suf.families.includes(fam)) stray.add(fam)
      if (n < k) below++
    }
  ok(stray.size === 0, `${geo}: no family outside the declared list`, [...stray].slice(0, 3).join(',') || '')
  ok(below === 0, `${geo}: no published family cell is below k=${k}`, below ? `${below} cells` : '')
}
// A family total must not exceed the area's electorate, which would mean the
// rollup double-counted a surname across families.
const overflow = []
for (const geo of ['mun', 'dis']) {
  const byId = Object.fromEntries(areas[geo].map((a) => [String(a.id), a.voters]))
  for (const [id, tally] of Object.entries(suf[geo])) {
    const total = Object.values(tally).reduce((a, b) => a + b, 0)
    if (byId[id] && total > byId[id]) overflow.push(`${geo}/${id}`)
  }
}
ok(overflow.length === 0, "no area's families exceed its electorate", overflow.slice(0, 3).join(',') || '')

// The families come from surnames_meta.csv and nowhere else, so a suffix.* label
// must name one of them. Two ways that drifts, both of which happened: a key
// outlives the family it described (suffix.iani, after -iani became -ani), and a
// label keeps describing a merge the data no longer makes (suffix.ia read
// "-ia / -ava" while -ava had become a family in its own right, so -ava appeared
// twice in the picker). English only — the Georgian labels are in Mkhedruli and
// cannot be compared against Latin family identifiers.
const enLocale = read('i18n/en.json')
const labelled = Object.keys(enLocale).filter((key) => key.startsWith('suffix.')).map((key) => key.slice(7))
// The categorical maps group several families under one id ("ia/ua/ava"), so a
// label may legitimately name a category rather than a family. Anything that is
// neither is a leftover.
const groupIds = CATEGORIES.map((c) => c.id)
const orphans = labelled.filter(
  (f) => f !== 'other' && !suf.families.includes(f) && !groupIds.includes(f))
ok(orphans.length === 0, 'every suffix label names a family or a category', orphans.join(',') || '')

// And the reverse: a category the maps paint must have a label of its own.
const unlabelledGroups = groupIds.filter((g) => !labelled.includes(g))
ok(unlabelledGroups.length === 0, 'every map category has a locale entry', unlabelledGroups.join(',') || '')

const merged = labelled.filter((f) => {
  if (f === 'other' || !suf.families.includes(f)) return false
  const parts = String(enLocale[`suffix.${f}`]).split('/').map((x) => x.trim().replace(/^-/, ''))
  return parts.some((part) => part !== f && suf.families.includes(part))
})
ok(merged.length === 0, 'no suffix label absorbs another family', merged.join(',') || '')

// Every family the data carries needs a locale entry, or the interface falls
// back to rendering the raw key ("suffix.ov/ev/in") at the reader.
const unlabelled = suf.families.filter((f) => !labelled.includes(f))
ok(unlabelled.length === 0, 'every family has a locale entry', unlabelled.join(',') || '')

// ---------------------------------------------------------------- suppression
console.log('\nsuppression')
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
// An empty value is a translation waiting to be written; a MISSING key is one
// nobody can write, because nothing tells the translator it exists. Name them.
const awaiting = keys(en).filter((x) => !ka[x])
if (awaiting.length) {
  console.log(`       ${awaiting.length} awaiting Georgian: ${awaiting.slice(0, 5).join(', ')}${awaiting.length > 5 ? `, +${awaiting.length - 5} more` : ''}`)
}
// Two different situations, and only one of them is a fault.
//
// A placeholder in the Georgian that English does not define can never be
// filled, so it renders literally as "{whatever}" — always a mistake, usually a
// typo. A placeholder the Georgian LEAVES OUT is a translator's decision:
// phrasing around it, or stating the value outright. Worth reporting, not worth
// failing over.
const ph = (s) => (String(s).match(/\{(\w+)\}/g) ?? [])
const unknown = keys(ka).filter((x) => ka[x] && ph(ka[x]).some((p) => !ph(en[x]).includes(p)))
ok(unknown.length === 0, 'no Georgian placeholder is undefined in English', unknown.join(', '))
const omitted = keys(ka).filter((x) => ka[x] && ph(en[x]).some((p) => !ph(ka[x]).includes(p)))
if (omitted.length) {
  console.log(`       ${omitted.length} translation(s) drop a placeholder English supplies: ${omitted.join(', ')}`)
}

// ---------------------------------------------------------------- first names
// The names payload is optional: build.R skips the stage when the three input
// marginals are absent, and so does this. What it must never do is pass by
// staying silent on a payload that IS there.
if (existsSync(join(DIR, 'names'))) {
  console.log('\nfirst names')
  const nIdxRaw = read('names/index.json')
  const nat = Object.fromEntries(nIdxRaw.columns.map((c, i) => [c, i]))
  const names = nIdxRaw.rows.map((r) => ({
    ka: r[nat.ka], gender: r[nat.gender], total: r[nat.total],
    rank: r[nat.rank], peak: r[nat.peak_year], bucket: r[nat.bucket],
  }))
  const byName = new Map(names.map((n) => [n.ka, n]))
  const coh = read('names/cohort.json')
  // The series are sharded on the index bucket, so gather them the way the app
  // does rather than expecting one file. Reading every bucket here is the point:
  // the checks below must see all 43,757 series, not the one a reader opened.
  // One pass builds both the series and the name -> bucket map; reading the 256
  // shards twice doubled the runtime of this whole script.
  coh.series = {}
  const bucketOf = new Map()
  for (const f of readdirSync(join(DIR, 'names/cohort'))) {
    const shard = read(`names/cohort/${f}`)
    const b = f.replace('.json', '')
    for (const nm of Object.keys(shard)) bucketOf.set(nm, b)
    Object.assign(coh.series, shard)
  }
  const nsuf = read('names/suffix.json')
  const nArea = { mun: read('names/area/mun.json'), dis: read('names/area/dis.json') }
  const fm = meta.first_names ?? {}
  const GENDERS = ['male', 'female', 'unknown']

  ok(names.length > 0, 'index is non-empty', `${names.length} names`)
  ok(byName.size === names.length, 'names are unique (the route key, as with surnames)',
    `${names.length - byName.size} duplicate(s)`)
  ok(names.every((n) => GENDERS.includes(n.gender)), 'every gender is one of the three published states')
  ok(names.every((n, i) => i === 0 || names[i - 1].total >= n.total), 'index is ordered by total, descending')
  ok(names.every((n, i) => n.rank === i + 1), 'rank matches position')

  const sum = names.reduce((s, n) => s + n.total, 0)
  ok(sum === fm.voters, 'index totals reconcile with meta', `${sum} vs ${fm.voters}`)
  for (const g of GENDERS) {
    const s = names.filter((n) => n.gender === g).reduce((a, n) => a + n.total, 0)
    ok(s === fm.by_gender?.[g], `${g} total matches meta`, `${s} vs ${fm.by_gender?.[g]}`)
  }

  // The roll is from 2012, so no one born after 1994 can be on it, and the nine
  // pre-1900 birth years were folded into 1900 rather than dropped. Both are
  // properties of the source; a year outside them means the stage regressed.
  ok(coh.years.every((y, i) => i === 0 || coh.years[i - 1] < y), 'cohort years are ascending')
  ok(coh.years[0] >= 1900, 'no cohort earlier than 1900 (pre-1900 folded in)', `first ${coh.years[0]}`)
  ok(coh.years.at(-1) <= 1994, 'no cohort later than 1994 (2012 roll)', `last ${coh.years.at(-1)}`)
  ok(names.every((n) => n.peak >= coh.years[0] && n.peak <= coh.years.at(-1)),
    'every peak year falls inside the cohort range')

  const cohSum = GENDERS.reduce((s, g) =>
    s + Object.values(coh.totals[g] ?? {}).reduce((a, b) => a + b, 0), 0)
  ok(cohSum === fm.voters, 'cohort denominators reconcile with the index', `${cohSum} vs ${fm.voters}`)

  const series = Object.entries(coh.series)
  // Buckets are two-digit hex strings, not numbers — the same convention the
  // surname index uses, and the filename of the shard.
  ok(names.every((n) => typeof n.bucket === 'string' && /^[0-9a-f]{2}$/.test(n.bucket)),
    'every name carries a cohort bucket')
  ok(series.every(([nm]) => byName.get(nm).bucket === bucketOf.get(nm)),
    'every series sits in the bucket its index row names')
  ok(series.length === fm.series_names, 'series count matches meta', `${series.length} vs ${fm.series_names}`)
  ok(series.every(([, s]) => Array.isArray(s.y) && Array.isArray(s.n)),
    'series years and counts are arrays, never bare scalars')
  ok(series.every(([, s]) => s.y.length === s.n.length), 'every series has matching year and count arrays')
  ok(series.every(([nm]) => byName.has(nm)), 'every series names a name in the index')
  ok(!fm.k_geographic_only || series.length === names.length,
    'every name has a cohort series (none dropped)', `${series.length} of ${names.length}`)
  ok(series.every(([, s]) => s.y.every((y, i) => i === 0 || s.y[i - 1] < y)),
    'series years are ascending within each name')

  // Privacy. k guards the GEOGRAPHIC marginal and only that one. What protects
  // people is not k on every table but that the marginals are never crossed:
  // name x year carries no place, name x area carries no year. So the assertion
  // differs by table - area cells must clear k, the cohort must be complete.
  if (fm.k_geographic_only) {
    const cells = series.reduce((a, [, sr]) => a + sr.n.reduce((x, y) => x + y, 0), 0)
    ok(cells === fm.voters, 'cohort series are complete, nothing withheld', `${cells} vs ${fm.voters}`)
  } else {
    const cohLeaks = series.filter(([, sr]) => sr.n.some((v) => v < k)).length
    ok(cohLeaks === 0, `no cohort cell below k=${k}`, cohLeaks ? `${cohLeaks} name(s) leak` : '')
  }
  // The invariant the design rests on: nothing published joins a birth year to
  // a place. If a later stage ever emits such a cell, this is what catches it.
  const crossed = series.some(([, sr]) => 'area' in sr) ||
    Object.values(nArea.dis).some((m) => Object.values(m).some((v) => typeof v === 'object'))
  ok(!crossed, 'no published cell joins a birth year to an area')

  for (const geo of ['mun', 'dis']) {
    const ids = new Set(areas[geo].map((a) => a.id))
    const entries = Object.entries(nArea[geo])
    const cells = entries.flatMap(([, m]) => Object.values(m))
    ok(entries.every(([nm]) => byName.has(nm)), `${geo}: every mapped name is in the index`)
    ok(entries.every(([, m]) => Object.keys(m).every((a) => ids.has(Number(a)))),
      `${geo}: every area id exists`)
    ok(cells.every((v) => v >= k), `${geo}: no area cell below k=${k}`)
    // A name cannot out-number the electorate it sits in.
    const voters = Object.fromEntries(areas[geo].map((a) => [a.id, a.voters]))
    const over = entries.flatMap(([nm, m]) =>
      Object.entries(m).filter(([a, v]) => v > voters[a]).map(([a]) => `${nm}@${a}`))
    ok(over.length === 0, `${geo}: no name exceeds its area's electorate`, over.slice(0, 3).join(', '))
  }

  ok(Array.isArray(nsuf.families) && nsuf.families.length > 0, 'suffix cross-tab lists families',
    `${nsuf.families?.length} families`)
  ok(!nsuf.families.includes('NA'), '"NA" was mapped to other, not published as a family')
  const famSet = new Set(nsuf.families)
  const sxEntries = Object.entries(nsuf.by_name)
  ok(sxEntries.every(([nm]) => byName.has(nm)), 'every cross-tabbed name is in the index')
  ok(sxEntries.every(([, m]) => Object.keys(m).every((f) => famSet.has(f))),
    'every cross-tab family is a declared family')
  // Not a geographic table, so under the geography-only policy it carries no k.
  // The cross-tab pairs a first name with a surname FAMILY, one of nineteen -
  // it narrows nobody to a place, and the surname index already publishes every
  // surname singleton by name.
  if (fm.k_geographic_only) {
    const sxSum = sxEntries.reduce((a2, [, m]) => a2 + Object.values(m).reduce((x, y) => x + y, 0), 0)
    ok(sxSum === fm.voters, 'suffix cross-tab is complete', `${sxSum} vs ${fm.voters}`)
  } else {
    ok(sxEntries.flatMap(([, m]) => Object.values(m)).every((v) => v >= k),
      `no suffix cross-tab cell below k=${k}`)
  }

  console.log(`       ${names.length} names · ${series.length} series · ` +
    `${Object.keys(nArea.mun).length} mapped by mun, ${Object.keys(nArea.dis).length} by dis · ` +
    `${sxEntries.length} cross-tabbed`)
  const mapped = Object.keys(nArea.dis).length
  console.log(`       ${(100 * mapped / names.length).toFixed(1)}% of names survive k=${k} in at least one district`)
} else {
  console.log('\nfirst names: no payload, stage skipped')
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`)
process.exit(failures ? 1 : 0)
