<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getSurname, getKde } from '../lib/data.js'
  import { areaSeries, valueOf } from '../lib/metrics.js'
  import { scaleFor } from '../lib/colors.js'
  import { num, pct, times, metricValue } from '../lib/format.js'
  import MapView from '../components/MapView.svelte'
  import { SHOW_1997 } from '../lib/features.js'
  import LayerPanel from '../components/LayerPanel.svelte'
  import Legend from '../components/Legend.svelte'

  let { index, areas, meta } = $props()

  // Georgian first — it is the route key. The latin lookup stays as a fallback
  // so links minted before the switch still resolve, accepting that a colliding
  // transliteration lands on whichever surname the index holds for it.
  let entry = $derived(index.byKa.get(nav.a) ?? index.byLatin.get(nav.a) ?? index.list[0])
  let record = $state(null)
  let kdeCells = $state(null)

  $effect(() => {
    const e = entry
    if (!e) return
    record = null; kdeCells = null
    getSurname(e).then((r) => { if (entry === e) record = r })
    getKde(e).then((c) => { if (entry === e) kdeCells = c })
  })

  let rows = $derived(
    record ? areaSeries({ record, entry, areas, geo: nav.geo, src: nav.src, meta }) : []
  )
  let valued = $derived(rows.map((r) => ({ ...r, value: valueOf(r, nav.metric) })))
  let scale = $derived(scaleFor(nav.metric, valued.map((r) => r.value)))
  let anySuppressed = $derived(valued.some((r) => r.suppressed))

  let sortKey = $state('auto')
  let sorted = $derived.by(() => {
    const key = sortKey === 'auto' ? nav.metric : sortKey
    const pick = (r) => (key === 'count' ? r.count : key === 'rate' ? r.rate : key === 'change' ? r.change : r.lq)
    return [...valued].sort((a, b) => {
      if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1
      return (pick(b) ?? -Infinity) - (pick(a) ?? -Infinity)
    })
  })

  let top = $derived(sorted.filter((r) => !r.suppressed && r.lq != null).slice(0, 4))
  let lead = $derived(top[0])

  let change = $derived(
    entry && entry.voters1997 ? (entry.voters - entry.voters1997) / entry.voters1997 : null
  )

  let showBase = $state(true), showFills = $state(true), showKde = $state(true)
  let fillOpacity = $state(0.8), kdeOpacity = $state(0.75)

  function tooltip(row, f) {
    const label = areaName(f.properties)
    if (!row) return `<b>${label}</b>`
    if (row.suppressed)
      return `<b>${label}</b><br><span style="color:#6b665e">${t('value.suppressed_long', { k: meta.suppression.k })}</span>`
    return `<b>${label}</b>
      <div style="margin-top:5px;display:grid;grid-template-columns:auto auto;gap:1px 12px">
        <span style="color:#6b665e">${t('table.voters')}</span><b style="text-align:right">${num(row.count)}</b>
        <span style="color:#6b665e">${t('metric.rate')}</span><b style="text-align:right">${num(row.rate, 1)}</b>
        <span style="color:#6b665e">${t('metric.lq')}</span><b style="text-align:right">${row.lq == null ? '—' : times(row.lq)}</b>
      </div>`
  }

  const areaByCode = $derived(new Map((areas[nav.geo] ?? []).map((a) => [a.code, a])))
  function pickArea(code) {
    const a = areaByCode.get(code)
    if (a) go({ view: 'region', a: nav.geo, b: a.id })
  }
</script>

