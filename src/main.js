import { mount } from 'svelte'
import { setWorkerUrl } from 'maplibre-gl'
// Vite bundles the worker and hands back its emitted URL. Without this,
// maplibre resolves the worker from a runtime `import.meta.url` — a pattern no
// bundler can see — and asks for a sibling `maplibre-gl-worker.mjs` that was
// never emitted. A dev or preview server answers that with index.html, the
// worker dies parsing HTML as JavaScript, and nothing reports it: every GeoJSON
// source simply stays `isSourceLoaded() === false` forever, so the choropleth
// and the boundaries never paint while the raster layers look fine.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import App from './App.svelte'

setWorkerUrl(maplibreWorkerUrl)

export default mount(App, { target: document.getElementById('app') })
