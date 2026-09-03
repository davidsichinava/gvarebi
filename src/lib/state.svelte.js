// Application state lives in the URL. Every control writes to the hash, and the
// hash is the only source of truth — so any view is a shareable link and the
// back button does what people expect. GitHub Pages has no server-side
// rewrites, which is why this is a hash route rather than a path.
//
// A surname is addressed by its Georgian form, not its transliteration. Across
// the full roll the transliteration is not unique — 1,519 latin strings cover
// 3,054 distinct surnames (აბუთიძე and აბუტიძე both give "abutidze") — so a
// latin route key silently resolves to whichever of them the index saw last.
// The Georgian form is the join key everywhere else in the pipeline; it is the
// only identifier that is actually unique. Percent-encoding makes for a long
// URL, which browsers display decoded anyway.

import { SHOW_1997 } from './features.js'

// Georgian is the default: this is a site about Georgian surnames, read mostly
// in Georgia. English is still the fallback dictionary for anything untranslated
// — see i18n.svelte.js — so the two roles are separate. A URL only carries
// ?lang=en now, when a reader has asked for English.
const DEFAULTS = { geo: 'mun', metric: 'lq', src: 'voters', lang: 'ka' }

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const q = new URLSearchParams(qs || '')
  const seg = path.split('/').filter(Boolean)

  let view = 'home', a = null, b = null
  if (seg[0] === 's') { view = 'surname'; a = decodeURIComponent(seg[1] || '') }
  else if (seg[0] === 'r') {
    view = 'region'
    a = seg[1] || 'mun'
    // /r/mun with no id is the nationwide view, and it is what the tab lands on.
    // An absent or unparseable id has to read as "nothing selected" rather than
    // NaN, which toHash would otherwise write straight back into the URL.
    const id = Number(seg[2])
    b = Number.isFinite(id) ? id : null
  }
  else if (seg[0] === 'explore') view = 'explore'
  else if (seg[0] === 'method') view = 'method'

  const s = { view, a, b }
  for (const k of Object.keys(DEFAULTS)) s[k] = q.get(k) || DEFAULTS[k]

  // A region URL carries its level in the path — /r/dis/79 — but geo was only
  // ever read from the query, so it silently stayed 'mun' and the view looked
  // the id up in the wrong list. District 79 and municipality 79 both exist, so
  // this did not error: /r/dis/79 rendered Batumi city, a different place with
  // the same number. The path wins for region routes.
  if (view === 'region' && (a === 'mun' || a === 'dis')) s.geo = a

  // While the 1997 sources are hidden there is no control that can reach them,
  // but a bookmarked ?src=change link still can. Clamp it here rather than
  // rendering a view whose controls cannot express its own state.
  if (!SHOW_1997 && s.src !== 'voters') s.src = DEFAULTS.src

  // The 1997 book has no precinct detail, so it cannot be shown by district.
  // Rather than silently returning nothing, fall back and let the UI say why.
  if (s.src !== 'voters' && s.geo === 'dis') s.geo = 'mun'
  if (s.src === 'change') s.metric = 'change'
  else if (s.metric === 'change') s.metric = DEFAULTS.metric
  return s
}

function toHash(s) {
  let path = '/'
  if (s.view === 'surname') path = `/s/${encodeURIComponent(s.a)}`
  else if (s.view === 'region') path = s.b == null ? `/r/${s.geo}` : `/r/${s.geo}/${s.b}`
  else if (s.view === 'explore') path = '/explore'
  else if (s.view === 'method') path = '/method'

  const q = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS)) {
    // geo already sits in a region path; repeating it in the query is a second
    // copy of the same fact, and two copies drift.
    if (k === 'geo' && s.view === 'region') continue
    if (s[k] !== DEFAULTS[k]) q.set(k, s[k])
  }
  const qs = q.toString()
  return `#${path}${qs ? '?' + qs : ''}`
}

export const nav = $state(parse())

function adopt(next) { for (const k in next) nav[k] = next[k]; for (const k in nav) if (!(k in next)) delete nav[k] }

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => adopt(parse()))
  if (!location.hash) history.replaceState(null, '', toHash(nav))
}

/** Patch the route. Anything omitted is carried over. */
export function go(patch) {
  const next = { ...$state.snapshot(nav), ...patch }
  const hash = toHash(next)
  if (hash === location.hash) { adopt(parse()); return }
  location.hash = hash
}

export function href(patch) {
  return toHash({ ...$state.snapshot(nav), ...patch })
}
