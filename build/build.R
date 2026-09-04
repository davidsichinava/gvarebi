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
  # k applies to the GEOGRAPHIC marginal and nothing else. What protects people
  # here is not k on every table, it is that the marginals are never crossed:
  # name x year carries no place, name x area carries no year, and no cube joins
  # them. Location is the identifying axis - four bearers of a rare name in one
  # district is close to naming them - so that cell keeps k. A national count of
  # people born in a given year does not narrow to a place, and the surname
  # index already publishes all 64,172 surnames including singletons, so the
  # cohort curve is the same grain of disclosure the atlas already makes.
  # Set this TRUE to put k back on every table.
  k_all_tables   = FALSE,
  # The roll has a date of its own, which is not the build date. Until now
  # sources.voters.date carried Sys.Date(), so the payload described a 2012
  # list as though it were current.
  source_date    = "2012",
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

# ----------------------------------------------------------------- profiles
# Per-area rankings, precomputed. The front end used to derive these live: fetch
# all 256 agg buckets (~9 MB), then walk every one of the 69,290 surnames once
# per area to find the most common and the most over-represented. For the
# Explore map that is 66 areas x 69,290 surnames on every visit, which is what
# made the tab slow. None of it depends on anything the reader does, so it
# belongs here.
#
# The NAMED lists are built from the published counts, so a profile can never
# surface a cell that suppression withheld. The plain counts are not: a count of
# distinct surnames in an area is one number aggregated over thousands of people
# and identifies nobody, whereas deriving it from the published cells alone would
# report a small area as having a few hundred surnames when it has thousands.
# The two are different kinds of fact and take different inputs.
TOPN <- 25L

profiles_for <- function(keep, raw, area_dt) {
  d <- merge(keep, idx[, .(surname, nat = voters)], by = "surname")
  d <- merge(d, area_dt[, .(area_id, av = voters_total)], by = "area_id")
  # A quotient needs a denominator; an area with no electorate has none.
  d[, lq := fifelse(n >= CFG$min_count_lq & av > 0,
                    (n / av) / (nat / NAT_VOTERS), NA_real_)]
  setorder(d, area_id, -n)
  common <- d[, .(rows = list(lapply(seq_len(min(.N, TOPN)),
                    function(i) list(surname[i], n[i])))), by = area_id]
  distinct_n <- raw[, .(distinct = .N), by = area_id]
  q <- d[!is.na(lq)]
  # Ties at the ceiling are the norm, not the exception. A surname found ONLY in
  # one area has nat == n, so its quotient collapses to NAT_VOTERS / area voters
  # — a constant. Every one of Tbilisi's top 25 sits at exactly 3.525x. Ordering
  # by quotient alone therefore picks arbitrarily among them; break the tie on
  # count so the answer is both stable and the most substantial of the tied set.
  setorder(q, area_id, -lq, -n)
  distinctive <- q[, .(rows = list(lapply(seq_len(min(.N, TOPN)),
                    function(i) list(surname[i], n[i], round(lq[i], 3))))), by = area_id]
  r10 <- copy(raw); setorder(r10, area_id, -n)
  top10 <- r10[, .(top10 = sum(utils::head(n, 10L))), by = area_id]

  out <- list()
  for (a in area_dt$area_id) {
    ck <- common[area_id == a]; qk <- distinctive[area_id == a]
    out[[as.character(a)]] <- list(
      distinct    = if (nrow(distinct_n[area_id == a])) distinct_n[area_id == a, distinct] else 0L,
      top10       = if (nrow(top10[area_id == a])) top10[area_id == a, top10] else 0L,
      common      = if (nrow(ck)) ck$rows[[1]] else list(),
      distinctive = if (nrow(qk)) qk$rows[[1]] else list())
  }
  out
}

dir.create(file.path(OUT, "profiles"), showWarnings = FALSE, recursive = TRUE)
write_json_file(profiles_for(s_mun$keep, agg_mun, mun), file.path(OUT, "profiles", "mun.json"))
write_json_file(profiles_for(s_dis$keep, agg_dis, dis), file.path(OUT, "profiles", "dis.json"))
say("profiles: top %d per area, both levels", TOPN)

