# Data contract

Three groups, not two. **`data/input/`** is the CSVs you hand the build script — tidy,
UTF-8, no BOM. **`public/data/`** is what the app fetches: mostly generated, but the
boundaries and the translations are yours to write and the build script never touches
them. The sample files here are fabricated but internally consistent: point the front end
at them and it works, then swap in real data without touching a line of app code.

```
data/input/                    ← you produce these
  areas.csv
  precincts.csv
  voters_surname_precinct.csv
  book1997_surname_area.csv
  surnames_meta.csv            (optional)

public/data/
  meta.json                    ← build/build.R writes these
  areas.json
  index.json
  agg/<bucket>.json
  kde/<bucket>.json            (dev)  →  kde/kde.bin + offsets.bin (prod)

  geo/mun.geo.json             ← you produce these too; build.R does not
  geo/dis.geo.json
  i18n/en.json, ka.json
```

The basemap is not part of this payload at all: `npm run tiles` caches it into
`public/tiles/`, which is gitignored and derived. See the root README.

Two invariants hold everywhere: **surnames are the join key**, in Georgian script, exactly
as they appear in `surnames_meta.csv`; and **area ids are integers unique within a level**,
never reused between `mun` and `dis`.

---

## input/areas.csv

One row per area, both levels in the same long table.

| column | type | notes |
|---|---|---|
| `level` | `mun` \| `dis` | `mun` = municipality (Tbilisi is one row). `dis` = electoral district (Tbilisi is ten rows). |
| `area_id` | int | Unique within its level. |
| `code` | string | Your own stable identifier. Must match the `id` property on the TopoJSON features. |
| `name_ka`, `name_en` | string | Both required — the interface is bilingual. |
| `parent_id` | int | For `dis`, the municipality it sits in. Blank for `mun`. |
| `parent_name_en` | string | For `mun`, the region (Imereti, Guria…). Blank for `dis`. |
| `voters_total` | int | **The denominator for every rate and quotient.** All voters in the area, not just those with a listed surname. |
| `voters_total_1997` | int | The 1997 denominator. Blank if the book gives no total. |
| `lon`, `lat` | float | Centroid, WGS84. Used for labels and as a fallback marker. |

## input/precincts.csv

The granular geography. Used only to build the density surfaces, then discarded — nothing
derived from a single precinct is ever published.

| column | type | notes |
|---|---|---|
| `precinct_id` | int | |
| `mun_id` | int | The municipality it belongs to. |
| `dis_id` | int | The electoral district it belongs to. **Required** — `build.R` stops without it. Districts are not always a union of municipalities (Tbilisi is one municipality and ten districts), so this cannot be derived from `mun_id`. |
| `lon`, `lat` | float | Precinct centroid, WGS84. A polygon centroid is fine; the kernel smooths over the difference. |
| `voters_total` | int | Used to normalise density so the surface shows surname concentration rather than population. |

## input/voters_surname_precinct.csv

The large table — expect a few hundred thousand to a couple of million rows. Long format,
one row per surname × precinct, **zero counts omitted**.

| column | type | notes |
|---|---|---|
| `surname` | string | Georgian script. |
| `precinct_id` | int | |
| `count` | int | Raw count, unsuppressed. Suppression happens in the build. |

## input/book1997_surname_area.csv

Same shape, one level up. The book has no precinct detail, so it stops at municipality.

| column | type | notes |
|---|---|---|
| `surname` | string | |
| `mun_id` | int | Municipality id **on today's boundaries** — apportion before this point, and record the method for the methodology page. |
| `count` | int | |

## input/surnames_meta.csv *(optional)*

Overrides. Anything you leave out, the build script derives.

| column | notes |
|---|---|
| `surname` | Georgian script — the canonical form. |
| `latin` | Transliteration used for search and URLs. Derive it, override where the derivation is wrong. |
| `suffix_family` | `dze` \| `shvili` \| `ia` \| `iani` \| `uri` \| `other`. |
| `stem` | Drives the "related surnames" list. Leave blank to skip. |
| `merge_into` | Fold a spelling variant into another surname. Leave blank to keep separate. **Decide the policy once and document it** — this is the single choice that most affects every number on the site. |

---

## meta.json

