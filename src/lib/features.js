// Feature flags. One boolean per thing that is built but deliberately not shown.
//
// Flip a flag back to `true` and the feature returns — nothing here deletes
// code, and nothing downstream of the app is affected. The build script still
// reads book1997_surname_area.csv, `mun97` still ships inside every agg bucket,
// `voters_1997` and `rank_1997` still sit in index.json, and `npm run check`
// still validates all of it. This gates the interface only, so the data cannot
// rot while the surface is hidden.
export const SHOW_1997 = false
