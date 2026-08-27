<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getAggBucket } from '../lib/data.js'
  import { areaProfile } from '../lib/metrics.js'
  import { num, times, pct } from '../lib/format.js'
  import MapView from '../components/MapView.svelte'
  import { SHOW_1997 } from '../lib/features.js'
  import { colorOf, labelKey, legend as suffixLegend } from '../lib/suffix.js'

  let { index, areas, meta } = $props()

  let tab = $state('signature')
  let geo = $derived(nav.geo)
  let list = $derived(areas[geo] ?? [])

  let buckets = $state(null)
  $effect(() => {
    const need = [...new Set(index.list.map((s) => s.bucket))]
    Promise.all(need.map((b) => getAggBucket(b).then((d) => [b, d]))).then((pairs) => {
      buckets = Object.fromEntries(pairs)
    })
  })

  // The signature: each area's most over-represented surname.
  let signature = $derived.by(() => {
    if (!buckets) return []
    return list.map((area) => {
      const p = areaProfile({ buckets, index, area, geo, meta })
      return { area, top: p.distinctive[0] ?? null }
    })
  })

  let mapRows = $derived(signature.map((s) => ({
    area: s.area, suppressed: false, value: s.top?.entry.suffix ?? null,
  })))
  const scale = { color: colorOf }

  function tooltip(row, f) {
    const s = signature.find((x) => x.area.code === f.id)
    if (!s?.top) return `<b>${areaName(f.properties)}</b>`
    return `<b>${areaName(f.properties)}</b><br>
      <span style="font-size:13px">${s.top.entry.ka}</span>
      <span style="color:#6b665e"> ${times(s.top.lq)}</span>`
  }

  let ranked = $derived([...index.list].sort((a, b) => a.rank - b.rank))
  let excludedPct = $derived.by(() => {
    const { surnames, surnames_ranked } = meta.totals
    if (!surnames || surnames_ranked == null) return '—'
    return `${Math.round((1 - surnames_ranked / surnames) * 100)}%`
  })
  let shown = $state(20)
</script>

<div class="wrap">
  <div class="tabs">
    <button class:on={tab === 'top'} onclick={() => (tab = 'top')}>{t('explore.tab.top')}</button>
    <button class:on={tab === 'signature'} onclick={() => (tab = 'signature')}>{t('explore.tab.signature')}</button>
    <span class="grow"></span>
  </div>

  <div class="body" class:wide={tab === 'top'}>
    {#if tab === 'signature'}
    <section class="card map">
      <div class="cap">
        <div class="title">{t('explore.signature_title')}</div>
        <div class="tiny mut">{t('explore.signature_note', { min: meta.suppression.min_count_for_lq })}</div>
      </div>
      <div class="canvas">
        <MapView {geo} rows={mapRows} {scale} showKde={false} fillOpacity={0.9} {tooltip}
          onpick={(code) => { const a = list.find((x) => x.code === code); if (a) go({ view: 'region', a: geo, b: a.id }) }} />
      </div>
      <div class="key">
        <span class="lbl">{t('explore.suffix_family')}</span>
        {#each suffixLegend as { family, color }}
          <span class="kk tiny"><i style="background:{color}"></i>{t(labelKey(family))}</span>
        {/each}
      </div>
      <!-- The fills sit below 3:1 against the map surface, so colour alone does
           not carry this. Every area is named here with its surname in words. -->
      <div class="relief scroll">
        <table>
          <thead>
            <tr>
              <th>{t(geo === 'dis' ? 'table.district' : 'table.municipality')}</th>
              <th>{t('table.surname')}</th>
              <th>{t('explore.suffix_family')}</th>
              <th class="r">{t('table.concentration')}</th>
            </tr>
          </thead>
          <tbody>
            {#each signature as s (s.area.code)}
              <tr class="link" onclick={() => go({ view: 'region', a: geo, b: s.area.id })}>
                <td>{areaName(s.area)}</td>
                <td>{#if s.top}<span class="ka">{s.top.entry.ka}</span>{:else}<span class="mut">—</span>{/if}</td>
                <td class="tiny">
                  {#if s.top}
                    <i class="sw" style="background:{colorOf(s.top.entry.suffix)}"></i>{t(labelKey(s.top.entry.suffix))}
                  {/if}
                </td>
                <td class="r num tiny">{s.top ? times(s.top.lq) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
    {/if}

    <aside class="card side scroll">
      <div class="row">
        <div class="lbl">{t('explore.national_top', { n: ranked.length })}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:22px">#</th><th>{t('table.surname')}</th>
            <th class="r">{t('table.voters')}</th>
            {#if SHOW_1997}<th class="r">{t('table.rank_change')}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each ranked.slice(0, shown) as s (s.ka)}
            <tr class="link" onclick={() => go({ view: 'surname', a: s.ka })}>
              <td class="tiny mut">{s.rank}</td>
              <td><span class="ka">{s.ka}</span><br /><span class="mut tiny">{s.latin}</span></td>
              <td class="r num">{num(s.voters)}</td>
              {#if SHOW_1997}
                <td class="r num tiny" class:up={s.rank1997 > s.rank} class:down={s.rank1997 < s.rank}>
                  {s.rank1997 === s.rank ? '—' : (s.rank1997 > s.rank ? '▲ ' : '▼ ') + Math.abs(s.rank1997 - s.rank)}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if shown < ranked.length}
        <button class="btn" onclick={() => (shown += 20)}>{t('table.load_more', { n: 20 })}</button>
      {/if}
      <p class="tiny mut foot">{t('explore.excluded_note', {
        total: num(meta.totals.surnames), pct: excludedPct, n: 10 })}</p>
    </aside>
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; flex-grow: 1; min-height: 0; padding: 12px; gap: 10px; }
  .tabs { display: flex; gap: 4px; align-items: center; }
  .tabs button { background: none; border: 0; padding: 6px 10px; font-size: 12.5px; color: var(--ink2);
    cursor: pointer; border-bottom: 2px solid transparent; }
  .tabs button.on { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; flex-grow: 1; min-height: 0; }
  .body.wide { grid-template-columns: minmax(0, 1fr); }
  .map { display: flex; flex-direction: column; overflow: hidden; }
  .cap { padding: 12px 14px 8px; }
  .title { font-size: 15px; font-weight: 600; }
  .canvas { position: relative; flex-grow: 1; min-height: 0; }
  .key { display: flex; align-items: center; gap: 14px; padding: 9px 14px; border-top: 1px solid var(--hair); flex-wrap: wrap; }
  .kk { display: flex; align-items: center; gap: 5px; color: var(--ink2); }
  .kk i { width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(34,32,29,.14); display: block; }
  .relief { border-top: 1px solid var(--hair); max-height: 190px; flex-shrink: 0; padding: 0 14px 8px; }
  .relief th { position: sticky; top: 0; background: var(--card); }
  .sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; margin-right: 5px;
    border: 1px solid rgba(34,32,29,.14); vertical-align: -1px; }
  .side { padding: 13px; display: flex; flex-direction: column; gap: 8px; }
  .ka { font-size: 13px; }
  .up { color: var(--accent); font-weight: 600; }
  .down { color: var(--warm); font-weight: 600; }
  .foot { border-top: 1px dashed var(--rule); padding-top: 8px; margin: 4px 0 0; }
  @media (max-width: 980px) {
    .wrap { overflow-y: auto; }
    .body { display: flex; flex-direction: column; }
    .side { overflow: visible; min-height: auto; }
    .canvas { min-height: 320px; }
  }
</style>
