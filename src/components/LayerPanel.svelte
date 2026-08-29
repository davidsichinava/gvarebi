<script>
  import { t } from '../lib/i18n.svelte.js'

  let {
    showBase = $bindable(true),
    showFills = $bindable(true),
    showKde = $bindable(true),
    fillOpacity = $bindable(0.8),
    kdeOpacity = $bindable(0.75),
    hasKde = true,
  } = $props()

  // Both fills and surface are turned down by default and both get a slider,
  // because at full opacity the fills bury the raster underneath them — which
  // is what makes people conclude the hotspot layer "isn't working".

  // The panel floats over the map, so on a narrow screen it covers the thing it
  // controls. Collapsing leaves only its own header behind.
  let open = $state(true)
</script>

<div class="panel card" class:closed={!open}>
  <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="lbl">{t('map.layers')}</span>
    <svg class="chev" class:up={open} width="11" height="11" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <label class="row">
      <input type="checkbox" bind:checked={showBase} />
      <span>{t('map.basemap')}</span>
    </label>

    <div class="block">
      <label class="row">
        <input type="checkbox" bind:checked={showFills} />
        <span>{t('map.choropleth')}</span>
      </label>
      <!-- The label sits above the track rather than beside it. Beside it, a
           long translation ("გამჭვირვალობა") pushed the range input past the
           panel's own edge, because the label would not shrink. -->
      <div class="slider">
        <span class="tiny mut">{t('map.opacity')}</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={fillOpacity} disabled={!showFills} />
      </div>
    </div>

    <div class="block">
      <label class="row">
        <input type="checkbox" bind:checked={showKde} disabled={!hasKde} />
        <span class:off={!hasKde}>{t('map.hotspot')}</span>
      </label>
      <div class="slider">
        <span class="tiny mut">{t('map.opacity')}</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={kdeOpacity} disabled={!showKde || !hasKde} />
      </div>
    </div>
  {/if}
</div>

<style>
  .panel { padding: 7px 11px 9px; width: 208px; display: flex; flex-direction: column; gap: 7px;
    box-shadow: var(--shadow); background: rgba(255,253,250,.96); }
  .panel.closed { gap: 0; padding-bottom: 7px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; background: none; border: 0; padding: 2px 0; cursor: pointer; color: var(--ink2); }
  .chev { transition: transform .15s ease; flex-shrink: 0; }
  .chev.up { transform: rotate(180deg); }
  label { font-size: 11.5px; cursor: pointer; }
  .block { border-top: 1px solid var(--hair); padding-top: 7px; display: flex; flex-direction: column; gap: 3px; }
  .slider { display: flex; flex-direction: column; gap: 2px; padding-left: 20px; }
  /* min-width:0 lets the track shrink inside the panel instead of overflowing it */
  .slider input { width: 100%; min-width: 0; height: 3px; accent-color: var(--accent); margin: 3px 0 0; }
  input[type='checkbox'] { accent-color: var(--ink); width: 13px; height: 13px; }
  .off { color: var(--ink3); }
  @media (max-width: 720px) { .panel { width: 172px; } }
</style>
