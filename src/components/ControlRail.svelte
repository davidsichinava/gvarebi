<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t } from '../lib/i18n.svelte.js'
  import { SHOW_1997 } from '../lib/features.js'

  let { showMetric = true } = $props()

  // The 1997 book stops at municipality, so the district toggle is genuinely
  // unavailable for it — disabled with a reason beats silently empty. With the
  // 1997 sources hidden, voters is the only source, so nothing ever disables it.
  let disDisabled = $derived(SHOW_1997 && nav.src !== 'voters')
</script>

<div class="rail">
  <!-- Hidden wholesale rather than left as a single pressed button: a segmented
       control with one option reads as broken. -->
  {#if SHOW_1997}
    <div class="group">
      <span class="lbl">{t('control.source')}</span>
      <div class="seg">
        <button aria-pressed={nav.src === 'voters'} onclick={() => go({ src: 'voters' })}>{t('source.voters')}</button>
        <button aria-pressed={nav.src === 'book1997'} onclick={() => go({ src: 'book1997' })}>{t('source.book1997')}</button>
        <button aria-pressed={nav.src === 'change'} onclick={() => go({ src: 'change' })}>{t('source.change')}</button>
      </div>
    </div>
  {/if}

  <div class="group">
    <span class="lbl">{t('control.geography')}</span>
    <div class="seg">
      <button aria-pressed={nav.geo === 'mun'} onclick={() => go({ geo: 'mun' })}>{t('geo.municipalities')}</button>
      <button
        aria-pressed={nav.geo === 'dis'}
        disabled={disDisabled}
        title={disDisabled ? t('geo.districts_1997_note') : ''}
        onclick={() => go({ geo: 'dis' })}
      >{t('geo.districts')}</button>
    </div>
  </div>

  {#if showMetric}
    <div class="group">
      <span class="lbl">{t('control.metric')}</span>
      {#if SHOW_1997 && nav.src === 'change'}
        <span class="fixed tiny mut">{t('source.change_long')}</span>
      {:else}
        <div class="seg">
          <button aria-pressed={nav.metric === 'count'} onclick={() => go({ metric: 'count' })}>{t('metric.count')}</button>
          <button aria-pressed={nav.metric === 'rate'} onclick={() => go({ metric: 'rate' })}>{t('metric.rate')}</button>
          <button aria-pressed={nav.metric === 'lq'} onclick={() => go({ metric: 'lq' })}>{t('metric.lq')}</button>
        </div>
      {/if}
    </div>
  {/if}

  <span class="grow"></span>

  <button class="btn" onclick={() => navigator.clipboard?.writeText(location.href)}>{t('action.copy_link')}</button>
</div>

<style>
  .rail {
    display: flex; align-items: center; gap: 18px; height: var(--rail);
    padding: 0 16px; background: var(--sunk); border-bottom: 1px solid var(--rule);
    flex-shrink: 0; overflow-x: auto;
  }
  .group { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
  .fixed { border: 1px dashed var(--rule); border-radius: 3px; padding: 5px 9px; }
</style>
