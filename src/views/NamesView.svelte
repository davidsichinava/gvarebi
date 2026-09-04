<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getNames, getNameCohort, getNameCohortBucket, getNameArea, getNameSuffix, searchNames } from '../lib/data.js'
  import { lq, rate, byMetric } from '../lib/metrics.js'
  import { scaleFor } from '../lib/colors.js'
  import { familyLabelFull } from '../lib/suffix.js'
  import { num, times, share } from '../lib/format.js'
  import MapView from '../components/MapView.svelte'
  import Legend from '../components/Legend.svelte'
  import LayerPanel from '../components/LayerPanel.svelte'

  let { areas, meta } = $props()

  let geo = $derived(nav.geo)
  let list = $derived(areas[geo] ?? [])

  // The three marginals load independently; the view renders whatever has
  // arrived rather than blocking on all of them.
  let names = $state(null)
  let cohort = $state(null)
  let series = $state(null)
  let areaData = $state(null)
  let suffixData = $state(null)

  $effect(() => { getNames().then((n) => (names = n)) })
  $effect(() => { getNameCohort().then((c) => (cohort = c)) })
  $effect(() => { getNameSuffix().then((s) => (suffixData = s)) })
  $effect(() => {
    const want = geo
    areaData = null
    getNameArea(want).then((d) => { if (geo === want) areaData = d })
  })

  // An empty route is the tab's landing state: the commonest name, not an error.
  let entry = $derived(!names ? null : (names.byKa.get(nav.a) ?? names.list[0]))
  const pick = (n) => go({ view: 'name', a: n.ka })

  // Only the bucket this name sits in. Memoised by path in data.js, so moving
  // between neighbouring names costs nothing after the first.
  $effect(() => {
    const b = entry?.bucket
    if (b == null) return
    series = null
    getNameCohortBucket(b).then((s) => { if (entry?.bucket === b) series = s })
  })

  let q = $state('')
  let hits = $derived(names ? searchNames(names, q, 60) : [])

  // ---------------------------------------------------------------- cohort
  // Share of the reader's own comparison group: a male name is measured against
  // men born that year, not against everyone. Cohort sizes on this roll are
  // wildly uneven — the 1990s birth collapse alone would swamp any naming
  // signal — so a raw count would draw the demography and not the name.
  //
  // "unknown" is 635 people across 623 names, far too thin a denominator to
  // divide by, so those names measure against the whole cohort instead.
  let denom = $derived.by(() => {
    if (!cohort || !entry) return null
    if (entry.gender !== 'unknown') return cohort.totals[entry.gender] ?? {}
    const all = {}
    for (const g of Object.keys(cohort.totals))
      for (const [y, n] of Object.entries(cohort.totals[g])) all[y] = (all[y] ?? 0) + n
    return all
  })

  // A share needs a denominator worth dividing by. The roll holds SEVEN men born
  // in 1907, so a single bearer reads as 14.3% and the early years swamp the
  // chart with sampling noise — the eye reads that spike as the name's peak when
  // it is one person. Below this floor a year is simply not drawn: the roll
  // cannot say anything about it, and a gap says so more honestly than a spike.
  const MIN_COHORT = 1000
  const X0 = 1920, X1 = 1994, H = 100

  let curve = $derived.by(() => {
    if (!cohort || !entry || !denom || !series) return []
    const s = series[entry.ka]
    if (!s) return []
    const out = []
    for (let i = 0; i < s.y.length; i++) {
      const y = s.y[i], d = denom[y]
      if (y >= X0 && d >= MIN_COHORT) out.push({ year: y, count: s.n[i], share: s.n[i] / d })
    }
    return out
  })

  // Peak measured on what the chart actually draws. The index carries a peak
  // year too, but that one is the year with the most BEARERS — a different
  // question, and on a roll whose cohorts differ tenfold it gives a different
  // answer. Showing that number beside this curve would contradict the picture.
  let peakShare = $derived(Math.max(0.0001, ...curve.map((p) => p.share)))
  let peakPoint = $derived(curve.find((p) => p.share === peakShare) ?? null)
  const px = (year) => ((year - X0) / (X1 - X0)) * 100
  // Not named `share`: that is the imported formatter, and shadowing it here
  // would work until someone reached for it inside this function.
  const py = (v) => H - (v / peakShare) * H
  let path = $derived(curve.length
    ? curve.map((p, i) => `${i ? 'L' : 'M'}${px(p.year).toFixed(2)},${py(p.share).toFixed(2)}`).join(' ')
    : '')
  let areaPath = $derived(curve.length
    ? `M${px(curve[0].year).toFixed(2)},${H} ` +
      curve.map((p) => `L${px(p.year).toFixed(2)},${py(p.share).toFixed(2)}`).join(' ') +
      ` L${px(curve.at(-1).year).toFixed(2)},${H} Z`
    : '')
  const decades = Array.from({ length: 8 }, (_, i) => 1920 + i * 10)

  // ---------------------------------------------------------------- map
  // A name absent from the area file had fewer than five bearers there. That is
  // NOT a zero: the file publishes no zeros at all, so "few" and "none" arrive
  // as the same withheld state and the map must not pretend to separate them.
  let rows = $derived.by(() => {
    if (!areaData || !entry) return []
    const here = areaData[entry.ka] ?? {}
    const nat = entry.voters
    const natVoters = meta.totals.voters
    return list.map((area) => {
      const count = here[area.id]
      const noData = !(area.voters > 0)
      const suppressed = !noData && count == null
      return {
        area, noData, suppressed, zero: false,
        count: count ?? null,
        rate: count == null ? null : rate(count, area.voters),
        value: count == null ? null : lq(count, area.voters, nat, natVoters),
      }
    })
  })

  let valued = $derived(rows.filter((r) => r.value != null))
  let scale = $derived(scaleFor('lq', valued.map((r) => r.value)))
  let ranked = $derived([...rows].sort(byMetric((r) => r.value)))

  const tip = (row) => {
    if (!row) return ''
    const label = areaName(row.area)
    if (row.noData) return `<b>${label}</b><br><span style="color:#6b665e">${t('legend.no_data')}</span>`
    if (row.suppressed) return `<b>${label}</b><br><span style="color:#6b665e">${t('value.suppressed_long', { k: meta.suppression.k })}</span>`
    return `<b>${label}</b><br>${num(row.count)} · ${times(row.value)}`
  }

  // ---------------------------------------------------------------- suffix
  let mix = $derived.by(() => {
    if (!suffixData || !entry) return []
    const here = suffixData.by_name[entry.ka]
    if (!here) return []
    const total = Object.values(here).reduce((a, b) => a + b, 0)
    const natTotal = Object.values(suffixData.national).reduce((a, b) => a + b, 0)
    return Object.entries(here)
      .map(([family, n]) => ({
        family, n, share: n / total,
        national: (suffixData.national[family] ?? 0) / natTotal,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
  })
  let maxMix = $derived(Math.max(0.01, ...mix.map((m) => Math.max(m.share, m.national))))

  let showBase = $state(true), showFills = $state(true)
  let fillOpacity = $state(0.85)
</script>

<div class="wrap">
  <section class="main scroll">
    {#if !entry}
      <p class="tiny mut">…</p>
    {:else}
      <div class="head card pad">
        <h1 class="ka">{entry.ka}</h1>
        <div class="meta tiny mut">
          {t(`names.gender_${entry.gender}`)} · {t('names.rank', { n: num(entry.rank) })}
        </div>
        <div class="tiles">
          <div><div class="lbl">{t('names.bearers')}</div><div class="big num">{num(entry.voters)}</div></div>
          <div><div class="lbl">{t('names.share_of_roll')}</div><div class="big num">{share(entry.voters / meta.totals.voters, 2)}</div></div>
          <div><div class="lbl">{t('names.peak_year')}</div><div class="big num">{peakPoint?.year ?? '—'}</div></div>
        </div>
      </div>

      <div class="card pad">
        <div class="lbl">{t('names.cohort_title')}</div>
        <p class="note tiny mut">{t('names.cohort_note')}</p>
        {#if curve.length}
          <svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path class="fill" d={areaPath} />
            <path class="line" d={path} vector-effect="non-scaling-stroke" />
            {#if peakPoint}
              <line class="peak" x1={px(peakPoint.year)} y1="0" x2={px(peakPoint.year)} y2="100"
                    vector-effect="non-scaling-stroke" />
            {/if}
          </svg>
          <div class="axis tiny mut">
            {#each decades as d}
              <span style="left:{px(d)}%">{String(d).slice(2)}</span>
            {/each}
          </div>
          <p class="scaleline tiny mut">{t('names.peak_of', { share: share(peakShare, 1), year: peakPoint?.year ?? '' })}</p>
        {:else}
          <p class="tiny mut">{t('names.no_series')}</p>
        {/if}
      </div>

      <div class="card map">
        <MapView {geo} {rows} {scale} {showBase} {showFills} {fillOpacity}
          showKde={false} tooltip={tip}
          onpick={(code) => { const a = list.find((x) => x.code === code); if (a) go({ view: 'region', a: geo, b: a.id }) }} />
        <div class="overlay tl"><LayerPanel bind:showBase bind:showFills bind:fillOpacity hasKde={false} /></div>
        <div class="overlay bl">
          <Legend {scale} metric="lq" k={meta.suppression.k}
            anySuppressed={rows.some((r) => r.suppressed)}
            anyNoData={rows.some((r) => r.noData)} anyZero={false} />
        </div>
      </div>

      <div class="card pad">
        <div class="lbl">{t('names.map_title')}</div>
        <p class="note tiny mut">{t('names.map_note', { k: meta.suppression.k })}</p>
        <table>
          <thead>
            <tr>
              <th>{t(geo === 'dis' ? 'table.district' : 'table.municipality')}</th>
              <th class="r">{t('table.voters')}</th>
              <th class="r">{t('table.per_1000')}</th>
              <th class="r">{t('table.concentration')}</th>
            </tr>
          </thead>
          <tbody>
            {#each ranked.slice(0, 15) as r (r.area.code)}
              <tr class="link" class:off={r.suppressed || r.noData}
                  onclick={() => go({ view: 'region', a: geo, b: r.area.id })}>
                <td>{areaName(r.area)}</td>
                <td class="r num">{r.count == null ? '' : num(r.count)}</td>
                <td class="r num">{r.rate == null ? '—' : num(r.rate, 1)}</td>
                <td class="r num"><b>{r.value == null ? '—' : times(r.value)}</b></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if mix.length}
        <div class="card pad">
          <div class="lbl">{t('names.suffix_title')}</div>
          <p class="note tiny mut">{t('names.suffix_note')}</p>
          <div class="bars">
            {#each mix as m}
              <div class="bar">
                <span class="bname">{familyLabelFull(m.family, t)}</span>
                <span class="btrack">
                  <i class="bfill" style="width:{Math.min(100, (m.share / maxMix) * 100)}%"></i>
                  <i class="bnat" style="left:{Math.min(100, (m.national / maxMix) * 100)}%"></i>
                </span>
                <span class="bval num">{share(m.share, 1)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <aside class="side card">
    <div class="pad">
      <div class="lbl">{t('names.picker')}</div>
      <input class="filter" bind:value={q} placeholder={t('names.filter_placeholder')}
             aria-label={t('names.filter_placeholder')} />
    </div>
    <div class="hits scroll">
      {#each hits as n (n.ka)}
        <button class="hit" class:on={n.ka === entry?.ka} onclick={() => pick(n)}>
          <span class="ka">{n.ka}</span>
          <span class="g tiny mut">{t(`names.gender_${n.gender}`)}</span>
          <span class="grow"></span>
          <span class="num tiny mut">{num(n.voters)}</span>
        </button>
      {:else}
        <p class="tiny mut pad">{t('search.no_results', { query: q })}</p>
      {/each}
    </div>
  </aside>
</div>

<style>
  .wrap { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; padding: 12px;
    flex-grow: 1; min-height: 0; }
  .main { display: flex; flex-direction: column; gap: 12px; }
  .side { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .pad { padding: 11px; }
  h1 { font-size: 25px; font-weight: 600; margin: 0; }
  .meta { margin-top: 2px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 11px;
    border-top: 1px solid var(--hair); padding-top: 10px; }
  .big { font-size: 19px; font-weight: 600; margin-top: 2px; }
  .note { margin: 2px 0 8px; }

  /* Drawn in a 100x100 box and stretched to fit, so every stroke needs
     non-scaling-stroke or it is squashed along with the geometry. */
  .chart { width: 100%; height: 150px; display: block; overflow: visible; }
  .fill { fill: var(--accent); opacity: .13; }
  .line { fill: none; stroke: var(--accent); stroke-width: 1.6px; stroke-linejoin: round; }
  .peak { stroke: var(--ink3); stroke-width: 1px; stroke-dasharray: 2 2; }
  .axis { position: relative; height: 14px; margin-top: 2px; }
  .axis span { position: absolute; transform: translateX(-50%); }
  .scaleline { margin: 4px 0 0; }

  /* Fixed height and no shrink: overflow:hidden switches off a flex item's
     content floor, and this column has a long table under it. */
  .map { position: relative; flex: 0 0 auto; height: 380px; overflow: hidden; }
  .overlay { position: absolute; z-index: 5; }
  .tl { top: 10px; left: 10px; }
  .bl { bottom: 22px; left: 10px; }

  .filter { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 6px 8px; font: inherit;
    font-size: 12.5px; border: 1px solid var(--rule); border-radius: 3px; background: var(--paper); }
  .hits { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 0 6px 8px; }
  .hit { display: flex; align-items: baseline; gap: 7px; width: 100%; text-align: left;
    padding: 5px 6px; background: none; border: 0; border-radius: 2px; cursor: pointer; color: inherit; }
  .hit:hover { background: var(--sunk); }
  .hit.on { background: var(--ink); color: var(--paper); }
  .grow { flex-grow: 1; }
  .ka { font-size: 13.5px; font-weight: 500; }

  .bars { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
  .bar { display: grid; grid-template-columns: 140px minmax(0, 1fr) 46px; align-items: center;
    gap: 8px; min-height: 15px; }
  .bname { font-size: 11px; line-height: 1.35; color: var(--ink2); overflow-wrap: anywhere; }
  .btrack { position: relative; height: 9px; background: var(--sunk); border-radius: 2px; }
  .bfill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 2px; display: block; }
  .bnat { position: absolute; top: -2px; bottom: -2px; width: 1.5px; background: var(--ink2); opacity: .55; display: block; }
  .bval { font-size: 10.5px; color: var(--ink2); text-align: right; }
  tr.off td { color: var(--ink3); }

  @media (max-width: 980px) {
    .wrap { display: flex; flex-direction: column; overflow-y: auto; }
    .main { overflow: visible; min-height: auto; }
    /* flex: 0 0 auto, not just a max-height. .side carries overflow:hidden,
       which switches off a flex item's automatic minimum size, so stacked under
       a 1,600px column it loses the shrink outright and collapses to a pixel —
       the same trap the explore map fell into. */
    .side { flex: 0 0 auto; height: 380px; min-height: auto; }
    .tiles { grid-template-columns: 1fr 1fr; }
  }
</style>
