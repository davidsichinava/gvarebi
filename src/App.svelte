<script>
  import { nav, go } from './lib/state.svelte.js'
  import { setLocale, i18n, t } from './lib/i18n.svelte.js'
  import { getMeta, getAreas, getIndex } from './lib/data.js'
  import Header from './components/Header.svelte'
  import ControlRail from './components/ControlRail.svelte'
  import SurnameView from './views/SurnameView.svelte'
  import RegionView from './views/RegionView.svelte'
  import ExploreView from './views/ExploreView.svelte'
  import MethodView from './views/MethodView.svelte'

  let meta = $state(null)
  let areas = $state(null)
  let index = $state(null)
  let error = $state(null)

  Promise.all([getMeta(), getAreas(), getIndex()])
    .then(([m, a, i]) => { meta = m; areas = a; index = i })
    .catch((e) => (error = e.message))

  $effect(() => {
    setLocale(nav.lang)
    document.documentElement.lang = nav.lang
  })

  // Land somewhere real rather than on an empty shell.
  $effect(() => {
    if (!index || nav.view !== 'home') return
    go({ view: 'surname', a: index.list[0].ka })
  })

  let ready = $derived(meta && areas && index && i18n.ready)
</script>

<div class="app">
  {#if error}
    <div class="boot err">Could not load the data payload: {error}</div>
  {:else if !ready}
    <div class="boot mut">…</div>
  {:else}
    <Header {index} />
    {#if nav.view === 'surname' || nav.view === 'region'}
      <ControlRail showMetric={nav.view === 'surname'} />
    {/if}

    {#if nav.view === 'surname'}
      <SurnameView {index} {areas} {meta} />
    {:else if nav.view === 'region'}
      <RegionView {index} {areas} {meta} />
    {:else if nav.view === 'explore'}
      <ExploreView {index} {areas} {meta} />
    {:else if nav.view === 'method'}
      <MethodView {meta} />
    {/if}
  {/if}
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100%; }
  .boot { display: grid; place-items: center; height: 100%; font-size: 14px; }
  .err { color: var(--warm); padding: 20px; text-align: center; }
</style>
