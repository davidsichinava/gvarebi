// One sequential ramp for magnitudes, one diverging ramp for anything with a
// meaningful centre (a quotient of 1, a change of 0), and one warm ramp for the
// density surface so it never reads as another choropleth.

export const SEQ = ['#eef1f6', '#ccd7e6', '#a3b8d3', '#7492bb', '#4a6ea8', '#33507d']
export const DIV = ['#a9713f', '#cbb49d', '#e6dccf', '#f1ece4', '#c4d1e2', '#7492bb', '#4a6ea8', '#33507d']
export const HEAT = [[238, 234, 227], [224, 176, 131], [217, 154, 108], [194, 112, 58], [143, 71, 21]]

export const NO_DATA = '#e9e5dd'
export const SUPPRESSED = '#d8d2c7'

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

/** Quantile breaks, so one dominant area does not flatten everything else. */
export function quantileBreaks(values, n) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return []
  return Array.from({ length: n - 1 }, (_, i) => v[Math.floor(((i + 1) / n) * (v.length - 1))])
}

/** Colour scale for the active metric. Returns { color(v), stops } for the legend. */
export function scaleFor(metric, values) {
  // A location quotient is a RATIO, so it diverges in log space: half as common
  // (0.5) is the mirror of twice as common (2), and it can never go below zero.
  // Spreading it linearly around 1 put the legend's low end at 1 - (max - 1) —
  // with a real maximum of 21.2x that reads "-19.2x", a quantity that cannot
  // exist, and squeezes every under-represented area into a twentieth of the
  // ramp so they all paint the same colour. Twelve sample surnames never
  // exceeded 2x, which kept the low end at zero and hid it.
  if (metric === 'lq') {
    const logs = values.filter((v) => v != null && v > 0).map((v) => Math.abs(Math.log(v)))
    const spread = Math.max(...logs, Math.log(2))   // never tighter than 2x either way
    const color = (v) => {
      if (v == null) return NO_DATA
      if (v <= 0) return DIV[0]
      const t = clamp(Math.log(v) / spread, -1, 1)
      return DIV[Math.round(((t + 1) / 2) * (DIV.length - 1))]
    }
    return {
      color,
      stops: DIV.map((c, i) => ({
        color: c,
        value: Math.exp(((i / (DIV.length - 1)) * 2 - 1) * spread),
      })),
      centre: 1,
    }
  }

  // Change is additive, centred on zero, and genuinely symmetric in linear
  // space — a fall of 10 points mirrors a rise of 10 points.
  if (metric === 'change') {
    const centre = 0
    const spread = Math.max(...values.filter((v) => v != null).map((v) => Math.abs(v - centre)), 0.1)
    const color = (v) => {
      if (v == null) return NO_DATA
      const t = clamp((v - centre) / spread, -1, 1)
      return DIV[Math.round(((t + 1) / 2) * (DIV.length - 1))]
    }
    return {
      color,
      stops: DIV.map((c, i) => ({ color: c, value: centre + ((i / (DIV.length - 1)) * 2 - 1) * spread })),
      centre,
    }
  }
  const breaks = quantileBreaks(values, SEQ.length)
  const color = (v) => {
    if (v == null) return NO_DATA
    let i = 0
    while (i < breaks.length && v > breaks[i]) i++
    return SEQ[i]
  }
  return { color, stops: SEQ.map((c, i) => ({ color: c, value: breaks[i - 1] ?? null })), breaks }
}

/** Sample the heat ramp at 0..1. */
export function heat(t) {
  const x = clamp(t, 0, 1) * (HEAT.length - 1)
  const i = Math.floor(x), f = x - i
  const a = HEAT[i], b = HEAT[Math.min(i + 1, HEAT.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
