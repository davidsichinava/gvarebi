<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getProfiles, getSuffix } from '../lib/data.js'
  import { suffixMix, rate } from '../lib/metrics.js'
  import { familyLabel, familyLabelFull } from '../lib/suffix.js'
  import { num, pct, times } from '../lib/format.js'
  import { SEQ } from '../lib/colors.js'
  import MapView from '../components/MapView.svelte'
  import { SHOW_1997 } from '../lib/features.js'

  let { index, areas, meta } = $props()

  let geo = $derived(nav.geo)
  let list = $derived(areas[geo] ?? [])
  let area = $derived(list.find((a) => a.id === nav.b) ?? list[0])

  // The per-area rankings are precomputed — build.R writes them once instead of
  // the front end fetching all 256 agg buckets and walking 69,290 surnames on
  // every visit. The comment that used to sit here said this was what should
  // happen at real scale; at real scale it had to.
  let profiles = $state(null)
  $effect(() => {
    const want = geo
    profiles = null
    getProfiles(want).then((p) => { if (geo === want) profiles = p })
  })

  let suffixData = $state(null)
  $effect(() => { getSuffix().then((d) => (suffixData = d)) })

  let profile = $derived.by(() => {
    const raw = profiles && area ? profiles[area.id] : null
    if (!raw) return null
    const hydrate = ([ka, count, quotient]) => {
      const entry = index.byKa.get(ka)
      return entry ? { entry, count, rate: rate(count, area.voters), lq: quotient ?? null, before: null } : null
    }
    return {
      common: (raw.common ?? []).map(hydrate).filter(Boolean),
      distinctive: (raw.distinctive ?? []).map(hydrate).filter(Boolean),
      distinct: raw.distinct ?? 0,
    }
  })

  // From the precomputed family tallies, not from the top-25 rankings: a mix
  // derived from the head of the list is not the mix of the area.
  // Every family, not a top-six with the rest lumped into "other" — the chart is
  // a list of bars now, so it has room for all of them.
  let mix = $derived(
    suffixData && area ? suffixMix(suffixData[geo]?.[area.id], suffixData.national, 99) : []
  )
  let top10share = $derived(
    profiles && area && area.voters > 0 ? (profiles[area.id]?.top10 ?? 0) / area.voters : null
  )
  let rollChange = $derived(
    area?.voters_1997 ? (area.voters - area.voters_1997) / area.voters_1997 : null
  )

  // Bars and national ticks share one scale, so a tick past its bar means
  // under-represented and vice versa.
  let maxShare = $derived(Math.max(0.01, ...mix.map((m) => Math.max(m.share, m.national))))

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
      <!-- One bar per family, longest first. The two stacked strips this replaced
           could not be read: nineteen segments in a 24px bar, most of them a few
           pixels wide, with a caption explaining which strip was which. The tick
           on each bar marks the same family's national share, so over- and
           under-representation is visible without a second chart. -->
      <div class="bars">
        {#each mix as m}
          <div class="bar" title="{familyLabelFull(m.suffix, t)} · {(m.share * 100).toFixed(1)}% {t('region.here_vs_national', { national: (m.national * 100).toFixed(1) })}">
            <span class="bname">{familyLabel(m.suffix, t)}</span>
            <span class="btrack">
              <i class="bfill" style="width:{Math.min(100, (m.share / maxShare) * 100)}%"></i>
              <i class="bnat" style="left:{Math.min(100, (m.national / maxShare) * 100)}%"></i>
            </span>
            <span class="bval num">{(m.share * 100).toFixed(1)}%</span>
          </div>
        {/each}
      </div>
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
  .wrap { display: grid; grid-template-columns: minmax(0, 1fr) 470px; gap: 12px; padding: 12px;
    flex-grow: 1; min-height: 0; }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .main { display: flex; flex-direction: column; gap: 10px; background: var(--card);
    border: 1px solid var(--rule); border-radius: 3px; padding: 14px; }
  .pad { padding: 11px; }
  /* Fixed, not flexible. Letting it grow starved the nineteen bars underneath —
     they were squeezed into a strip and became unreadable. The column scrolls
     instead, which is what the scroll class on .side is for. */
  .map { position: relative; flex: 0 0 auto; height: 430px; overflow: hidden; }
  .hint { position: absolute; bottom: 8px; left: 8px; background: rgba(255,253,250,.92);
    padding: 4px 7px; border-radius: 2px; z-index: 4; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .big { font-size: 20px; font-weight: 600; margin-top: 2px; }
  .big.down { color: var(--warm); }
  .bars { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
  .bar { display: grid; grid-template-columns: 96px minmax(0, 1fr) 42px;
    align-items: center; gap: 8px; min-height: 15px; }
  .bname { font-size: 11px; line-height: 1.35; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btrack { position: relative; height: 9px; background: var(--sunk); border-radius: 2px; }
  .bfill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 2px; display: block; }
  /* the same family's national share, so the bar has something to be read against */
  .bnat { position: absolute; top: -2px; bottom: -2px; width: 1.5px; background: var(--ink2); opacity: .55; display: block; }
  .bval { font-size: 10.5px; line-height: 1.35; color: var(--ink2); text-align: right; }
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
