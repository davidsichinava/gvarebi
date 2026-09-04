export const num = (n, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const pct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`)

// pct signs its output because it was written for CHANGE, where +3% and -3% are
// different facts. A share is never signed: "+15.2% of that cohort" reads as a
// rise of 15.2 points rather than a share of it.
export const share = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)

// A quotient can be far below 1 as easily as far above it. Fixed to one decimal,
// 0.03 prints as "0.0×", which reads as none rather than as thirty times rarer,
// so anything under 0.1 keeps two.
export const times = (x, d = 1) =>
  (x == null ? '—' : `${x.toFixed(x !== 0 && Math.abs(x) < 0.1 ? Math.max(d, 2) : d)}×`)

export function metricLabel(metric, t) {
  return t(`metric.${metric === 'change' ? 'count' : metric}`)
}

/** Render whichever value the active metric selects. */
export function metricValue(row, metric) {
  if (row.suppressed) return null
  if (metric === 'count') return num(row.count)
  if (metric === 'rate') return num(row.rate, 1)
  if (metric === 'lq') return row.lq == null ? '—' : times(row.lq)
  if (metric === 'change') return pct(row.change)
  return '—'
}