<div class="wrap">
  <!-- identity + stats -->
  <aside class="side scroll">
    <div class="card pad">
      <div class="ka big">{entry?.ka}</div>
      <div class="latin mut">{entry?.latin}</div>
      <div class="chips">
        <span class="chip">{t(`suffix.${entry?.suffix}`)}</span>
        {#if t(`suffix.${entry?.suffix}.region`) !== `suffix.${entry?.suffix}.region`}
          <span class="chip">{t(`suffix.${entry?.suffix}.region`)}</span>
        {/if}
      </div>
    </div>

    <div class="card pad stats">
      <div class="lbl">{t('surname.at_a_glance')}</div>
      <div class="stat"><span class="mut">{t('source.voters')}</span><b class="num big2">{num(entry?.voters)}</b></div>
      <div class="stat"><span class="mut">{t('surname.national_rank')}</span>
        <b>#{entry?.rank} <span class="mut tiny">{t('surname.rank_of', { total: num(meta.totals.surnames) })}</span></b></div>
      <div class="stat"><span class="mut">{t('surname.per_1000')}</span>
        <b class="num">{num((entry?.voters / meta.totals.voters) * 1000, 1)}</b></div>
      {#if SHOW_1997}
        <div class="stat"><span class="mut">{t('source.book1997')}</span>
          <b class="num">{num(entry?.voters1997)}
            {#if change != null}<span class="delta" class:down={change < 0}>{pct(change)}</span>{/if}</b></div>
      {/if}
    </div>

    <div class="card pad">
      <div class="lbl">{t('surname.concentrated_in')}</div>
      <div class="tiny mut sub">{t('surname.concentrated_note')}</div>
      {#each top as r}
        <div class="conc">
          <div class="row"><span>{areaName(r.area)}</span><span class="grow"></span><b class="num">{times(r.lq)}</b></div>
          <div class="bar"><i style="width:{Math.min(100, (r.lq / (top[0]?.lq || 1)) * 100)}%"></i></div>
        </div>
      {:else}
        <div class="tiny mut sub">{t('surname.no_concentration')}</div>
      {/each}
      {#if lead}
        <p class="lead">{t('surname.lead', { surname: entry.ka, factor: lead.lq.toFixed(1), area: areaName(lead.area) })}</p>
      {/if}
    </div>
  </aside>

  <!-- map -->
  <section class="map card">
    <MapView
      geo={nav.geo}
      rows={valued}
      {scale}
      {kdeCells}
      grid={meta.kde.grid}
      {showBase} {showFills} {showKde} {fillOpacity} {kdeOpacity}
      {tooltip}
      onpick={pickArea}
    />
    <div class="overlay tl"><LayerPanel bind:showBase bind:showFills bind:showKde bind:fillOpacity bind:kdeOpacity hasKde={!!kdeCells?.length} /></div>
    <div class="overlay bl"><Legend {scale} metric={nav.metric} k={meta.suppression.k} {anySuppressed} /></div>
  </section>

  <!-- ranked areas -->
  <aside class="side scroll">
    <div class="card pad tablecard">
      <div class="row">
        <div class="lbl">{t('table.showing', { n: valued.length, total: valued.length })}</div>
        <span class="grow"></span>
        {#if anySuppressed}
          <a class="tiny mut" href="#/method">{t('table.areas_suppressed', {
            n: valued.filter((r) => r.suppressed).length, total: valued.length, k: meta.suppression.k })}</a>
        {/if}
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:16px"></th>
            <th>{nav.geo === 'mun' ? t('table.municipality') : t('table.district')}</th>
            <th class="r"><button class="sortbtn" onclick={() => (sortKey = 'count')}>{t('table.voters')}</button></th>
            <th class="r"><button class="sortbtn" onclick={() => (sortKey = nav.metric === 'change' ? 'change' : 'lq')}>
              {nav.metric === 'change' ? t('source.change') : t('table.concentration')}</button></th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as r, i (r.area.id)}
            <tr class="link" class:off={r.suppressed} onclick={() => go({ view: 'region', a: nav.geo, b: r.area.id })}>
              <td class="tiny mut">{r.suppressed ? '—' : i + 1}</td>
              <td>{areaName(r.area)}</td>
              {#if r.suppressed}
                <td class="r tiny" colspan="2">{t('value.suppressed_long', { k: meta.suppression.k })}</td>
              {:else}
                <td class="r num">{num(r.count)}</td>
                <td class="r num"><b>{metricValue(r, nav.metric === 'change' ? 'change' : 'lq')}</b></td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !rows.length}
        <p class="tiny mut">{nav.src !== 'voters' && nav.geo === 'dis' ? t('geo.districts_1997_note') : t('search.no_results', { query: nav.a })}</p>
      {/if}
    </div>
  </aside>
</div>

<style>
  .wrap { display: grid; grid-template-columns: 290px minmax(0, 1fr) 320px; gap: 12px;
    padding: 12px; flex-grow: 1; min-height: 0; }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .pad { padding: 13px; }
  .big { font-size: 30px; font-weight: 600; line-height: 1.05; }
  .big2 { font-size: 20px; }
  .latin { font-size: 14px; margin-top: 1px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .chip { border: 1px solid var(--rule); border-radius: 2px; padding: 3px 7px; font-size: 10px; color: var(--ink2); }
  .stats { display: flex; flex-direction: column; gap: 8px; }
  .stat { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 11.5px; }
  .stat + .stat { border-top: 1px solid var(--hair); padding-top: 8px; }
  .stat b { font-size: 14px; }
  .delta { color: var(--accent); font-size: 10.5px; font-weight: 600; }
  .delta.down { color: var(--warm); }
  .sub { margin: -2px 0 8px; }
  .conc { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; font-size: 12px; }
  .lead { font-size: 12px; color: var(--ink2); border-top: 1px dashed var(--rule); padding-top: 9px; margin: 4px 0 0; }
  .map { position: relative; overflow: hidden; min-height: 0; }
  .overlay { position: absolute; z-index: 5; }
  .tl { top: 10px; left: 10px; }
  .bl { bottom: 22px; left: 10px; }
  .tablecard { display: flex; flex-direction: column; gap: 8px; }
  .sortbtn { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .sortbtn:hover { color: var(--ink); }
  @media (max-width: 1180px) {
    .wrap { grid-template-columns: 260px minmax(0, 1fr); }
    .wrap > aside:last-child { grid-column: 1 / -1; max-height: 280px; }
  }
  @media (max-width: 820px) {
    /* One column, one scroller: nested overflow panes clip badly on a phone. */
    .wrap { display: flex; flex-direction: column; overflow-y: auto; }
    .side { overflow: visible; min-height: auto; }
    .map { height: 320px; flex-shrink: 0; }
    .bl { bottom: 10px; }
  }
</style>
