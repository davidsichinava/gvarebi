<script>
  import { Map as MapLibreMap, Popup, NavigationControl } from 'maplibre-gl'
  import { getGeo } from '../lib/data.js'
  import { paintKde, bboxCoordinates } from '../lib/kde.js'
  import { NO_DATA, SUPPRESSED, ZERO } from '../lib/colors.js'
  import { t, name as areaName } from '../lib/i18n.svelte.js'

  let {
    geo = 'mun',
    rows = [],
    scale = null,
    kdeCells = null,
    grid = null,
    fillOpacity = 0.8,
    kdeOpacity = 0.75,
    showFills = true,
    showKde = true,
    showBase = true,
    selected = null,
    tooltip = null,
    // Optional second channel for categorical maps: a predicate over a row that
    // says whether its area carries a diagonal hatch. Colour alone tops out at
    // four separable classes on a choropleth; texture is what takes it to seven.
    hatched = null,
    // Areas with nothing to show. They get a finer, greyer hatch than the
    // categorical one — flat grey read as a real value, which is exactly what
    // "no data" is not.
    nodata = null,
    onpick = () => {},
  } = $props()

  let el, map
  let ready = $state(false)
  let failed = $state(null)
  let loadedGeo = null
  // The area layers appear only once getGeo resolves, which is always after the
  // map's own load event. Effects that paint those layers have to wait on
  // something reactive, or they bail out before ever reading their data — see
  // the note on the choropleth effect below.
  let layersReady = $state(false)

  // The basemap is served from the repo, not a CDN: `npm run tiles` caches
  // Esri's World Light Gray canvas for the Georgia bounding box into
  // public/tiles, so the app needs no network at all. maxzoom stops MapLibre
  // asking for levels the cache does not hold — past it, z11 is scaled up.
  //
  // Not CARTO. Its keyless endpoint still returns 200 with a plausible tile,
  // but every one is stamped "API KEY REQUIRED" across the middle.
  //
  // A fresh clone that has not run `npm run tiles` yet has no public/tiles.
  // That degrades to the background colour under the fills, which is the same
  // thing the basemap toggle does, so nothing on the page breaks.
  //
  // Before launch, swap this source for a self-hosted Protomaps PMTiles extract
  // of Georgia — one file, read by HTTP range like the rest of the payload,
  // rather than 1,700 loose JPEGs.
  const style = {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [`${import.meta.env.BASE_URL}tiles/{z}/{x}/{y}.jpg`],
        tileSize: 256,
        maxzoom: 11,
        attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'base-bg', type: 'background', paint: { 'background-color': '#f2f0ed' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.9, 'raster-opacity': 0.85 } },
    ],
  }

  const GEORGIA = [[39.9, 41.0], [46.8, 43.6]]
  const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

  // WebGL2 can be unavailable — an old browser, a hardened profile, a headless
  // runner. Contain the failure here: the map degrades to a message and every
  // table, statistic and control on the page keeps working.
  $effect(() => {
    if (map || failed) return
    try {
      map = new MapLibreMap({
        container: el,
        style,
        bounds: GEORGIA,
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        // ?debug keeps the GL buffer readable so tools/inspect.mjs can confirm
        // the map actually painted, rather than merely initialised.
        preserveDrawingBuffer: DEBUG,
      })
      map.touchZoomRotate?.disableRotation?.()
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      map.on('error', (e) => console.warn('[map]', e?.error?.message ?? e))
      map.on('load', () => { addHatchImage(); ready = true })
      // ?debug exposes the map for the inspector in tools/ and for the console.
      if (DEBUG) window.__map = map
    } catch (e) {
      failed = e?.message ?? String(e)
      map = null
      return
    }
    return () => { try { map?.remove() } catch {} map = null }
  })

  // A 45-degree hatch, drawn once and registered with the map. Semi-transparent
  // black over whatever colour the fill beneath it already carries, so one image
  // serves every hue instead of one tinted image per category.
  const HATCH = 8
  function stripes(size, stroke, width) {
    const dpr = Math.min(2, Math.round(window.devicePixelRatio || 1))
    const n = size * dpr
    const c = document.createElement('canvas')
    c.width = c.height = n
    const g = c.getContext('2d')
    g.strokeStyle = stroke
    g.lineWidth = width * dpr
    // Three passes so the stripes tile seamlessly across the diagonal seam.
    for (const off of [-n, 0, n]) {
      g.beginPath()
      g.moveTo(off, n)
      g.lineTo(off + n, 0)
      g.stroke()
    }
    return { data: g.getImageData(0, 0, n, n), pixelRatio: dpr }
  }
  function addHatchImage() {
    if (!map || map.hasImage?.('hatch')) return
    const cat = stripes(HATCH, 'rgba(28,26,23,.42)', 1.6)
    map.addImage('hatch', cat.data, { pixelRatio: cat.pixelRatio })
    // Finer and lighter: it marks an absence, so it must not compete with the
    // categories for attention.
    const nd = stripes(6, 'rgba(90,86,79,.55)', 0.9)
    map.addImage('hatch-nodata', nd.data, { pixelRatio: nd.pixelRatio })
  }

  // ---------------------------------------------------------------- boundaries
  $effect(() => {
    if (!ready || !geo) return
    const want = geo
    getGeo(want).then((fc) => {
      if (!map || loadedGeo === want) return
      loadedGeo = want
      if (map.getSource('areas')) map.getSource('areas').setData(fc)
      else {
        map.addSource('areas', { type: 'geojson', data: fc, promoteId: 'code' })
        map.addLayer({
          id: 'areas-fill', type: 'fill', source: 'areas',
          paint: { 'fill-color': NO_DATA, 'fill-opacity': fillOpacity },
        })
        // The surface sits above the fills but below the outlines, so borders
        // stay readable through it.
        map.addLayer({
          id: 'areas-line', type: 'line', source: 'areas',
          paint: {
            'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#22201d', '#8d877e'],
            'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 0.8],
          },
        })
        map.addLayer({
          id: 'areas-hatch', type: 'fill', source: 'areas',
          paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0 },
          filter: ['in', ['get', 'code'], ['literal', []]],
        })
        wireInteraction()
        layersReady = true
      }
    })
  })

  function wireInteraction() {
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    let hovered = null
    map.on('mousemove', 'areas-fill', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      if (hovered !== f.id) {
        hovered = f.id
        const row = rows.find((r) => r.area.code === f.id)
        popup.setLngLat(e.lngLat).setHTML(tooltip ? tooltip(row, f) : basicTip(row, f)).addTo(map)
      } else popup.setLngLat(e.lngLat)
    })
    map.on('mouseleave', 'areas-fill', () => {
      map.getCanvas().style.cursor = ''
      hovered = null
      popup.remove()
    })
    map.on('click', 'areas-fill', (e) => {
      const f = e.features?.[0]
      if (f) onpick(f.id)
    })
  }

  function basicTip(row, f) {
    const label = areaName(f.properties)
    if (!row) return `<b>${label}</b>`
    if (row.suppressed) return `<b>${label}</b><br><span style="color:#6b665e">${t('value.suppressed_long', { k: 5 })}</span>`
    return `<b>${label}</b>`
  }

  // ---------------------------------------------------------------- choropleth
  // Read every reactive input up front. Svelte tracks only what an effect
  // actually reads, so bailing out before touching `rows` registers no
  // dependency on it — and since the layer arrives asynchronously, that bailout
  // is the normal first run. The effect would then never re-run when the data
  // landed, leaving the fills flat at NO_DATA with no error anywhere.
  $effect(() => {
    const data = rows, sc = scale, fills = showFills, opacity = fillOpacity, hatch = hatched, blanks = nodata
    if (!ready || !layersReady || !map?.getLayer('areas-fill')) return
    const match = ['match', ['get', 'code']]
    let any = false
    for (const r of data) {
      // Order matters: no electorate beats withheld beats empty beats a value.
      const fill = r.noData ? NO_DATA
        : r.suppressed ? SUPPRESSED
        : r.zero ? ZERO
        : (sc ? sc.color(r.value) : NO_DATA)
      match.push(r.area.code, fill)
      any = true
    }
    match.push(NO_DATA)
    map.setPaintProperty('areas-fill', 'fill-color', any ? match : NO_DATA)
    map.setPaintProperty('areas-fill', 'fill-opacity', fills ? opacity : 0)

    if (map.getLayer('areas-hatch')) {
      const marked = hatch ? data.filter((r) => !r.suppressed && hatch(r)).map((r) => r.area.code) : []
      // Only areas with no electorate. This used to hatch anything with a null
      // value, which swept up every area sitting below the quotient floor — 22
      // of 66 for a mid-sized surname — and told the reader they had no data
      // when they had a count.
      const blank = data
        .filter((r) => !r.suppressed && (blanks ? blanks(r) : r.noData === true))
        .map((r) => r.area.code)
      const all = [...marked, ...blank]
      const pattern = ['match', ['get', 'code']]
      for (const code of marked) pattern.push(code, 'hatch')
      for (const code of blank) pattern.push(code, 'hatch-nodata')
      pattern.push('hatch')
      map.setFilter('areas-hatch', ['in', ['get', 'code'], ['literal', all]])
      map.setPaintProperty('areas-hatch', 'fill-pattern', all.length ? pattern : 'hatch')
      map.setPaintProperty('areas-hatch', 'fill-opacity', fills && all.length ? opacity : 0)
    }
  })

  // ---------------------------------------------------------------- selection
  let lastSelected = null
  $effect(() => {
    const want = selected
    if (!ready || !layersReady || !map?.getSource('areas')) return
    if (lastSelected) map.setFeatureState({ source: 'areas', id: lastSelected }, { selected: false })
    if (want) map.setFeatureState({ source: 'areas', id: want }, { selected: true })
    lastSelected = want
  })

  // ---------------------------------------------------------------- density
  $effect(() => {
    if (!ready || !map) return
    const has = showKde && kdeCells && kdeCells.length && grid
    if (!has) {
      if (map.getLayer('kde')) map.setPaintProperty('kde', 'raster-opacity', 0)
      return
    }
    const url = paintKde(kdeCells, grid)
    const coords = bboxCoordinates(grid.bbox)
    if (map.getSource('kde')) {
      map.getSource('kde').updateImage({ url, coordinates: coords })
    } else {
      map.addSource('kde', { type: 'image', url, coordinates: coords })
      map.addLayer(
        {
          id: 'kde', type: 'raster', source: 'kde',
          // nearest: at ~2 km cells the pixels are the honest resolution of the
          // estimate. Smoothing them would imply precision suppression forbids.
          paint: { 'raster-opacity': kdeOpacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
        },
        map.getLayer('areas-line') ? 'areas-line' : undefined
      )
    }
    map.setPaintProperty('kde', 'raster-opacity', kdeOpacity)
  })

  $effect(() => {
    if (!ready || !map?.getLayer('base')) return
    map.setPaintProperty('base', 'raster-opacity', showBase ? 0.85 : 0)
  })
</script>

<div bind:this={el} class="map" class:hidden={failed}></div>
{#if failed}
  <div class="fallback">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M9 4L3 7v13l6-3 6 3 6-3V4l-6 3z" stroke-linejoin="round" /><path d="M9 4v13M15 7v13" />
    </svg>
    <p>{t('map.unavailable')}</p>
    <p class="why">{failed}</p>
  </div>
{/if}

<style>
  .map { position: absolute; inset: 0; }
  .map.hidden { display: none; }
  .fallback { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 6px; padding: 24px; text-align: center;
    color: var(--ink3); background: var(--sunk); }
  .fallback p { margin: 0; font-size: 12.5px; max-width: 34ch; color: var(--ink2); }
  .fallback .why { font-size: 10.5px; color: var(--ink3); }
  :global(.maplibregl-ctrl-group button) { width: 26px; height: 26px; }
</style>
