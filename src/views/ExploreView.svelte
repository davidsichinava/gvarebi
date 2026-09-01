<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'
  import { getProfiles, getSuffix } from '../lib/data.js'
  import { num, times } from '../lib/format.js'
  import { scaleFor } from '../lib/colors.js'
  import { byMetric } from '../lib/metrics.js'
  import MapView from '../components/MapView.svelte'
  import Legend from '../components/Legend.svelte'
  import { SHOW_1997 } from '../lib/features.js'
  import { colorOf, isHatched, familyLabel, familyLabelFull, legend as suffixLegend } from '../lib/suffix.js'

  let { index, areas, meta } = $props()

  let tab = $state('signature')
  // Explore renders no geography toggle, so following nav.geo meant these maps
  // silently inherited whatever the surname or region view was last set to.
  // They are fixed to electoral districts: it is the finer of the two levels we
  // hold, and every one of them has a profile.
  const geo = 'dis'
  let list = $derived(areas[geo] ?? [])

  // Precomputed by build.R. This used to fetch all 256 agg buckets (~9 MB) and
  // then walk 69,290 surnames once per area — 4.6 million iterations before the
  // map could draw. None of it depended on anything the reader does.
  let profiles = $state(null)
  $effect(() => {
    const want = geo
    profiles = null
    getProfiles(want).then((p) => { if (geo === want) profiles = p })
  })

  let suffixData = $state(null)
  $effect(() => { getSuffix().then((d) => (suffixData = d)) })

  // ------------------------------------------------------------- signature
  let signature = $derived.by(() => {
    if (!profiles) return []
    return list.map((area) => {
      const top = profiles[area.id]?.distinctive?.[0]
      if (!top) return { area, top: null }
      const [ka, count, quotient] = top
      return { area, top: { ka, count, lq: quotient, entry: index.byKa.get(ka) ?? null } }
    })
  })

  // The same shape as the signature, but ranked by size rather than by quotient:
  // the commonest surname in each district, coloured by its family.
  let leading = $derived.by(() => {
    if (!profiles) return []
    return list.map((area) => {
      const top = profiles[area.id]?.common?.[0]
      if (!top) return { area, top: null }
      const [ka, count] = top
      return { area, top: { ka, count, entry: index.byKa.get(ka) ?? null } }
    })
  })

  let leadRows = $derived(leading.map((s) => ({
    area: s.area, suppressed: false, value: s.top?.entry?.suffix ?? null,
  })))

  function leadTip(row, f) {
    const s = leading.find((x) => x.area.code === f.id)
    if (!s?.top) return `<b>${areaName(f.properties)}</b>`
    return `<b>${areaName(f.properties)}</b><br>
      <span style="font-size:13px">${s.top.ka}</span>
      <span style="color:#6b665e"> ${num(s.top.count)}</span>`
  }

  let sigRows = $derived(signature.map((s) => ({
    area: s.area, suppressed: false, value: s.top?.entry?.suffix ?? null,
  })))
  const sigScale = { color: colorOf }

  function sigTip(row, f) {
    const s = signature.find((x) => x.area.code === f.id)
    if (!s?.top) return `<b>${areaName(f.properties)}</b>`
    return `<b>${areaName(f.properties)}</b><br>
      <span style="font-size:13px">${s.top.ka}</span>
      <span style="color:#6b665e"> ${times(s.top.lq)}</span>`
  }

  // ------------------------------------------------------------- suffix map
  // One family at a time, against its own national share. Comparing families to
  // each other on a single map needs a categorical palette, and a choropleth can
  // carry only three hues before the colours stop being separable; comparing one
  // family to itself needs only the diverging quotient ramp the rest of the site
  // already uses, and it answers the more useful question anyway.
  let family = $state(null)
  $effect(() => {
    if (suffixData && (!family || !suffixData.families.includes(family))) {
      family = orderedFamilies[0] ?? suffixData.families[0]
    }
  })

  // build.R sorts families by national size, which puts the "other" catch-all in
  // the middle of the run. It reads as a family there; at the end it reads as
  // what it is.
  let orderedFamilies = $derived(
    suffixData ? [...suffixData.families.filter((f) => f !== 'other'),
                  ...suffixData.families.filter((f) => f === 'other')] : []
  )

  let suffixRows = $derived.by(() => {
    if (!suffixData || !family) return []
    const nat = suffixData.national?.[family] ?? 0
    const natVoters = meta.totals.voters
    const per = suffixData[geo] ?? {}
    return list.map((area) => {
      const n = per[area.id]?.[family]
      // Absent means the cell fell under k, or the family is not here at all —
      // the two are deliberately indistinguishable, which is the point of the
      // threshold. Either way there is no number to show.
      if (n == null) return { area, suppressed: true, count: null, value: null }
      const value = area.voters > 0 && nat > 0
        ? (n / area.voters) / (nat / natVoters) : null
      return { area, suppressed: false, count: n, value }
    })
  })

  let suffixScale = $derived(scaleFor('lq', suffixRows.map((r) => r.value)))
  let anySuffixSuppressed = $derived(suffixRows.some((r) => r.suppressed))
  // Same ordering rule as every other table: a withheld cell holds at least one
  // person, so it ranks above an area with none.
  let suffixSorted = $derived([...suffixRows].sort(byMetric((r) => r.value)))

  function suffixTip(row, f) {
    const r = suffixRows.find((x) => x.area.code === f.id)
    const label = areaName(f.properties)
    if (!r || r.suppressed) return `<b>${label}</b><br><span style="color:#6b665e">${t('value.suppressed_long', { k: meta.suppression.k })}</span>`
    return `<b>${label}</b><br>
      <span style="font-size:13px">${times(r.value)}</span>
      <span style="color:#6b665e"> · ${num(r.count)}</span>`
  }

  // ------------------------------------------------------------- rankings
  let ranked = $derived([...index.list].sort((a, b) => a.rank - b.rank))
  let excludedPct = $derived.by(() => {
    const { surnames, surnames_ranked } = meta.totals
    if (!surnames || surnames_ranked == null) return '—'
    return `${Math.round((1 - surnames_ranked / surnames) * 100)}%`
  })
  let shown = $state(20)
  const pickArea = (code) => { const a = list.find((x) => x.code === code); if (a) go({ view: 'region', a: geo, b: a.id }) }
