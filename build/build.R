#!/usr/bin/env Rscript
# ---------------------------------------------------------------------------
# Georgian Surname Atlas — build script
#
# Turns the five input CSVs into the static payload the app fetches.
# This is the ONLY place raw precinct counts are read. Nothing precinct-shaped
# leaves it: counts are suppressed below k, and the density surfaces are
# smoothed and quantised before they are written.
#
#   Rscript build/build.R --in data/input --out public/data
#
# Dependencies: data.table, jsonlite, digest
# ---------------------------------------------------------------------------

suppressPackageStartupMessages({
  library(data.table)
  library(jsonlite)
  library(digest)
})

# ----------------------------------------------------------------- config
CFG <- list(
  k              = 5L,      # suppression threshold: cells below this are omitted
  min_count_lq   = 50L,     # minimum count before a location quotient is shown
  buckets        = 256L,
  grid           = list(cols = 200L, rows = 110L,
                        bbox = c(39.90, 41.00, 46.80, 43.60)),  # W, S, E, N
  bandwidth_km   = 8,
  kde_floor      = 0.02,    # relative to the surname's own peak
  version        = format(Sys.Date())
)

args <- commandArgs(trailingOnly = TRUE)
argval <- function(flag, default) {
  i <- match(flag, args); if (is.na(i)) default else args[i + 1L]
}
IN  <- argval("--in",  "data/input")
OUT <- argval("--out", "public/data")

say <- function(...) cat(sprintf(...), "\n", sep = "")
dir.create(OUT, recursive = TRUE, showWarnings = FALSE)

write_json_file <- function(x, path, ...) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  writeLines(toJSON(x, auto_unbox = TRUE, digits = NA, null = "null", ...), path, useBytes = TRUE)
}

# ----------------------------------------------------------------- read
say("reading %s", IN)
areas_in  <- fread(file.path(IN, "areas.csv"),  encoding = "UTF-8")
precincts <- fread(file.path(IN, "precincts.csv"), encoding = "UTF-8")
voters    <- fread(file.path(IN, "voters_surname_precinct.csv"), encoding = "UTF-8")
book97    <- fread(file.path(IN, "book1997_surname_area.csv"), encoding = "UTF-8")

# A header-only book file is the normal state while the 1997 surface is hidden.
# fread types the columns of an empty CSV as logical, which blows up much later
# in a join ("Incompatible join types: x.surname (logical)") rather than here.
# Give it the schema it would have had.
if (!nrow(book97))
  book97 <- data.table(surname = character(), mun_id = integer(), count = integer())

meta_path <- file.path(IN, "surnames_meta.csv")
smeta <- if (file.exists(meta_path)) fread(meta_path, encoding = "UTF-8") else
  data.table(surname = character(), latin = character(),
             suffix_family = character(), stem = character(), merge_into = character())

# ----------------------------------------------------------------- validate
stopifnot(all(c("level","area_id","code","name_ka","name_en","voters_total") %in% names(areas_in)))
if (anyDuplicated(areas_in[, .(level, area_id)]))
  stop("areas.csv: area_id must be unique within a level")
# voters_total is the denominator for every rate and quotient, so it must be
# present. Zero is allowed, though: Abkhazia and the Tskhinvali region are real
# areas with no electorate, and rate()/lq() already return null rather than
# Infinity for a zero denominator, so they render as "no data" instead of
# vanishing from the map. Missing is still an error — that is a gap, not a fact.
if (any(is.na(areas_in$voters_total)))
  stop("areas.csv: voters_total is the denominator for every rate — it cannot be missing (0 is allowed for an area with no electorate)")
if (any(areas_in$voters_total < 0))
  stop("areas.csv: voters_total cannot be negative")
if (!"dis_id" %in% names(precincts))
  stop("precincts.csv needs a dis_id column: precincts nest in electoral districts, ",
       "and districts are not always a union of municipalities (Tbilisi).")

# The 1997 denominator is optional. Everything downstream still writes the field,
# so fill it rather than branching: absent means "no book figures", which is
# exactly what NA already means to the suppression and change logic.
if (!"voters_total_1997" %in% names(areas_in)) {
  say("areas.csv has no voters_total_1997 — treating every 1997 denominator as absent")
  areas_in[, voters_total_1997 := NA_integer_]
}

