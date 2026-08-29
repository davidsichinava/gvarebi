// Categories for the two categorical maps — the signature map and the top
// surnames map. The suffix map does NOT use this: it takes one family at a time
// straight from suffix.json and paints a quotient ramp, so it shows all nineteen.
//
// Colour alone cannot carry seven classes on a choropleth. Measured, all-pairs,
// which is what a choropleth needs since any area may be compared with any other:
//
//   4 opaque hues                       CVD ΔE 9.2   normal-vision ΔE 16.3   PASS
//   the same 4 at 0.9 over the basemap  CVD ΔE 8.8   normal-vision ΔE 14.9   FAIL
//   7 distinct hues                     CVD ΔE 1.9-5.6  normal 6.9-12.9      FAIL
//   4 hues at two lightness steps       CVD ΔE 3.5-6.7  normal 8.6-12.3      FAIL
//
// (floors: CVD ΔE 8, normal-vision ΔE 15. A normal-vision failure means readers
// with full colour vision cannot separate the pair, which no amount of secondary
// encoding excuses.)
//
// So seven classes come from four hues on two channels: colour and texture.
// Every pair differs by hue, by fill, or by both — -dze and -ian share a blue but
// one is solid and one is hatched. Texture is the secondary encoding the
// measurement demands, not decoration.
//
// The fills paint opaque. The fourth hue only clears the floors when the basemap
// is not mixed into it, and the hatch needs a solid ground to read against.

/**
 * Seven categories, in legend order, then Other.
 *
 * `members` is why this file exists rather than a plain family→colour map:
 * -ia, -ua and -ava are one Mingrelian group HERE, while the suffix map keeps
 * them apart. Grouping belongs to the categorical maps only.
 *
 * Which seven: the leading family across both maps and both levels is one of
 * eleven, but grouped and ranked the head covers almost everything —
 *   districts, most distinctive  shvili 26  dze 13  ov/ev/in 11  ia-group 10  ian 5  ani 3  uri 3
 *   districts, most common       dze 28  shvili 16  ia-group 10  ov/ev/in 9  uri 5  ian 2  ani 2
 * which is 95% and 96% of districts respectively. The tail is ones and twos.
 *
 * Hatching goes to the three least frequent so the busier fill covers the least
 * ground. Colour follows the category, never its rank: a map that happens to
 * lack -uri must not repaint -ani in its place.
 */
export const CATEGORIES = [
  { id: 'dze', color: '#2a78d6', hatch: false, members: ['dze'] },
  { id: 'shvili', color: '#eb6834', hatch: false, members: ['shvili'] },
  { id: 'ia/ua/ava', color: '#1baf7a', hatch: false, members: ['ia', 'ua', 'ava'] },
  { id: 'ov/ev/in', color: '#4a3aa7', hatch: false, members: ['ov/ev/in'] },
  { id: 'ian', color: '#2a78d6', hatch: true, members: ['ian'] },
  { id: 'uri', color: '#eb6834', hatch: true, members: ['uri'] },
  { id: 'ani', color: '#1baf7a', hatch: true, members: ['ani'] },
]

// Not a categorical slot: a neutral that reads as "not one of the above".
export const OTHER = '#d9d5cd'

const BY_MEMBER = new Map()
for (const c of CATEGORIES) for (const m of c.members) BY_MEMBER.set(m, c)

/** The category a family belongs to, or null when it falls through to Other. */
export const categoryOf = (family) => BY_MEMBER.get(family) ?? null

/** Fill colour for a family. Anything uncategorised is Other. */
export const colorOf = (family) => BY_MEMBER.get(family)?.color ?? OTHER

/** Whether a family's areas carry the hatch overlay. */
export const isHatched = (family) => BY_MEMBER.get(family)?.hatch === true

/** True when a family is folded into Other rather than named. */
export const isOther = (family) => !BY_MEMBER.has(family)

/** Legend rows: the seven categories, then Other. Drives the map, the key and
 *  the tables from one list so they cannot drift apart. */
export const legend = [
  ...CATEGORIES.map((c) => ({ family: c.id, color: c.color, hatch: c.hatch })),
  { family: 'other', color: OTHER, hatch: false },
]

/**
 * Display name for a family or a category.
 *
 * The locale names only a handful of endings, so everything else is rendered
 * from its own identifier: "ov/ev/in" becomes "-ov / -ev / -in", and the grouped
 * "ia/ua/ava" becomes "-ia / -ua / -ava" by the same rule — no separate label
 * needed, and no regional claim attached to it. A few families list seven
 * endings; those are cut short rather than allowed to run across the picker.
 */
export function familyLabel(family, translate) {
  return elide(familyLabelFull(family, translate))
}

/**
 * The same name with nothing elided. familyLabel truncates past three endings so
 * a family like chik/chuk/nko/ich/uk/nik/ko does not run across the picker, but
 * the reader still has to be able to find out what the ellipsis hides — this is
 * what goes in the title attribute.
 */
export function familyLabelFull(family, translate) {
  const key = `suffix.${family}`
  const s = translate(key)
  // Resolve from the locale when it names this family, otherwise build the name
  // from the identifier: "ov/ev/in" becomes "-ov / -ev / -in".
  if (s !== key) return s
  return String(family).split('/').map((p) => `-${p}`).join(' / ')
}

// Truncation applies to the RESOLVED name, whichever way it was produced. It
// used to sit in the derived branch only, so the moment every family gained a
// locale entry the seven-ending names stopped being cut and ran across the
// picker again.
function elide(label, keep = 3) {
  const parts = String(label).split(' / ')
  return parts.length > keep ? `${parts.slice(0, keep).join(' / ')} …` : label
}

/** True when familyLabel had to cut the name short. */
export const isTruncated = (family, translate) =>
  translate(`suffix.${family}`) === `suffix.${family}` && String(family).split('/').length > 3
