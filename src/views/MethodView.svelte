<script>
  import { t } from '../lib/i18n.svelte.js'
  import { num } from '../lib/format.js'
  import { SHOW_1997 } from '../lib/features.js'
  let { meta } = $props()
  let k = $derived(meta.suppression.k)
</script>

<div class="scroll">
  <article>
    <h1>{t('method.title')}</h1>
    <p class="stand mut">{t('method.subtitle')}</p>

    <div class="sources">
      <div class="card pad">
        <div class="lbl">{t('source.voters')}</div>
        <p class="tiny">{meta.sources.voters.date} · {num(meta.sources.voters.records)} records ·
          aggregated to surname × precinct, then to municipality and electoral district.</p>
      </div>
      {#if SHOW_1997}
        <div class="card pad">
          <div class="lbl">{t('source.book1997')}</div>
          <p class="tiny">{meta.sources.book1997.citation} · municipal level only, which is why the
            district toggle is unavailable for it.</p>
        </div>
      {/if}
      <div class="card pad">
        <div class="lbl">Boundaries</div>
        <p class="tiny">Sample geometry in this prototype — Voronoi cells around the area centroids,
          not real administrative boundaries. Replace <code>data/geo/*.geo.json</code> and nothing
          else changes.</p>
      </div>
    </div>

    <h2>{t('method.privacy')}</h2>
    <p>A surname in a single precinct can identify a household. Three rules follow, and all three are
      enforced in the build script rather than in this interface — so the browser never receives
      anything that needs protecting.</p>
    <ol>
      <li>Any surname × area cell with fewer than <b>{k}</b> people is suppressed and shown as
        <span class="mono">n &lt; {k}</span>. Suppressed cells are excluded from every ranking and rate.</li>
      <li><b>Precinct-level counts are never published in any form.</b> They exist only inside the
        build, where they are smoothed into a continuous surface.</li>
      <li>The hotspot layer is a kernel density estimate at {meta.kde.bandwidth_km} km bandwidth on a
        {meta.kde.grid.cols} × {meta.kde.grid.rows} grid, quantised to one byte per cell, with the
        tail floored to zero. It shows where a surname is dense; it cannot be read back to a count
        at a point.</li>
      <li>Complementary suppression: because the national total is published, a lone suppressed cell
        is recoverable by subtraction, so the next-smallest cell is suppressed too.</li>
    </ol>

    <h2>{t('method.metrics')}</h2>
    <p><b>{t('metric.count')}</b> is people on the roll. <b>{t('metric.rate')}</b> divides by everyone
      on the roll in that area. <b>{t('metric.lq')}</b> is a location quotient:</p>
    <pre>concentration = (name_in_area / all_in_area) ÷ (name_national / all_national)</pre>
    <p>1 means exactly as common here as everywhere; 6 means six times over-represented. It is the
      metric that finds a surname's home region, and the one most easily misread — small areas
      produce large quotients, so a floor of {meta.suppression.min_count_for_lq} people applies
      before a quotient is displayed.</p>

    <h2>{t('method.limitations')}</h2>
    <ul>
      <li><b>The roll is not the population.</b> No under-18s, no non-citizens, and emigrants often
        remain listed.</li>
      {#if SHOW_1997}
        <li><b>1997 is not a census.</b> Coverage and method differ; treat the change column as
          directional, not exact.</li>
      {/if}
      <li><b>Registration is not residence</b>, which matters for internally displaced people.</li>
      <li><b>Spelling variants are not merged</b> unless listed in <span class="mono">surnames_meta.csv</span>.</li>
      {#if SHOW_1997}
        <li><b>Boundaries changed</b> between 1997 and today; 1997 figures must be apportioned onto
          current geography before they reach the build.</li>
      {/if}
      <li><b>Suffix families are a heuristic</b>, not a linguistic classification.</li>
    </ul>
  </article>
</div>

<style>
  .scroll { flex-grow: 1; padding: 28px 16px 60px; }
  article { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 27px; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 16px; font-weight: 600; margin: 28px 0 8px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .stand { font-size: 15px; margin: 0 0 22px; }
  p, li { font-size: 13.5px; line-height: 1.6; color: #3a3733; }
  .sources { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .pad { padding: 12px; }
  .sources p { margin: 5px 0 0; }
  ol, ul { padding-left: 20px; }
  li { margin-bottom: 7px; }
  pre { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--sunk);
    border: 1px solid var(--rule); border-radius: 2px; padding: 9px 11px; overflow-x: auto; }
  .mono, code { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; }
  @media (max-width: 720px) { .sources { grid-template-columns: 1fr; } }
</style>