# A repeated precinct_id is not a cosmetic duplicate: precincts is merged into
# the voters table by this key, so a second row silently doubles every surname
# count in that precinct. Fail rather than publish inflated numbers.
if (anyDuplicated(precincts$precinct_id)) {
  dupes <- precincts$precinct_id[duplicated(precincts$precinct_id)]
  stop(sprintf("precincts.csv: precinct_id must be unique — %d repeated (%s%s)",
               length(dupes), paste(utils::head(dupes, 5), collapse = ", "),
               if (length(dupes) > 5) ", ..." else ""))
}
orphans <- setdiff(voters$precinct_id, precincts$precinct_id)
if (length(orphans)) stop(sprintf("%d precinct_id values in voters CSV are not in precincts.csv", length(orphans)))

# Every precinct has to land in an area that exists, at both levels. Without
# this the aggregation happily groups by an id nothing defines: the counts go
# into agg/ keyed to a municipality that is not in areas.json, the front end
# finds no row to attach them to, and the voters simply disappear from the map
# with nothing anywhere reporting a problem. Check it here, before the slow part.
for (lv in c("mun", "dis")) {
  have <- areas_in[level == lv, area_id]
  miss <- sort(setdiff(unique(precincts[[paste0(lv, "_id")]]), have))
  if (length(miss)) {
    lost <- precincts[get(paste0(lv, "_id")) %in% miss, sum(voters_total)]
    stop(sprintf("precincts.csv: %d %s_id value(s) are not in areas.csv (%s%s) — %s voters in %d precincts would be dropped",
                 length(miss), lv, paste(utils::head(miss, 8), collapse = ", "),
                 if (length(miss) > 8) ", ..." else "",
                 format(lost, big.mark = ","),
                 nrow(precincts[get(paste0(lv, "_id")) %in% miss])))
  }
}

# ----------------------------------------------------------------- normalise surnames
# merge_into folds spelling variants together. Applied first: everything
# downstream sees canonical surnames only.
if (nrow(smeta) && "merge_into" %in% names(smeta)) {
  m <- smeta[!is.na(merge_into) & nzchar(merge_into), .(surname, merge_into)]
  if (nrow(m)) {
    say("merging %d surname variants", nrow(m))
    voters[m, on = .(surname), surname := i.merge_into]
    book97[m, on = .(surname), surname := i.merge_into]
    smeta <- smeta[!surname %in% m$surname]
  }
}

# Mkhedruli -> Latin, the common journalistic transliteration. Overridden by
# surnames_meta.csv wherever it disagrees.
TRANSLIT <- c(
  "ა"="a","ბ"="b","გ"="g","დ"="d","ე"="e","ვ"="v","ზ"="z","თ"="t","ი"="i","კ"="k",
  "ლ"="l","მ"="m","ნ"="n","ო"="o","პ"="p","ჟ"="zh","რ"="r","ს"="s","ტ"="t","უ"="u",
  "ფ"="p","ქ"="k","ღ"="gh","ყ"="q","შ"="sh","ჩ"="ch","ც"="ts","ძ"="dz","წ"="ts",
  "ჭ"="ch","ხ"="kh","ჯ"="j","ჰ"="h"
)
translit <- function(x) {
  vapply(strsplit(x, "", fixed = TRUE), function(ch) {
    paste0(ifelse(is.na(TRANSLIT[ch]), ch, TRANSLIT[ch]), collapse = "")
  }, character(1))
}

suffix_family <- function(x) {
  fifelse(grepl("ძე$", x), "dze",
  fifelse(grepl("შვილი$", x), "shvili",
  fifelse(grepl("(ია|ავა)$", x), "ia",
  fifelse(grepl("იანი$", x), "iani",
  fifelse(grepl("(ური|ელი)$", x), "uri", "other")))))
}

# Bucket = characters 7-8 of the SHA-1 hex digest, which is exactly
# `int(hex[0:8], 16) %% 256` because 256 = 16^2 — and, unlike strtoi(), it does
# not silently return NA on an 8-digit hex value that overflows R's integer.
# A hash rather than a first letter: alphabetic buckets in Georgian are wildly
# uneven, and the app never computes this — it reads `bucket` from index.json.
bucket_of <- function(x)
  vapply(x, function(s) substr(digest(s, algo = "sha1", serialize = FALSE), 7, 8),
         character(1), USE.NAMES = FALSE)

