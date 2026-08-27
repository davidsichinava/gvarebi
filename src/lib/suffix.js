// Colour for the suffix-family signature map.
//
// Two constraints shape this, and both are measured rather than judged.
//
// 1. The palette this replaced could not be read. Its six pastels sat at OKLCH
//    lightness ~0.90 with chroma ~0.02 — grey, in effect. The worst pair,
//    -dze (#d5dfee) against -uri (#e0dced), differed by ΔE 1.5 in NORMAL colour
//    vision, against a floor of 15. Nobody could tell those two apart, colour
//    vision or not, and every one of the six failed the lightness, chroma and
//    contrast checks too.
//
// 2. A choropleth compares any area with any other, not just neighbours, so the
//    palette has to clear the floors across ALL pairs rather than adjacent ones.
//    That caps a categorical map at three hues plus a neutral "other" — past
//    three, no ordering of the reference ramp clears it.
//
// So: three families carry a hue, everything else is Other. The three are the
// ones the interface already treats as regional markers (see suffix.*.region in
// the locale files) — Western, Eastern, Mingrelian. Which three sit here is an
// editorial choice and free to change: the palette is validated as a set of
// three slots, so reassigning families across those slots needs no re-checking.
//
// The hues are reference categorical slots 1–3. Validated as composited, since
// the signature map paints its fills at 0.9 opacity over the light basemap and
// what a reader sees is #3d83d7 / #eb7545 / #30b584, not the raw hex. At that
// opacity, all-pairs, light surface:
//   lightness PASS · chroma PASS · CVD ΔE 8.8 PASS · normal-vision ΔE 21.8 PASS
//   contrast 2.11–2.38 WARN — below 3:1, so the map owes the reader relief:
//   the table under it names every area and its family in words.
// Change the opacity and this needs re-running, not re-reasoning.
export const FAMILIES = [
  { family: 'dze', color: '#2a78d6' },
  { family: 'shvili', color: '#eb6834' },
  { family: 'ia', color: '#1baf7a' },
]

// Not a categorical slot: a neutral that reads as "not one of the above".
export const OTHER = '#d9d5cd'

const BY_FAMILY = new Map(FAMILIES.map((f) => [f.family, f.color]))

/**
 * Colour for a suffix family. Anything outside the three named slots is Other —
 * including families the data grows later. The previous version returned the
 * same grey for "other" and for "family I have never heard of", which made new
 * families silently indistinguishable from the catch-all instead of visibly
 * part of it.
 */
export const colorOf = (family) => BY_FAMILY.get(family) ?? OTHER

/** Legend rows: the three named families, then Other. Drives the map and the key
 *  from one list so the two cannot drift apart. */
export const legend = [...FAMILIES, { family: 'other', color: OTHER }]

/** True when a family is folded into Other rather than named. */
export const isOther = (family) => !BY_FAMILY.has(family)

/** Locale key for a family. The roll carries far more families than the map can
 *  colour (-ov/-ev/-in, -ian, -ski, -dis/-pulu and a dozen more), and none of
 *  them has a locale entry; they are Other on the map, so they read as Other in
 *  words too rather than rendering a raw key like "suffix.ov/ev/in". */
export const labelKey = (family) => `suffix.${isOther(family) ? 'other' : family}`
