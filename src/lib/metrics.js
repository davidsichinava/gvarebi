// Rates and location quotients are computed here rather than stored, which is
// what keeps the bucket files a third of the size they would otherwise be.

/** Per 1,000 voters in the area. */
export const rate = (count, areaVoters) => (areaVoters > 0 ? (count / areaVoters) * 1000 : null)

/**
 * Location quotient: the surname's share of this area divided by its share of
 * the country. 1 means exactly as common here as everywhere; 6 means six times
 * over-represented. Small areas produce unstable quotients, so callers apply
 * meta.suppression.min_count_for_lq before showing one.
 */
export const lq = (count, areaVoters, natCount, natVoters) =>
  areaVoters > 0 && natCount > 0 ? (count / areaVoters) / (natCount / natVoters) : null

const SRC_FIELD = { voters: { mun: 'mun', dis: 'dis' }, book1997: { mun: 'mun97', dis: null } }

/**
 * One row per area for the current surname and controls.
 * `suppressed` rows carry no numbers at all — they were never published.
 */
export function areaSeries({ record, entry, areas, geo, src, meta }) {
  if (!record) return []
  const minLq = meta.suppression.min_count_for_lq
  const list = areas[geo] ?? []

  const field = SRC_FIELD[src === 'change' ? 'voters' : src]?.[geo]
  if (!field) return []
  const counts = record[field] ?? {}
  const dropped = new Set((record.suppressed?.[field] ?? []).map(Number))

  const natVoters = list.reduce((a, x) => a + x.voters, 0)
  const natCount = Object.values(counts).reduce((a, n) => a + n, 0)

  const counts97 = record.mun97 ?? {}
  const nat97 = Object.values(counts97).reduce((a, n) => a + n, 0)

  return list.map((area) => {
    const suppressed = dropped.has(area.id)
    const count = suppressed ? null : (counts[area.id] ?? 0)
    const row = { area, suppressed, count, rate: null, lq: null, change: null }
    if (suppressed) return row

    row.rate = rate(count, area.voters)
    const q = lq(count, area.voters, natCount, natVoters)
    row.lq = count >= minLq ? q : null

    if (src === 'change') {
      const before = counts97[area.id] ?? null
      const beforeSuppressed = (record.suppressed?.mun97 ?? []).includes(area.id)
      row.before = before
      row.change = before && before > 0 && !beforeSuppressed ? (count - before) / before : null
    }
    return row
  })
}

/** Value the map and legend read, given the active metric. */
export function valueOf(row, metric) {
  if (row.suppressed) return null
  if (metric === 'count') return row.count
  if (metric === 'rate') return row.rate
  if (metric === 'lq') return row.lq
  if (metric === 'change') return row.change
  return null
}

/** Top surnames in one area, and the ones most over-represented there. */
export function areaProfile({ buckets, index, area, geo, meta }) {
  const field = geo === 'dis' ? 'dis' : 'mun'
  const natVoters = meta.totals.voters
  const rows = []
  for (const entry of index.list) {
    const rec = buckets[entry.bucket]?.[entry.ka]
    if (!rec) continue
    const count = rec[field]?.[area.id]
    if (!count) continue
    rows.push({
      entry,
      count,
      rate: rate(count, area.voters),
      lq: count >= meta.suppression.min_count_for_lq
        ? lq(count, area.voters, entry.voters, natVoters) : null,
      before: rec.mun97?.[area.id] ?? null,
    })
  }
  return {
    common: [...rows].sort((a, b) => b.count - a.count),
    distinctive: rows.filter((r) => r.lq != null).sort((a, b) => b.lq - a.lq),
    distinct: rows.length,
  }
}

/** Share of an area's surnames by suffix family, against the national profile. */
export function suffixMix(rows, index) {
  const tally = (pairs) => {
    const t = {}
    let total = 0
    for (const [suffix, n] of pairs) { t[suffix] = (t[suffix] ?? 0) + n; total += n }
    return { t, total }
  }
  const here = tally(rows.map((r) => [r.entry.suffix, r.count]))
  const nat = tally(index.list.map((s) => [s.suffix, s.voters]))
  const families = ['dze', 'shvili', 'ia', 'iani', 'uri', 'other']
  return families.map((f) => ({
    suffix: f,
    share: here.total ? (here.t[f] ?? 0) / here.total : 0,
    national: nat.total ? (nat.t[f] ?? 0) / nat.total : 0,
  })).filter((d) => d.share > 0 || d.national > 0)
}
