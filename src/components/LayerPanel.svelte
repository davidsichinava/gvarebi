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
</script>

<div class="panel card">
  <div class="lbl">{t('map.layers')}</div>

  <label class="row">
    <input type="checkbox" bind:checked={showBase} />
    <span>{t('map.basemap')}</span>
  </label>

  <div class="block">
    <label class="row">
      <input type="checkbox" bind:checked={showFills} />
      <span>{t('map.choropleth')}</span>
    </label>
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

  <div class="block locked">
    <span class="row tiny">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
      {t('map.precinct_points')}
    </span>
    <div class="tiny">{t('map.precinct_locked')}</div>
  </div>
</div>

<style>
  .panel { padding: 9px 11px; width: 208px; display: flex; flex-direction: column; gap: 7px;
    box-shadow: var(--shadow); background: rgba(255,253,250,.96); }
  label { font-size: 11.5px; cursor: pointer; }
  .block { border-top: 1px solid var(--hair); padding-top: 7px; display: flex; flex-direction: column; gap: 4px; }
  .slider { display: flex; align-items: center; gap: 7px; padding-left: 20px; }
  .slider input { flex-grow: 1; height: 3px; accent-color: var(--accent); }
  input[type='checkbox'] { accent-color: var(--ink); width: 13px; height: 13px; }
  .locked { color: var(--ink3); }
  .off { color: var(--ink3); }
</style>