# ----------------------------------------------------------------- areas
mun <- areas_in[level == "mun"]
dis <- areas_in[level == "dis"]
areas_out <- list(
  mun = lapply(seq_len(nrow(mun)), function(i) with(mun[i], list(
    id = area_id, code = code, name_ka = name_ka, name_en = name_en,
    parent_en = if (!is.null(mun$parent_name_en)) parent_name_en else "",
    voters = voters_total, voters_1997 = voters_total_1997,
    centroid = c(lon, lat)))),
  dis = lapply(seq_len(nrow(dis)), function(i) with(dis[i], list(
    id = area_id, code = code, name_ka = name_ka, name_en = name_en,
    mun_id = parent_id, voters = voters_total, voters_1997 = voters_total_1997,
    centroid = c(lon, lat))))
)
write_json_file(areas_out, file.path(OUT, "areas.json"))
say("areas: %d municipalities, %d districts", nrow(mun), nrow(dis))

NAT_VOTERS <- sum(mun$voters_total)
NAT_1997   <- sum(mun$voters_total_1997, na.rm = TRUE)

# ----------------------------------------------------------------- aggregate
say("aggregating %s voter rows", format(nrow(voters), big.mark = ","))
voters <- merge(voters, precincts[, .(precinct_id, mun_id, dis_id)], by = "precinct_id")

agg_mun <- voters[, .(n = sum(count)), by = .(surname, area_id = mun_id)]
agg_dis <- voters[, .(n = sum(count)), by = .(surname, area_id = dis_id)]
agg_97  <- book97[, .(n = sum(count)), by = .(surname, area_id = mun_id)]

# Suppression happens here and nowhere else.
split_suppressed <- function(dt) list(
  keep = dt[n >= CFG$k],
  drop = dt[n > 0 & n < CFG$k]
)
s_mun <- split_suppressed(agg_mun)
s_dis <- split_suppressed(agg_dis)
s_97  <- split_suppressed(agg_97)
say("suppressed at k=%d: %d municipal cells, %d district cells, %d in 1997",
    CFG$k, nrow(s_mun$drop), nrow(s_dis$drop), nrow(s_97$drop))

# Complementary suppression: if exactly one cell in an area is suppressed, the
# published national total gives it away by subtraction. Drop the next-smallest too.
complementary <- function(keep, drop) {
  lone <- drop[, .N, by = surname][N == 1L, surname]
  if (!length(lone)) return(list(keep = keep, drop = drop))
  extra <- keep[surname %in% lone][order(surname, n), .SD[1L], by = surname]
  say("  complementary suppression: %d additional cells", nrow(extra))
  list(keep = keep[!extra, on = .(surname, area_id)],
       drop = rbind(drop, extra))
}
s_mun <- complementary(s_mun$keep, s_mun$drop)
s_dis <- complementary(s_dis$keep, s_dis$drop)

# ----------------------------------------------------------------- index
nat <- agg_mun[, .(voters = sum(n)), by = surname]
nat97 <- agg_97[, .(voters_1997 = sum(n)), by = surname]
idx <- merge(nat, nat97, by = "surname", all.x = TRUE)
idx[is.na(voters_1997), voters_1997 := 0L]
idx <- merge(idx, smeta[, .(surname, latin, suffix_family, stem)], by = "surname", all.x = TRUE)
# An optional column that is blank for every row comes back from fread as
# logical NA, and `col := "text"` then coerces the TEXT to logical rather than
# the column to character — silently publishing nulls. Force the type first.
for (col in c("latin", "suffix_family", "stem"))
  if (!is.character(idx[[col]])) set(idx, j = col, value = as.character(idx[[col]]))
idx[is.na(latin) | !nzchar(latin), latin := translit(surname)]
idx[is.na(suffix_family) | !nzchar(suffix_family), suffix_family := suffix_family(surname)]
idx[is.na(stem), stem := ""]
setorder(idx, -voters)
idx[, rank := seq_len(.N)]
idx[, rank_1997 := frank(-voters_1997, ties.method = "min")]
idx[, bucket := bucket_of(surname)]