# ----------------------------------------------------------------- suffixes
# Surname counts rolled up by suffix family, per area. Feeds the suffix map,
# where a family is compared against its own national share rather than against
# the other families - so the reader sees where -dze is concentrated, not merely
# where it is numerous.
#
# Rolled up from the RAW counts, because a family total is a sum over many
# surnames and dropping the sub-k cells would bias it downwards. The family x
# area cell is then suppressed on the same k as everything else: a family thin
# enough to identify somebody in one area is withheld there.
# Families come from surnames_meta.csv and nowhere else. idx carries the column
# straight from that file; the suffix_family() heuristic above only fills a gap
# where the file leaves one blank, and on the current roll it never fires.
# Anything still empty is "other" rather than a family of its own.
fam <- idx[, .(surname, suffix_family)]
fam[is.na(suffix_family) | !nzchar(suffix_family), suffix_family := "other"]

suffix_roll <- function(agg, area_dt) {
  d <- merge(agg, fam[, .(surname, suffix_family)], by = "surname")
  r <- d[, .(n = sum(n)), by = .(suffix_family, area_id)]
  r <- r[n >= CFG$k]                      # same threshold as every other cell
  r <- r[area_id %in% area_dt$area_id]
  out <- list()
  for (a in area_dt$area_id) {
    rows <- r[area_id == a]
    out[[as.character(a)]] <- if (nrow(rows)) named(rows$suffix_family, rows$n) else structure(list(), names = character(0))
  }
  out
}

fam_nat <- merge(agg_mun, fam[, .(surname, suffix_family)], by = "surname")[
  , .(n = sum(n)), by = suffix_family]
setorder(fam_nat, -n)

write_json_file(list(
  families = fam_nat$suffix_family,
  national = named(fam_nat$suffix_family, fam_nat$n),
  mun = suffix_roll(agg_mun, mun),
  dis = suffix_roll(agg_dis, dis)
), file.path(OUT, "suffix.json"))
say("suffixes: %d families across %d municipalities and %d districts",
    nrow(fam_nat), nrow(mun), nrow(dis))

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

# ----------------------------------------------------------------- first names
# Three aggregates, kept deliberately as MARGINALS rather than one cube:
#
#   names_cohort.csv        first_name x gender x birth_year   (national)
#   names_area.csv          first_name x gender x precinct     (all years)
#   first_name_by_suffix    first_name x gender x surname suffix family
#
# Crossing time with place would drive almost every cell under k - 47,175 names
# across 102 years and 75 districts is mostly ones. Each marginal on its own
# publishes at the same threshold as the surname side, and answers nearly every
# question worth asking. A time-and-place view, if ever wanted, needs its own
# coarse aggregate (decades x districts), not a finer version of these.
#
# PROVENANCE. This is the 2012 unified roll, so birth years stop at 1994 and
# nobody born later appears on it. Everything here therefore describes "people
# registered to vote in 2012", never "children named in year X": older cohorts
# are thinned by mortality and emigration, and there is no cohort at all for
# anyone who came of age after 2012. The method page says so, and no view built
# on this may imply otherwise.

names_src <- c(cohort = "names_cohort.csv", area = "names_area.csv",
               suffix = "first_name_by_suffix.csv")
have_names <- all(file.exists(file.path(IN, names_src)))

