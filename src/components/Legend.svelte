<script>
  import { t } from '../lib/i18n.svelte.js'
  import { SUPPRESSED, NO_DATA } from '../lib/colors.js'
  import { num, times, pct } from '../lib/format.js'

  let { scale, metric, k = 5, anySuppressed = false } = $props()

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
  <div class="key tiny mut"><i style="background:{NO_DATA}"></i>{t('legend.no_data')}</div>
</div>

<style>
  .legend { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; min-width: 172px;
    box-shadow: var(--shadow); background: rgba(255,253,250,.94); }
  .ramp { display: flex; }
  .ramp i { display: block; height: 9px; flex: 1 1 0; }
  .ticks { display: flex; justify-content: space-between; }
  .key { display: flex; align-items: center; gap: 6px; }
  .key i { width: 13px; height: 9px; border: 1px solid rgba(34,32,29,.13); display: block; }
</style>