# Built column-wise. `idx[i]` inside a loop allocates a fresh one-row data.table
# per surname, which is fine for twelve and costs minutes for seventy thousand.
idx_cols <- as.list(idx[, .(surname, latin, suffix_family, stem,
                            voters, rank, voters_1997, rank_1997, bucket)])
write_json_file(list(
  columns = c("ka","latin","suffix","stem","voters","rank","voters_1997","rank_1997","bucket"),
  # unname: .mapply hands back NAMED lists, and jsonlite writes a named list as
  # an object. The index is the column-array format — each row must be a bare
  # array, positional against `columns` above.
  rows = lapply(.mapply(list, idx_cols, NULL), unname)
), file.path(OUT, "index.json"))
say("index: %d surnames", nrow(idx))

# ----------------------------------------------------------------- agg buckets
named <- function(ids, ns) { l <- as.list(ns); names(l) <- as.character(ids); l }
bmap <- setNames(idx$bucket, idx$surname)   # also used by the kde stage below

# `X[surname == s]` is a full scan of X. Nine of them per surname, across
# seventy thousand surnames, is a few hundred billion row comparisons — the
# reason this stage used to run for tens of minutes. Group each table by surname
# ONCE into a lookup keyed by name, then every surname is a hash lookup.
by_surname <- function(dt, value = TRUE) {
  if (!nrow(dt)) return(list())
  g <- if (value) dt[, .(v = list(named(area_id, n))), by = surname]
       else       dt[, .(v = list(sort(area_id))), by = surname]
  setNames(g$v, g$surname)
}
K_mun <- by_surname(s_mun$keep); K_dis <- by_surname(s_dis$keep); K_97 <- by_surname(s_97$keep)
D_mun <- by_surname(s_mun$drop, FALSE); D_dis <- by_surname(s_dis$drop, FALSE); D_97 <- by_surname(s_97$drop, FALSE)
pick <- function(m, s) { v <- m[[s]]; if (is.null(v)) list() else v }

# toJSON(auto_unbox = TRUE) turns a one-element vector into a bare scalar, so an
# area list holding exactly one id ships as `12` rather than `[12]` — and the
# front end calls .map() on it (metrics.js: `(record.suppressed?.[field] ?? [])
# .map(Number)`), which throws on a number. With twelve sample surnames no field
# ever had exactly one entry; on the real roll 84,913 of them do. I() forces an
# array at every length, including zero.
pick_ids <- function(m, s) { v <- m[[s]]; I(if (is.null(v)) integer(0) else v) }

for (b in sort(unique(idx$bucket))) {
  names_b <- idx[bucket == b, surname]
  payload <- lapply(names_b, function(s) list(
    mun   = pick(K_mun, s),
    dis   = pick(K_dis, s),
    mun97 = pick(K_97, s),
    suppressed = list(
      mun   = pick_ids(D_mun, s),
      dis   = pick_ids(D_dis, s),
      mun97 = pick_ids(D_97, s))
  ))
  names(payload) <- names_b
  write_json_file(payload, file.path(OUT, "agg", paste0(b, ".json")))
}
say("agg: %d buckets", length(unique(idx$bucket)))

# ----------------------------------------------------------------- kde
# A Gaussian kernel over precinct points, on a fixed grid, quantised to one
# byte per cell and stored sparse. The precinct coordinates are consumed here;
# nothing downstream can recover a point value from the result.
G <- CFG$grid
cell_w <- (G$bbox[3] - G$bbox[1]) / G$cols
cell_h <- (G$bbox[4] - G$bbox[2]) / G$rows
km_per_deg_lon <- 111.32 * cos(mean(c(G$bbox[2], G$bbox[4])) * pi / 180)
sigma_x <- CFG$bandwidth_km / km_per_deg_lon / cell_w   # in cells
sigma_y <- CFG$bandwidth_km / 110.57 / cell_h
radius  <- ceiling(3 * max(sigma_x, sigma_y))

# A precinct with no coordinates cannot be placed on the grid: NA propagates
# through the cell arithmetic and poisons the accumulation. Drop it from the
# density surface only — its counts still reach the municipal and district
# aggregates, which are joined by id and need no geometry.
placed <- precincts[!is.na(lon) & !is.na(lat)]
if (nrow(placed) < nrow(precincts))
  say("  %d precincts have no coordinates — omitted from the density surface, still counted in the tables",
      nrow(precincts) - nrow(placed))