Loaded first; everything else is discovered from it. Holds national totals, the source
descriptions, the two geographies, the suppression constants, the density grid definition,
and the basemap location. Change `suppression.k` here *and* in the build script — the app
displays the number but does not enforce it.

## areas.json

`{ "mun": [...], "dis": [...] }` — the same fields as `areas.csv`, keyed for lookup. Small
enough to load at boot, which is what makes rates and quotients computable client-side.

## index.json

The search index: every surname with its national figures. Column-array format, because it
comes straight out of a data frame and stays compact.

```json
{
  "columns": ["ka","latin","suffix","stem","voters","rank","voters_1997","rank_1997","bucket"],
  "rows": [["ბერიძე","beridze","dze","ბერ",84120,1,71455,1,"f5"]]
}
```

At full scale this becomes `index.bin` — same content, packed — but keep the JSON form
working, because it is what makes the site debuggable.

## agg/&lt;bucket&gt;.json

Where a surname's area counts live. `bucket` is `sha1(surname)[0:8] mod 256`, hex, zero
padded — **a hash, not a first letter**, because alphabetic buckets in Georgian are wildly
uneven. One fetch per lookup, ~120 surnames per file.

```json
{
  "ბერიძე": {
    "mun":   { "12": 1204, "31": 1067, "1": 18904 },
    "dis":   { "104": 1204, "2": 6238 },
    "mun97": { "12": 1021, "31": 934 },
    "suppressed": { "mun": [44, 51], "dis": [210], "mun97": [] }
  }
}
```

Objects keyed by area id rather than pair arrays, deliberately: a few bytes larger, far
easier to read and hand-edit. Areas absent from both `mun` and `suppressed` are true zeros;
areas in `suppressed` had 1 to k−1 people and are excluded from every ranking, rate and
quotient. **Rates and location quotients are not stored** — the app computes them from these
counts and `areas.json`, which keeps the files a third of the size.

## kde/&lt;bucket&gt;.json → kde.bin

Development form is JSON, one entry per surname, `[cellIndex, value]` pairs over the grid
defined in `meta.json`. `cellIndex = row * cols + col`, row 0 at the north edge of the bbox.
`value` is 1–255, scaled to that surname's own maximum.

```json
{ "ბერიძე": [[4021, 12], [4022, 31], [4023, 96]] }
```

Production form is the same data as a single concatenated binary plus an offsets index, read
with HTTP range requests — see the build plan. The JSON form stays the reference: if the two
disagree, the JSON is right.

## geo/mun.geo.json, geo/dis.geo.json

GeoJSON `FeatureCollection`, one file per level, WGS84. Not TopoJSON — the app hands these
straight to MapLibre, which does not read topologies. Simplify with mapshaper for the web
and keep an unsimplified copy for computing areas.

Each feature carries the `code` from `areas.csv` **twice**, and both are load-bearing:

```json
{ "type": "Feature",
  "id": "GE-IM-KHA",
  "properties": { "code": "GE-IM-KHA", "name_ka": "ხარაგაული", "name_en": "Kharagauli", "level": "mun" },
  "geometry": { "type": "Polygon", "coordinates": [[[43.05, 41.46], "..."]] } }
```

`id` is what `setFeatureState` addresses for the selected outline. `properties.code` is what
the choropleth paints through (`['match', ['get', 'code'], ...]`) and what `promoteId`
reads. Ship one without the other and the map renders every area flat at `NO_DATA` — no
error in the console, no failed request, just a grey map. `npm run check` asserts the two
agree, and that `name_ka`/`name_en` are non-empty, because the tooltip reads names off the
feature with no fallback to `areas.json`.

## i18n/en.json, ka.json

Flat keys, dotted namespaces, `{placeholder}` interpolation. `en.json` is the source of
truth and is complete; `ka.json` carries the identical key set, and **an empty string means
untranslated — the app falls back to English for that key**. About a third of `ka.json` is
pre-filled with terms that translate unambiguously; the rest was left blank rather than
guessed at.

Two rules worth keeping: never build a sentence by concatenating keys (write the whole
sentence with placeholders, as in `surname.lead`), and keep the key sets identical between
files so a diff shows exactly what is outstanding.

```bash
# what still needs translating
python3 -c "import json;d=json.load(open('data/i18n/ka.json'));\
print('\n'.join(k for k,v in d.items() if k!='_meta' and not v))"
```
