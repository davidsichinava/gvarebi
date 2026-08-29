<script>
  import { t } from '../lib/i18n.svelte.js'
  import { SUPPRESSED, NO_DATA, ZERO } from '../lib/colors.js'
  import { num, times, pct } from '../lib/format.js'

  let { scale, metric, k = 5, anySuppressed = false,
        anyZero = false, anyNoData = false, anyBelowMin = false, minLq = 50 } = $props()

  const fmt = (v) => {
    if (v == null) return ''
    if (metric === 'lq') return times(v, 1)
    if (metric === 'change') return pct(v, 0)
    if (metric === 'rate') return num(v, 1)
    return num(v)
  }
  let title = $derived(
    metric === 'lq' ? t('legend.concentration')
    : metric === 'rate' ? t('legend.rate')
    : metric === 'change' ? t('source.change_long')
    : t('legend.count')
  )
</script>

<div class="legend card">
  <div class="lbl">{title}</div>
  <div class="ramp">
    {#each scale?.stops ?? [] as stop}
      <i style="background:{stop.color}"></i>
    {/each}
  </div>
  <div class="ticks tiny mut">
    <span>{fmt(scale?.stops?.at(0)?.value ?? scale?.breaks?.at(0))}</span>
    {#if scale?.centre != null}<span>{fmt(scale.centre)}</span>{/if}
    <span>{fmt(scale?.stops?.at(-1)?.value ?? scale?.breaks?.at(-1))}</span>
  </div>
  {#if anySuppressed}
    <div class="key tiny mut"><i style="background:{SUPPRESSED}"></i>{t('legend.suppressed', { k })}</div>
  {/if}
  {#if anyBelowMin}
    <div class="key tiny mut"><i style="background:{NO_DATA}"></i>{t('legend.below_min', { min: minLq })}</div>
  {/if}
  {#if anyZero}
    <div class="key tiny mut"><i style="background:{ZERO}"></i>{t('legend.none')}</div>
  {/if}
  {#if anyNoData}
    <div class="key tiny mut"><i class="nodata" style="background-color:{NO_DATA}"></i>{t('legend.no_data')}</div>
  {/if}
</div>

<style>
  /* Mirrors the map's no-data fill: light grey under thin dark grey stripes. */
  .nodata { background-image: repeating-linear-gradient(45deg,
    rgba(90,86,79,.55) 0 0.9px, transparent 0.9px 3px); }
  .legend { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; min-width: 172px;
    box-shadow: var(--shadow); background: rgba(255,253,250,.94); }
  .ramp { display: flex; }
  .ramp i { display: block; height: 9px; flex: 1 1 0; }
  .ticks { display: flex; justify-content: space-between; }
  .key { display: flex; align-items: center; gap: 6px; }
  .key i { width: 13px; height: 9px; border: 1px solid rgba(34,32,29,.13); display: block; }
</style>