if (!have_names) {
  say("first names: input files absent, stage skipped")
} else {
  ncoh <- fread(file.path(IN, names_src[["cohort"]]), encoding = "UTF-8")
  nare <- fread(file.path(IN, names_src[["area"]]),   encoding = "UTF-8")
  nsuf <- fread(file.path(IN, names_src[["suffix"]]), encoding = "UTF-8")
  say("first names: %s cohort rows, %s area rows, %s suffix rows",
      format(nrow(ncoh), big.mark = ","), format(nrow(nare), big.mark = ","),
      format(nrow(nsuf), big.mark = ","))

  # -- clean, per the decisions taken when these files were triaged -----------
  # Nine voters carry a birth year before 1900, the earliest 1880, which is an
  # age of 132 on a 2012 roll. They are data entry errors, but discarding people
  # is worse than folding them, so they join the earliest real cohort.
  pre1900 <- ncoh[birth_year < 1900L, sum(count)]
  ncoh[birth_year < 1900L, birth_year := 1900L]

  # "NA" is not a family, it is an unclassified surname.
  nsuf[is.na(suffix_family) | suffix_family %in% c("NA", ""), suffix_family := "other"]

  # Gender is NOT a field in the roll: it is matched to each name from a public
  # name-to-gender list, so it describes the name and not the person. That is why
  # no name is ever used for both, why "unknown" is unknown for every bearer of a
  # name rather than for particular people, and why nothing here can measure how
  # a name is used across genders — the answer was fixed before the data arrived.
  # "unknown" is still published as itself rather than imputed away.
  GENDERS <- c("male", "female", "unknown")
  bad_g <- setdiff(unique(c(ncoh$gender, nare$gender, nsuf$gender)), GENDERS)
  if (length(bad_g)) stop("unexpected gender value(s): ", paste(bad_g, collapse = ", "))

  miss_p <- setdiff(unique(nare$precinct_id), precincts$precinct_id)
  if (length(miss_p))
    stop(length(miss_p), " precinct id(s) in names_area.csv are absent from precincts.csv")

  # -- normalise the nominative -ი -------------------------------------------
  # Georgian marks the nominative singular of a consonant stem with a final -ი,
  # so one person reaches the roll as დავით or დავითი depending on which form the
  # clerk typed. Folding them together moves 9% of the roll onto the right name.
  # Two rules keep the merge honest:
  #
  #   1. Conditional, never blanket. Fold X and Xი only when the roll holds BOTH.
  #      Stripping every trailing -ი invents stems nobody writes (გიორგი ->
  #      გიორგ) and can collide two genuinely different names.
  #   2. Genders must agree. ანა is 20,982 women; ანაი is one man. A pair that
  #      disagrees on gender is two names, not two spellings of one — without
  #      this guard 544 more pairs merge and 542 names end up carrying both
  #      genders, contradicting a field the roll actually recorded.
  #
  # The canonical spelling is whichever one more people carry, not the citation
  # form: ეთერი outnumbers ეთერ, so that pair folds the other way.
  NOM_I <- "ი"
  name_totals <- ncoh[, .(n = sum(count), gender = gender[1]), by = .(name = first_name)]
  name_totals[, name := trimws(name)]
  have_names <- name_totals$name
  name_totals[, stem := fifelse(endsWith(name, NOM_I) & nchar(name) > 2L,
                                substr(name, 1L, nchar(name) - 1L), NA_character_)]
  name_totals[, paired := !is.na(stem) & stem %chin% have_names]

  npairs <- merge(
    name_totals[paired == TRUE, .(long = name, short = stem, n_long = n, g_long = gender)],
    name_totals[, .(short = name, n_short = n, g_short = gender)],
    by = "short")
  npairs[, keep := g_long == g_short]
  npairs[, canon := fifelse(n_long >= n_short, long, short)]

  nmerged <- npairs[keep == TRUE]
  nmap <- rbindlist(list(
    data.table(from = nmerged$long,  to = nmerged$canon),
    data.table(from = nmerged$short, to = nmerged$canon)))
  nuntouched <- setdiff(have_names, nmap$from)
  nmap <- unique(rbindlist(list(nmap, data.table(from = nuntouched, to = nuntouched))))

  NAMES_BEFORE <- nrow(name_totals)
  folded <- nmap[from != to]
  MOVED <- sum(name_totals[name %chin% folded$from]$n)

  nlookup <- setNames(nmap$to, nmap$from)
  ncoh[, first_name := unname(nlookup[trimws(first_name)])]
  nare[, first_name := unname(nlookup[trimws(first_name)])]
  nsuf[, first_name := unname(nlookup[trimws(first_name)])]

  # Every marginal gets the SAME map and is re-aggregated, or the three files
  # stop agreeing on which names exist — which is exactly what check-data.mjs
  # asserts when it compares their name sets.
  ncoh <- ncoh[, .(count = sum(count)), by = .(first_name, gender, birth_year)]
  nare <- nare[, .(count = sum(count)), by = .(first_name, gender, precinct_id)]
  nsuf <- nsuf[, .(n = sum(n)), by = .(first_name, gender, suffix_family)]

  gclash <- unique(ncoh[, .(first_name, gender)])[, .(k = .N), by = first_name][k > 1L]
  if (nrow(gclash))
    stop(nrow(gclash), " name(s) carry two genders after normalising — the guard failed")

  say("first names: folded %s spellings, %s -> %s names, %s voters moved (%.1f%%); %s pairs refused on gender",
      format(nrow(folded), big.mark = ","), format(NAMES_BEFORE, big.mark = ","),
      format(uniqueN(nmap$to), big.mark = ","), format(MOVED, big.mark = ","),
      100 * MOVED / sum(name_totals$n), format(nrow(npairs[keep == FALSE]), big.mark = ","))

  # -- index -----------------------------------------------------------------
  nidx <- ncoh[, .(total = sum(count)), by = .(first_name, gender)]
  peak <- ncoh[, .(peak_year = birth_year[which.max(count)]), by = .(first_name, gender)]
  nidx <- merge(nidx, peak, by = c("first_name", "gender"))
  setorder(nidx, -total, first_name)
  nidx[, rank := .I]
  # Same hash the surname index uses, for the same reason: the cohort series are
  # 3.3 MB in one file, and a reader who opens one name should not fetch the
  # other 43,756. The app never computes this — it reads bucket from the index.
  nidx[, bucket := bucket_of(first_name)]

  # Everything downstream keys on the name alone: the index is one row per name,
  # the route is /n/<name>, and the area and suffix rollups group without gender
  # because on this roll a name has exactly one. That is a property of the DATA,
  # not a law — and if it ever stops holding, those rollups would quietly add men
  # and women together while the index grew a second row the front end could not
  # address. Cheaper to refuse the build than to publish that.
  if (uniqueN(nidx$first_name) != nrow(nidx))
    stop(nrow(nidx) - uniqueN(nidx$first_name),
         " name(s) carry more than one gender; the area and suffix rollups assume one")

  # Column-wise, not a row loop: nidx[i] allocates a fresh one-row data.table per
  # name, which costs minutes across forty thousand of them.
  nidx_cols <- as.list(nidx[, .(first_name, gender, total, rank, peak_year, bucket)])
  write_json_file(list(
    columns = c("ka", "gender", "total", "rank", "peak_year", "bucket"),
    rows = .mapply(function(...) unname(list(...)), nidx_cols, NULL)
  ), file.path(OUT, "names/index.json"))

  # -- cohorts ---------------------------------------------------------------
  # The denominator every temporal chart needs. Cohort sizes on this roll are
  # wildly uneven - the 1990s birth collapse alone would swamp any naming signal
  # - so a share is the only honest unit, and a share needs this.
  yr_tot <- ncoh[, .(n = sum(count)), by = .(birth_year, gender)]
  setorder(yr_tot, birth_year)
  years <- sort(unique(ncoh$birth_year))
  totals <- lapply(GENDERS, function(g) {
    d <- yr_tot[gender == g]; named(d$birth_year, d$n) })
  names(totals) <- GENDERS

  # Per-name series, suppressed cell by cell like everything else, and limited
  # to names big enough to survive that suppression. A name held by fifty people
  # across forty years is a handful of ones per decade: every cell would be
  # withheld, and an all-gaps curve says nothing while inviting the reader to
  # fill it in themselves.
  ser <- ncoh[, .(n = sum(count)), by = .(first_name, gender, birth_year)]
  ser_all <- nrow(ser)
  if (CFG$k_all_tables) ser <- ser[n >= CFG$k]
  setorder(ser, first_name, birth_year)
  sp <- split(ser, by = "first_name", keep.by = FALSE)
  # I() or jsonlite auto_unbox collapses a one-element vector to a scalar, and a
  # name with a single published year would arrive as y: 1974 rather than
  # y: [1974]. The suppressed-id lists hit exactly this and it is why pick_ids
  # wraps too; freeing the cohort made it common rather than rare.
  series <- lapply(sp, function(d) list(y = I(d$birth_year), n = I(d$n)))

  # The denominators are shared by every curve and tiny, so they stay in one
  # file. The series are not: sharded on the index bucket, opening one name
  # fetches a few hundred neighbours instead of all forty-three thousand.
  write_json_file(list(years = years, totals = totals),
                  file.path(OUT, "names/cohort.json"))
  nbmap <- setNames(nidx$bucket, nidx$first_name)
  for (b in sort(unique(nidx$bucket))) {
    keep <- names(series)[nbmap[names(series)] == b]
    write_json_file(series[keep], file.path(OUT, sprintf("names/cohort/%s.json", b)))
  }
  say("first names: %d cohort buckets", uniqueN(nidx$bucket))

  # -- geography -------------------------------------------------------------
  nare <- merge(nare, precincts[, .(precinct_id, mun_id, dis_id)], by = "precinct_id")
  name_area <- function(level_col, area_dt) {
    a_raw <- nare[, .(n = sum(count)), by = c("first_name", level_col)]
    setnames(a_raw, level_col, "area_id")
    a_raw <- a_raw[area_id %in% area_dt$area_id]
    a <- a_raw[n >= CFG$k]
    setorder(a, first_name, area_id)
    s <- split(a, by = "first_name", keep.by = FALSE)
    list(map = lapply(s, function(d) named(d$area_id, d$n)), kept = nrow(a),
         cells = a, raw = a_raw)
  }
  am <- name_area("mun_id", mun)
  ad <- name_area("dis_id", dis)
  write_json_file(am$map, file.path(OUT, "names/area/mun.json"))
  write_json_file(ad$map, file.path(OUT, "names/area/dis.json"))

  # -- per-area name profiles -------------------------------------------------
  # The same shape as the surname profiles, and for the same reason: the region
  # view would otherwise fetch the whole name index and walk 43,757 names once
  # per area to find the commonest and the most over-represented.
  #
  # The named lists come from the PUBLISHED cells, so a profile can never surface
  # a count that suppression withheld. The plain counts come from the raw ones:
  # "how many distinct male names are on the roll here" is a single number over
  # thousands of people and discloses nobody, while counting only published cells
  # would report a few hundred where there are thousands. The surname profiles
  # draw the same distinction, so the cards beside these count the same way.
  NAMES_VOTERS <- sum(nidx$total)
  gender_of <- setNames(nidx$gender, nidx$first_name)
  nat_of <- setNames(nidx$total, nidx$first_name)

  name_profiles <- function(cells, raw, area_dt) {
    d <- copy(cells)
    d[, nat := nat_of[first_name]]
    d[, gender := gender_of[first_name]]
    d <- merge(d, area_dt[, .(area_id, av = voters_total)], by = "area_id")
    d[, lq := fifelse(n >= CFG$min_count_lq & av > 0,
                      (n / av) / (nat / NAMES_VOTERS), NA_real_)]

    setorder(d, area_id, -n)
    common <- d[, .(rows = list(lapply(seq_len(min(.N, TOPN)),
                      function(i) list(first_name[i], n[i])))), by = area_id]
    rw <- copy(raw)
    rw[, gender := gender_of[first_name]]
    counts <- rw[, .(distinct = .N,
                     male = sum(gender == "male"),
                     female = sum(gender == "female")), by = area_id]
    setorder(rw, area_id, -n)
    top10 <- rw[, .(top10 = sum(utils::head(n, 10L))), by = area_id]

    q <- d[!is.na(lq)]
    # Same tie-break as the surname side: a name found only here has nat == n, so
    # its quotient collapses to a constant and ordering by quotient alone picks
    # arbitrarily among everything tied at the ceiling.
    setorder(q, area_id, -lq, -n)
    distinctive <- q[, .(rows = list(lapply(seq_len(min(.N, TOPN)),
                      function(i) list(first_name[i], n[i], round(lq[i], 3))))), by = area_id]

    out <- list()
    for (a in area_dt$area_id) {
      ck <- common[area_id == a]; qk <- distinctive[area_id == a]
      cn <- counts[area_id == a]; tk <- top10[area_id == a]
      out[[as.character(a)]] <- list(
        distinct    = if (nrow(cn)) cn$distinct else 0L,
        male        = if (nrow(cn)) cn$male else 0L,
        female      = if (nrow(cn)) cn$female else 0L,
        top10       = if (nrow(tk)) tk$top10 else 0L,
        common      = if (nrow(ck)) ck$rows[[1]] else list(),
        distinctive = if (nrow(qk)) qk$rows[[1]] else list())
    }
    out
  }

  dir.create(file.path(OUT, "names/profiles"), showWarnings = FALSE, recursive = TRUE)
  write_json_file(name_profiles(am$cells, am$raw, mun), file.path(OUT, "names/profiles/mun.json"))
  write_json_file(name_profiles(ad$cells, ad$raw, dis), file.path(OUT, "names/profiles/dis.json"))
  say("first names: profiles, top %d per area, both levels", TOPN)

  # -- first name x surname suffix -------------------------------------------
  # Whether an -ia/-ua/-ava family draws on a different first-name repertoire
  # than a -dze one. This is the one place the two halves of the atlas touch,
  # and it touches them at family level, never at individual surname level.
  nsx <- nsuf[, .(n = sum(n)), by = .(first_name, suffix_family)]
  if (CFG$k_all_tables) nsx <- nsx[n >= CFG$k]
  setorder(nsx, first_name, -n)
  sfx_nat <- nsuf[, .(n = sum(n)), by = suffix_family]
  setorder(sfx_nat, -n)
  sx <- split(nsx, by = "first_name", keep.by = FALSE)
  write_json_file(list(
    families = sfx_nat$suffix_family,
    national = named(sfx_nat$suffix_family, sfx_nat$n),
    by_name = lapply(sx, function(d) named(d$suffix_family, d$n))
  ), file.path(OUT, "names/suffix.json"))

  NAMES_META <- list(
    distinct = nrow(nidx),
    voters = sum(nidx$total),
    by_gender = named(GENDERS, sapply(GENDERS, function(g) sum(nidx[gender == g]$total))),
    years = list(first = min(years), last = max(years), roll = "2012"),
    normalised = list(before = NAMES_BEFORE, after = nrow(nidx),
                      folded = nrow(folded), voters_moved = MOVED),
    # The national counterparts of a per-area name profile. Carried in meta so
    # the region view can render its nationwide state without fetching the whole
    # two-megabyte name index for four numbers and a list of twenty-five.
    distinct_male = nrow(nidx[gender == "male"]),
    distinct_female = nrow(nidx[gender == "female"]),
    top10 = sum(utils::head(nidx$total, 10L)),
    top = .mapply(function(...) unname(list(...)),
                  list(utils::head(nidx$first_name, 25L), utils::head(nidx$total, 25L)), NULL),
    series_names = length(series),
    k_geographic_only = !CFG$k_all_tables
  )
  say("first names: %s names, %s voters; %d cohort series, %s of %s cells published",
      format(nrow(nidx), big.mark = ","), format(sum(nidx$total), big.mark = ","),
      length(series), format(nrow(ser), big.mark = ","), format(ser_all, big.mark = ","))
  say("first names: area cells kept %s mun / %s dis; suffix cells %s; %d pre-1900 voters folded into 1900",
      format(am$kept, big.mark = ","), format(ad$kept, big.mark = ","),
      format(nrow(nsx), big.mark = ","), pre1900)
}

