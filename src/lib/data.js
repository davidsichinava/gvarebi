// Every fetch is memoised by path, so a bucket pulled for one surname is free
// for the next surname that shares it. Nothing here knows about the UI.

const BASE = `${import.meta.env.BASE_URL}data/`
const cache = new Map()

function json(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`)
      return r.json()
    }))
  }
  return cache.get(path)
}

export const getMeta = () => json('meta.json')
export const getAreas = () => json('areas.json')
export const getGeo = (geo) => json(`geo/${geo}.geo.json`)
export const getAggBucket = (b) => json(`agg/${b}.json`)
export const getKdeBucket = (b) => json(`kde/${b}.json`).catch(() => ({}))
export const getLocale = (lang) => json(`i18n/${lang}.json`)

let indexPromise = null
/** The search index, reshaped once from its column-array form. */
export function getIndex() {
  if (!indexPromise) {
    indexPromise = json('index.json').then(({ columns, rows }) => {
      const at = Object.fromEntries(columns.map((c, i) => [c, i]))
      const list = rows.map((r) => ({
        ka: r[at.ka],
        latin: r[at.latin],
        suffix: r[at.suffix],
        stem: r[at.stem],
        voters: r[at.voters],
        rank: r[at.rank],
        voters1997: r[at.voters_1997],
        rank1997: r[at.rank_1997],
        bucket: r[at.bucket],
      }))
      return { list, byLatin: new Map(list.map((s) => [s.latin, s])), byKa: new Map(list.map((s) => [s.ka, s])) }
    })
  }
  return indexPromise
}

/** Counts for one surname, from its bucket. */
export async function getSurname(entry) {
  const bucket = await getAggBucket(entry.bucket)
  return bucket[entry.ka] ?? null
}

/** Sparse density cells for one surname, or null when it has none. */
export async function getKde(entry) {
  const bucket = await getKdeBucket(entry.bucket)
  return bucket[entry.ka] ?? null
}

/** Prefix-first search over both scripts. Cheap enough to run on every keystroke. */
export function search(index, query, limit = 8) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const starts = [], contains = []
  for (const s of index.list) {
    if (s.latin.startsWith(q) || s.ka.startsWith(q)) starts.push(s)
    else if (s.latin.includes(q) || s.ka.includes(q)) contains.push(s)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}
