<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getAggBucket } from '../lib/data.js'
  import { areaProfile, suffixMix } from '../lib/metrics.js'
  import { num, pct, times } from '../lib/format.js'
  import { SEQ } from '../lib/colors.js'
  import MapView from '../components/MapView.svelte'
  import { SHOW_1997 } from '../lib/features.js'

  let { index, areas, meta } = $props()

  let geo = $derived(nav.geo)
  let list = $derived(areas[geo] ?? [])
  let area = $derived(list.find((a) => a.id === nav.b) ?? list[0])

  // Every bucket that holds at least one surname — at real scale this would be
  // a precomputed per-area file instead of a fan-out over buckets.
  let buckets = $state(null)
  $effect(() => {
    const need = [...new Set(index.list.map((s) => s.bucket))]
    Promise.all(need.map((b) => getAggBucket(b).then((d) => [b, d]))).then((pairs) => {
      buckets = Object.fromEntries(pairs)
    })
  })

  let profile = $derived(
    buckets && area ? areaProfile({ buckets, index, area, geo, meta }) : null
  )
  let mix = $derived(profile ? suffixMix(profile.common, index) : [])
  let top10share = $derived(
    profile && area ? profile.common.slice(0, 10).reduce((a, r) => a + r.count, 0) / area.voters : null
  )
  let rollChange = $derived(
    area?.voters_1997 ? (area.voters - area.voters_1997) / area.voters_1997 : null
  )

  let tab = $state('distinctive')

  const areaByCode = $derived(new Map(list.map((a) => [a.code, a])))
  let mapRows = $derived(list.map((a) => ({ area: a, suppressed: false, value: a.id === area?.id ? 1 : 0 })))
  const scale = { color: (v) => (v ? '#4a6ea8' : '#e4e0d8') }
</script>