</script>

<div class="wrap">
  <div class="tabs">
    <button class:on={tab === 'top'} onclick={() => (tab = 'top')}>{t('explore.tab.top')}</button>
    <button class:on={tab === 'signature'} onclick={() => (tab = 'signature')}>{t('explore.tab.signature')}</button>
    <button class:on={tab === 'suffix'} onclick={() => (tab = 'suffix')}>{t('explore.tab.suffix')}</button>
    <span class="grow"></span>
  </div>

  <div class="body">
    {#if tab === 'top'}
    <section class="card map">
      <div class="cap">
        <div class="title">{t('explore.top_title')}</div>
        <div class="tiny mut">{t('explore.suffix_family')}</div>
      </div>
      <div class="canvas">
        <MapView {geo} rows={leadRows} scale={sigScale} showKde={false} fillOpacity={1}
          hatched={(r) => isHatched(r.value)} tooltip={leadTip} onpick={pickArea} />
      </div>
      <div class="key">
        <span class="lbl">{t('explore.suffix_family')}</span>
        {#each suffixLegend as { family: fam, color, hatch }}
          <span class="kk tiny" title={familyLabelFull(fam, t)}><i class:hatch style="background-color:{color}"></i>{familyLabel(fam, t)}</span>
        {/each}
      </div>
      <div class="relief scroll">
        <table>
          <thead>
            <tr>
              <th>{t('table.district')}</th>
              <th>{t('table.surname')}</th>
              <th>{t('explore.suffix_family')}</th>
              <th class="r">{t('table.voters')}</th>
            </tr>
          </thead>
          <tbody>
            {#each leading as s (s.area.code)}
              <tr class="link" onclick={() => go({ view: 'region', a: geo, b: s.area.id })}>
                <td>{areaName(s.area)}</td>
                <td>{#if s.top}<span class="ka">{s.top.ka}</span>{:else}<span class="mut">—</span>{/if}</td>
                <td class="tiny" title={s.top?.entry ? familyLabelFull(s.top.entry.suffix, t) : ''}>
                  {#if s.top?.entry}
                    <i class="sw" class:hatch={isHatched(s.top.entry.suffix)}
                       style="background-color:{colorOf(s.top.entry.suffix)}"></i>{familyLabel(s.top.entry.suffix, t)}
                  {/if}
                </td>
                <td class="r num tiny">{s.top ? num(s.top.count) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
    {/if}

    {#if tab === 'signature'}
    <section class="card map">
      <div class="cap">
        <div class="title">{t('explore.signature_title')}</div>
        <div class="tiny mut">{t('explore.signature_note', { min: meta.suppression.min_count_for_lq })}</div>
      </div>
      <div class="canvas">
        <!-- Opaque, not 0.9: the fourth family only stays separable when the
             basemap is not mixed into the fills. See src/lib/suffix.js. -->
        <MapView {geo} rows={sigRows} scale={sigScale} showKde={false} fillOpacity={1}
          hatched={(r) => isHatched(r.value)} tooltip={sigTip} onpick={pickArea} />
      </div>
      <div class="key">
        <span class="lbl">{t('explore.suffix_family')}</span>
        {#each suffixLegend as { family: fam, color, hatch }}
          <span class="kk tiny" title={familyLabelFull(fam, t)}><i class:hatch style="background-color:{color}"></i>{familyLabel(fam, t)}</span>
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
                <td>{#if s.top}<span class="ka">{s.top.ka}</span>{:else}<span class="mut">—</span>{/if}</td>
                <td class="tiny" title={s.top?.entry ? familyLabelFull(s.top.entry.suffix, t) : ''}>
                  {#if s.top?.entry}
                    <i class="sw" class:hatch={isHatched(s.top.entry.suffix)}
                       style="background-color:{colorOf(s.top.entry.suffix)}"></i>{familyLabel(s.top.entry.suffix, t)}
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

    {#if tab === 'suffix'}
    <section class="card map">
      <div class="cap">
        <div class="title">{t('explore.tab.suffix')}{family ? ` · ${familyLabelFull(family, t)}` : ''}</div>
        <!-- Composed from keys that are already translated rather than adding an
             English-only string: the signature caption says "coloured by suffix
             family", which is what the OTHER map does, not this one. -->
        <div class="tiny mut">{t('legend.concentration')} · {t('value.suppressed_long', { k: meta.suppression.k })}</div>
      </div>
      {#if suffixData}
        <div class="picker">
          <span class="lbl">{t('explore.suffix_family')}</span>
          <div class="fams">
            {#each orderedFamilies as fam}
              <button class="fam" class:on={fam === family} onclick={() => (family = fam)}
                      title="{familyLabelFull(fam, t)} · {num(suffixData.national[fam])}">
                {familyLabel(fam, t)}
                <span class="cnt">{num(suffixData.national[fam])}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      <div class="canvas">
        <MapView {geo} rows={suffixRows} scale={suffixScale} showKde={false} fillOpacity={0.9}
          tooltip={suffixTip} onpick={pickArea} />
        <div class="overlay bl">
          <!-- The suffix map has no zero state: a family with no published cell here is
               withheld, and the two are deliberately indistinguishable. -->
          <Legend scale={suffixScale} metric="lq" k={meta.suppression.k}
            anySuppressed={anySuffixSuppressed} anyNoData={false} anyZero={false} />
        </div>
      </div>
      <div class="relief scroll">
        <table>
          <thead>
            <tr>
              <th>{t(geo === 'dis' ? 'table.district' : 'table.municipality')}</th>
              <th class="r">{t('table.voters')}</th>
              <th class="r">{t('table.concentration')}</th>
            </tr>
          </thead>
          <tbody>
            {#each suffixSorted as r (r.area.code)}
              <tr class="link" class:off={r.suppressed} onclick={() => go({ view: 'region', a: geo, b: r.area.id })}>
                <td>{areaName(r.area)}</td>
                <td class="r num">{r.suppressed ? '' : num(r.count)}</td>
                <td class="r num tiny">
                  {#if r.suppressed}
                    <span class="mut">{t('value.suppressed', { k: meta.suppression.k })}</span>
                  {:else}{times(r.value)}{/if}
                </td>
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
  .overlay { position: absolute; z-index: 2; }
  .overlay.bl { left: 12px; bottom: 12px; }
  .picker { display: flex; align-items: baseline; gap: 10px; padding: 0 14px 9px; }
  .fams { display: flex; flex-wrap: wrap; gap: 4px; }
  .fam { background: none; border: 1px solid var(--rule); border-radius: 3px; cursor: pointer;
    padding: 3px 7px; font-size: 11px; color: var(--ink2); display: flex; align-items: baseline; gap: 5px; }
  .fam.on { background: var(--ink); border-color: var(--ink); color: #fff; }
  .fam .cnt { font-size: 9.5px; opacity: .6; font-variant-numeric: tabular-nums; }
  .key { display: flex; align-items: center; gap: 14px; padding: 9px 14px; border-top: 1px solid var(--hair); flex-wrap: wrap; }
  .kk { display: flex; align-items: center; gap: 5px; color: var(--ink2); }
  .kk i { width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(34,32,29,.14); display: block; }
  /* Mirrors the map's 45-degree hatch so the key matches what is painted. */
  .hatch { background-image: repeating-linear-gradient(45deg,
    rgba(28,26,23,.42) 0 1.4px, transparent 1.4px 4px); background-blend-mode: normal; }
  .relief { border-top: 1px solid var(--hair); max-height: 190px; flex-shrink: 0; padding: 0 14px 8px; }
  .relief th { position: sticky; top: 0; background: var(--card); }
  .relief tr.off td { color: var(--ink3); }
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
    /* .map carries overflow:hidden, and that switches off the automatic minimum
       size a flex item otherwise gets from its own content. Stacked into a
       column whose height .wrap bounds, the ~1100px table beside it wins the
       shrink and the map collapses to a single pixel — the canvas underneath is
       still its full 320px, just clipped out of sight, which is why the tab
       looked like it had no map rather than a broken one. The min-height on
       .canvas cannot save it: the parent is what collapses. An explicit height
       with no shrink is what the region and surname views already do. */
    .map { flex: 0 0 auto; height: 360px; }
    /* Three Georgian labels do not fit 375px, and with no scroller the third is
       unreachable. Same treatment the header nav gets. */
    .tabs { overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs button { flex: 0 0 auto; white-space: nowrap; }
  }
</style>
