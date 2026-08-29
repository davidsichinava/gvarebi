// One sequential ramp for magnitudes, one diverging ramp for anything with a
// meaningful centre (a quotient of 1, a change of 0), and one warm ramp for the
// density surface.
//
// The diverging ramp runs cool -> warm: warm is the over-represented end, because
// "hot" reads as more. It used to run the other way, with browns at the low end,
// which put a warm colour on the areas where a surname is RAREST — the opposite
// of what a reader assumes. The density surface is warm too; the two now agree
// rather than contradicting each other, at the cost of the old separation
// between the layers, which the opacity sliders already handle.
// Sequential, for count and per-1,000: one hue, light to dark, so more reads as
// darker. Red rather than the blue it used to be, matching the diverging ramp's
// warm end — the whole site now says warm means more.
//
// Red specifically, not the orange-brown the density surface uses. The obvious
// warm ramp ended at #8a4315 against HEAT's #8f4715, near enough identical, and
// the two layers sit on top of each other on the surname view. At OKLCH hue
// 29-35 against HEAT's 50-82 they stay apart. Lightness falls monotonically
// 0.96 -> 0.43, which is what makes a sequential ramp readable at all.
export const SEQ = ['#fdeeea', '#f8ccc2', '#ee9e91', '#dd6a5c', '#c0392b', '#8e2117']
export const DIV = ['#33507d', '#4a6ea8', '#7492bb', '#c4d1e2', '#f1ece4', '#e6dccf', '#cbb49d', '#a9713f']
export const HEAT = [[238, 234, 227], [224, 176, 131], [217, 154, 108], [194, 112, 58], [143, 71, 21]]

// Four states an area can be in besides carrying a value, and they mean
// different things, so they look different:
//   NO_DATA     no electorate at all — Abkhazia and the Tskhinvali region. The
//               map hatches it, because an absent denominator is not a reading.
//   SUPPRESSED  between 1 and k-1 people; withheld, not absent.
//   ZERO        the area has voters and none of them carry this surname. Cool
//               grey, and deliberately the DARKEST of the four: zero is a
//               finding, not an absence, so it should not fade out. The first
//               attempt was a near-white, which measured ΔE 0.3 from the page
//               background — invisible — and only 4.5 from the swatch above it.
//               This clears every neighbour by at least ΔE 11.8: the paper, the
//               two neutrals, and the pale ends of both ramps.
//   below the quotient floor keeps NO_DATA's colour but stays FLAT — it has a
//   count, just not enough of one to quote a ratio.
export const NO_DATA = '#e9e5dd'
export const SUPPRESSED = '#d8d2c7'
export const ZERO = '#9fadb4'

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
    // The two sides of a quotient get their own spread.
    //
    // A single symmetric spread is tidier in principle — 2x and 0.5x are equal
    // and opposite — but the data is not symmetric, and the legend then claims a
    // range the map never shows. For -ava across the districts the low tail
    // reaches 0.022x, which mirrored to a legend top of 46.1x while the highest
    // district was 7.4x: no area anywhere near the warm end, and half the ramp
    // spent on values that cannot occur. Reading the two sides separately keeps
    // both ends honest and puts the whole ramp to work.
    //
    // Still robust rather than maximal on each side: the 90th percentile, so one
    // freak district cannot flatten the rest. Past it, values clamp to the end
    // colour — which is what an outlier should look like.
    const q = (arr, p) => (arr.length ? arr[Math.floor(p * (arr.length - 1))] : 0)
    const present = values.filter((v) => v != null && v > 0)
    const below = present.filter((v) => v < 1).map((v) => -Math.log(v)).sort((a, b) => a - b)
    const above = present.filter((v) => v > 1).map((v) => Math.log(v)).sort((a, b) => a - b)
    // A floor, so a family that barely varies still gets a readable ramp rather
    // than one where a 1% difference paints the darkest colour.
    const FLOOR = Math.log(1.5)
    const lowSpread = Math.max(q(below, 0.9), FLOOR)
    const highSpread = Math.max(q(above, 0.9), FLOOR)

    const t = (v) => (v < 1 ? -clamp(-Math.log(v) / lowSpread, 0, 1)
                            : clamp(Math.log(v) / highSpread, 0, 1))
    const color = (v) => {
      if (v == null) return NO_DATA
      if (v <= 0) return DIV[0]
      return DIV[Math.round(((t(v) + 1) / 2) * (DIV.length - 1))]
    }
    return {
      color,
      stops: DIV.map((c, i) => {
        const u = (i / (DIV.length - 1)) * 2 - 1
        return { color: c, value: Math.exp(u < 0 ? u * lowSpread : u * highSpread) }
      }),
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
