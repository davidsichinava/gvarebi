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
    // An area with no electorate has no denominator, so nothing can be computed
    // for it — that, and only that, is "no data". A count of zero is a result.
    const noData = !(area.voters > 0)
    const row = {
      area, suppressed, count, noData,
      zero: !suppressed && !noData && count === 0,
      rate: null, lq: null, change: null,
    }
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

/**
 * Order rows by a metric, largest first, placing suppressed rows correctly.
 *
 * A suppressed cell holds between 1 and k-1 people. That is MORE than a true
 * zero and less than anything published, so it belongs between them. The old
 * comparator pushed every suppressed row to the very bottom, below areas where
 * the surname genuinely does not occur — which told the reader the opposite of
 * what the data says.
 */
export function byMetric(pick) {
  // Two tiers, and which tier a row lands in is the whole trick.
  //
  //   tier 1  the row has a real reading for this metric
  //   tier 0  it does not — ranked by headcount instead, because that is the
  //           only thing left to compare, and it is what the reader means
  //
  // A withheld cell holds 1 to k-1 people, so it sits at half a person: above an
  // empty area, below any published one. An empty area is a zero regardless of
  // metric, which is why it drops to tier 0 even under "count", where 0 is
  // technically a value — otherwise it would outrank the withheld cells above it.
  //
  // Under "concentration" tier 0 is most of the table: a quotient is null for a
  // withheld cell, for an empty area, and for every area under the {min_count}
  // floor. Ranking that tail by headcount is what puts 40 people above 7 above
  // "fewer than 5" above none.
  const rank = (r) => {
    const v = r.suppressed || r.zero ? null : pick(r)
    if (v != null) return [1, v]
    if (r.suppressed) return [0, 0.5]
    return [0, r.zero ? 0 : (r.count ?? -1)]
  }
  return (a, b) => {
    const [at, av] = rank(a)
    const [bt, bv] = rank(b)
    if (at !== bt) return bt - at
    return bv === av ? 0 : bv - av
  }
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
/**
 * Share of an area's voters by suffix family, against the national share.
 *
 * Takes the precomputed per-area tallies from suffix.json rather than a list of
 * surnames: the family list used to be hardcoded to six, which silently dropped
 * thirteen of the nineteen families the roll actually carries — an area whose
 * commonest ending is -ov/-ev/-in showed an almost empty bar. Families beyond
 * `top` are folded into "other" so the bar stays readable.
 */
export function suffixMix(here, national, top = 6) {
  const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0)
  const hereTotal = sum(here), natTotal = sum(national)
  if (!hereTotal) return []
  const ranked = Object.entries(here).sort((a, b) => b[1] - a[1])
  const named = ranked.slice(0, top)
  const restHere = ranked.slice(top).reduce((a, [, n]) => a + n, 0)
  const restNat = Object.entries(national ?? {})
    .filter(([f]) => !named.some(([g]) => g === f))
    .reduce((a, [, n]) => a + n, 0)
  const out = named.map(([suffix, n]) => ({
    suffix,
    share: n / hereTotal,
    national: natTotal ? (national?.[suffix] ?? 0) / natTotal : 0,
  }))
  if (restHere > 0) {
    out.push({ suffix: 'other', share: restHere / hereTotal, national: natTotal ? restNat / natTotal : 0 })
  }
  return out
}