<div class="wrap">
  <aside class="side scroll">
    <div class="card map">
      <MapView
        {geo}
        rows={mapRows}
        {scale}
        fillOpacity={0.85}
        showKde={false}
        selected={area?.code}
        onpick={(code) => { const a = areaByCode.get(code); if (a) go({ view: 'region', a: geo, b: a.id }) }}
      />
      <div class="hint tiny mut">{t('region.pick_hint')}</div>
    </div>

    <div class="tiles">
      <div class="card pad"><div class="lbl">{t('region.voters_on_roll')}</div><div class="big num">{num(area?.voters)}</div></div>
      <div class="card pad"><div class="lbl">{t('region.distinct_surnames')}</div><div class="big num">{num(profile?.distinct)}</div></div>
      <div class="card pad"><div class="lbl">{t('region.top10_share')}</div><div class="big num">{top10share == null ? '—' : (top10share * 100).toFixed(1) + '%'}</div></div>
      {#if SHOW_1997}
        <div class="card pad"><div class="lbl">{t('region.since_1997')}</div><div class="big num" class:down={rollChange < 0}>{pct(rollChange)}</div></div>
      {/if}
    </div>

    <div class="card pad">
      <div class="lbl">{t('region.suffix_signature')}</div>
      <div class="stack" style="margin-top:8px">
        {#each mix as m, i}
          <span style="width:{m.share * 100}%;background:{SEQ[Math.min(SEQ.length - 1, i + 1)]}"
                title="{t(`suffix.${m.suffix}`)} {(m.share * 100).toFixed(0)}%">
            {#if m.share > 0.12}<span class="pctlab">{t(`suffix.${m.suffix}`)} {(m.share * 100).toFixed(0)}%</span>{/if}
          </span>
        {/each}
      </div>
      <div class="stack ghost">
        {#each mix as m, i}
          <span style="width:{m.national * 100}%;background:{SEQ[Math.min(SEQ.length - 1, i + 1)]}"></span>
        {/each}
      </div>
      <div class="tiny mut" style="margin-top:5px">{t('region.suffix_compare', { area: areaName(area) })}</div>
    </div>
  </aside>

  <section class="main scroll">
    <div class="head">
      <div class="crumb tiny mut">{t('region.breadcrumb_root')}{area?.parent_en ? ` › ${area.parent_en}` : ''} ›</div>
      <h1>{areaName(area)}</h1>
    </div>

    <div class="tabs">
      <button class:on={tab === 'common'} onclick={() => (tab = 'common')}>{t('region.most_common')}</button>
      <button class:on={tab === 'distinctive'} onclick={() => (tab = 'distinctive')}>{t('region.most_distinctive')}</button>
      {#if SHOW_1997}
        <button class:on={tab === 'movers'} onclick={() => (tab = 'movers')}>{t('region.movers')}</button>
      {/if}
    </div>

    <p class="note tiny mut">
      {tab === 'common' ? t('region.most_common_note')
        : tab === 'distinctive' ? t('region.most_distinctive_note')
        : t('region.movers_note')}
    </p>

    {#if !profile}
      <p class="tiny mut">…</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th style="width:20px"></th>
            <th>{t('table.surname')}</th>
            <th class="r">{t('table.voters')}</th>
            <th class="r">{t('table.per_1000')}</th>
            <th class="r">{tab === 'movers' ? t('source.change') : t('table.concentration')}</th>
          </tr>
        </thead>
        <tbody>
          {#each (tab === 'common' ? profile.common : tab === 'distinctive' ? profile.distinctive : [...profile.common].sort((a, b) => {
            const ca = a.before ? (a.count - a.before) / a.before : -Infinity
            const cb = b.before ? (b.count - b.before) / b.before : -Infinity
            return cb - ca
          })).slice(0, 20) as r, i (r.entry.ka)}
            <tr class="link" onclick={() => go({ view: 'surname', a: r.entry.ka })}>
              <td class="tiny mut">{i + 1}</td>
              <td><span class="ka">{r.entry.ka}</span> <span class="mut tiny">{r.entry.latin}</span></td>
              <td class="r num">{num(r.count)}</td>
              <td class="r num">{num(r.rate, 1)}</td>
              <td class="r num"><b>
                {#if tab === 'movers'}
                  {r.before ? pct((r.count - r.before) / r.before) : '—'}
                {:else}
                  {r.lq == null ? '—' : times(r.lq)}
                {/if}
              </b></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .wrap { display: grid; grid-template-columns: 400px minmax(0, 1fr); gap: 12px; padding: 12px;
    flex-grow: 1; min-height: 0; }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .main { display: flex; flex-direction: column; gap: 10px; background: var(--card);
    border: 1px solid var(--rule); border-radius: 3px; padding: 14px; }
  .pad { padding: 11px; }
  .map { position: relative; height: 280px; overflow: hidden; flex-shrink: 0; }
  .hint { position: absolute; bottom: 8px; left: 8px; background: rgba(255,253,250,.92);
    padding: 4px 7px; border-radius: 2px; z-index: 4; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .big { font-size: 20px; font-weight: 600; margin-top: 2px; }
  .big.down { color: var(--warm); }
  .stack { display: flex; height: 24px; border-radius: 2px; overflow: hidden; }
  .stack.ghost { height: 8px; opacity: 0.45; margin-top: 4px; }
  .stack span { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .pctlab { font-size: 9.5px; font-weight: 600; color: #fff; white-space: nowrap; }
  .head h1 { font-size: 24px; font-weight: 600; margin: 2px 0 0; }
  .crumb { margin-bottom: 2px; }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); }
  .tabs button { background: none; border: 0; padding: 8px 12px; font-size: 12.5px; color: var(--ink2);
    cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button.on { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }
  .note { margin: 0; }
  .ka { font-size: 13px; }
  @media (max-width: 980px) {
    .wrap { display: flex; flex-direction: column; overflow-y: auto; }
    .side, .main { overflow: visible; min-height: auto; }
    .tiles { grid-template-columns: 1fr 1fr; }
  }
</style>