# ----------------------------------------------------------------- meta
write_json_file(list(
  version = CFG$version,
  generated_by = "build/build.R",
  totals = list(voters = NAT_VOTERS, voters_1997 = NAT_1997,
                surnames = nrow(idx),
                surnames_ranked = nrow(idx[voters >= 10])),
  sources = list(
    voters   = list(label_key = "source.voters",   date = CFG$source_date, records = NAT_VOTERS),
    book1997 = list(label_key = "source.book1997", citation = "[AUTHOR, TITLE, PUBLISHER, 1997]")),
  geographies = list(
    list(id = "mun", label_key = "geo.municipalities", count = nrow(mun),
         geojson = "geo/mun.geo.json", tbilisi = "single"),
    list(id = "dis", label_key = "geo.districts", count = nrow(dis),
         geojson = "geo/dis.geo.json", tbilisi = "split")),
  suppression = list(k = CFG$k, min_count_for_lq = CFG$min_count_lq),
  first_names = if (exists("NAMES_META")) NAMES_META else NULL,
  kde = list(grid = G, bandwidth_km = CFG$bandwidth_km, quantisation = "uint8",
             dev = "kde/{bucket}.json"),
  buckets = CFG$buckets,
  basemap = list(theme = "grayscale", attribution_key = "map.attribution")
), file.path(OUT, "meta.json"))

say("done -> %s", OUT)
