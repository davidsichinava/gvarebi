export const num = (n, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const pct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`)

export const times = (x, d = 1) => (x == null ? '—' : `${x.toFixed(d)}×`)

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