prec <- placed[, .(precinct_id,
                   cx = pmin(G$cols - 1L, pmax(0L, as.integer((lon - G$bbox[1]) / cell_w))),
                   cy = pmin(G$rows - 1L, pmax(0L, as.integer((G$bbox[4] - lat) / cell_h))),
                   pv = voters_total)]
vp <- merge(voters[, .(surname, precinct_id, count)], prec, by = "precinct_id")

dx <- -radius:radius
kern <- outer(exp(-(dx^2) / (2 * sigma_y^2)), exp(-(dx^2) / (2 * sigma_x^2)))  # rows x cols

say("kde: %d x %d grid, sigma %.1f x %.1f cells, radius %d",
    G$cols, G$rows, sigma_x, sigma_y, radius)

# Same story as the agg loop: scanning a million-row table once per surname is
# what made this stage look like a hang. Key it and each lookup is a binary
# search instead. The k filter is applied once, up front, rather than per pass.
vp <- vp[count >= CFG$k]
setkey(vp, surname)

kde_bucket <- list()
for (s in idx$surname) {
  pts <- vp[.(s), nomatch = 0L]
  if (!nrow(pts)) next
  field <- matrix(0, nrow = G$rows, ncol = G$cols)
  # weight by share of the precinct's electorate, so the surface shows
  # concentration rather than simply where people live
  wts <- pts$count / pmax(pts$pv, 1)
  for (i in seq_len(nrow(pts))) {
    r0 <- pts$cy[i] + 1L; c0 <- pts$cx[i] + 1L
    rr <- (r0 - radius):(r0 + radius); cc <- (c0 - radius):(c0 + radius)
    ok_r <- rr >= 1 & rr <= G$rows; ok_c <- cc >= 1 & cc <= G$cols
    field[rr[ok_r], cc[ok_c]] <- field[rr[ok_r], cc[ok_c]] + kern[ok_r, ok_c] * wts[i]
  }
  peak <- max(field)
  if (peak <= 0) next
  rel <- field / peak
  rel[rel < CFG$kde_floor] <- 0          # floor: no lone household in an empty valley
  hit <- which(rel > 0)
  if (!length(hit)) next
  # which() on a matrix is column-major; convert to row-major cell index
  r <- ((hit - 1L) %% G$rows); c <- ((hit - 1L) %/% G$rows)
  cells <- cbind(as.integer(r * G$cols + c), as.integer(pmax(1, round(rel[hit] * 255))))
  cells <- cells[order(cells[, 1]), , drop = FALSE]
  b <- bmap[[s]]
  kde_bucket[[b]] <- c(kde_bucket[[b]], setNames(list(cells), s))
}
for (b in names(kde_bucket))
  write_json_file(kde_bucket[[b]], file.path(OUT, "kde", paste0(b, ".json")))
say("kde: %d surnames across %d buckets",
    sum(lengths(kde_bucket)), length(kde_bucket))

# ----------------------------------------------------------------- meta
write_json_file(list(
  version = CFG$version,
  generated_by = "build/build.R",
  totals = list(voters = NAT_VOTERS, voters_1997 = NAT_1997,
                surnames = nrow(idx),
                surnames_ranked = nrow(idx[voters >= 10])),
  sources = list(
    voters   = list(label_key = "source.voters",   date = CFG$version, records = NAT_VOTERS),
    book1997 = list(label_key = "source.book1997", citation = "[AUTHOR, TITLE, PUBLISHER, 1997]")),
  geographies = list(
    list(id = "mun", label_key = "geo.municipalities", count = nrow(mun),
         geojson = "geo/mun.geo.json", tbilisi = "single"),
    list(id = "dis", label_key = "geo.districts", count = nrow(dis),
         geojson = "geo/dis.geo.json", tbilisi = "split")),
  suppression = list(k = CFG$k, min_count_for_lq = CFG$min_count_lq),
  kde = list(grid = G, bandwidth_km = CFG$bandwidth_km, quantisation = "uint8",
             dev = "kde/{bucket}.json"),
  buckets = CFG$buckets,
  basemap = list(theme = "grayscale", attribution_key = "map.attribution")
), file.path(OUT, "meta.json"))

say("done -> %s", OUT)
