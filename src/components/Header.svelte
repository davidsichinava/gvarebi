<script>
  import { nav, go } from '../lib/state.svelte.js'
  import { t } from '../lib/i18n.svelte.js'
  import { search } from '../lib/data.js'

  let { index } = $props()

  let q = $state('')
  let open = $state(false)
  let input
  let hits = $derived(index ? search(index, q) : [])

  function pick(entry) {
    q = ''
    open = false
    input?.blur()
    go({ view: 'surname', a: entry.ka })
  }

  function onkey(e) {
    if (e.key === 'Escape') { q = ''; open = false; input?.blur() }
    if (e.key === 'Enter' && hits[0]) pick(hits[0])
  }

  const TABS = [
    { view: 'surname', key: 'nav.surname' },
    { view: 'region', key: 'nav.regions' },
    { view: 'explore', key: 'nav.explore' },
    { view: 'method', key: 'nav.method' },
  ]

  function goTab(view) {
    if (view === 'surname') go({ view: 'surname', a: nav.view === 'surname' ? nav.a : (index?.list[0]?.ka ?? '') })
    else if (view === 'region') go({ view: 'region', a: nav.geo, b: nav.view === 'region' ? nav.b : firstArea() })
    else go({ view })
  }
  let firstAreaId = $state(null)
  function firstArea() { return firstAreaId ?? 12 }
  export function setFirstArea(id) { firstAreaId = id }
</script>

<header>
  <!-- The wordmark was hardcoded Georgian and the link pointed at one specific
       surname in the old latin route form. Both follow the locale now. -->
  <a class="brand" href="#/">
    <span class="mark">{t('app.title')}</span>
    <span class="lbl">{t('app.tagline')}</span>
  </a>

  <div class="search" class:open>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
    </svg>
    <input
      bind:this={input}
      bind:value={q}
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 140)}
      onkeydown={onkey}
      placeholder={t('search.placeholder_short')}
      aria-label={t('search.placeholder_short')}
    />
    {#if open && q}
      <ul class="hits card">
        {#each hits as h (h.ka)}
          <li><button onmousedown={() => pick(h)}>
            <span class="ka">{h.ka}</span>
            <span class="mut">{h.latin}</span>
            <span class="grow"></span>
            <span class="num tiny mut">{h.voters.toLocaleString('en-US')}</span>
          </button></li>
        {:else}
          <li class="empty mut tiny">{t('search.no_results', { query: q })}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <span class="grow"></span>

  <nav>
    {#each TABS as tab}
      <button class="tab" class:on={nav.view === tab.view} onclick={() => goTab(tab.view)}>{t(tab.key)}</button>
    {/each}
    <div class="seg" style="margin-left:8px">
      <button aria-pressed={nav.lang === 'ka'} onclick={() => go({ lang: 'ka' })}>KA</button>
      <button aria-pressed={nav.lang === 'en'} onclick={() => go({ lang: 'en' })}>EN</button>
    </div>
  </nav>
</header>

<style>
  header {
    display: flex; align-items: center; gap: 20px; height: var(--header);
    padding: 0 16px; background: var(--card); border-bottom: 1px solid var(--rule);
    flex-shrink: 0;
  }
  .brand { display: flex; flex-direction: column; gap: 1px; text-decoration: none; color: inherit; }
  .brand:hover { text-decoration: none; }
  /* Uppercases the Latin wordmark only. Unicode deliberately defines no
     uppercase mapping from Mkhedruli to Mtavruli — they are separate styles,
     not a case pair — so text-transform leaves Georgian untouched, which I
     confirmed by rendering rather than assuming. The Georgian wordmark stays
     მაშასადამე; to set it in caps the locale value has to carry Mtavruli
     characters directly, and the font has to cover U+1C90-1CBA. Positive
     tracking because caps need more air than lowercase. */
  .mark { font-family: "BPG Nino Mtavruli", "BPG Sans Modern", "Noto Sans Georgian", system-ui, sans-serif;
    font-size: 17px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .search { position: relative; display: flex; align-items: center; gap: 8px;
    flex-grow: 1; max-width: 380px; border: 1px solid var(--rule); border-radius: 3px;
    background: var(--paper); padding: 7px 11px; color: var(--ink3); }
  .search:focus-within { border-color: var(--ink); color: var(--ink2); }
  .search input { border: 0; background: none; outline: none; flex-grow: 1; font-size: 13px; color: var(--ink); min-width: 0; }
  .hits { position: absolute; top: calc(100% + 5px); left: -1px; right: -1px; z-index: 30;
    list-style: none; margin: 0; padding: 4px; box-shadow: var(--shadow); max-height: 320px; overflow-y: auto; }
  .hits button { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left;
    padding: 6px 8px; background: none; border: 0; border-radius: 2px; cursor: pointer; }
  .hits button:hover { background: var(--sunk); }
  .ka { font-size: 13.5px; font-weight: 500; }
  .empty { padding: 8px; }
  nav { display: flex; align-items: center; gap: 4px; }
  .tab { background: none; border: 0; padding: 6px 8px; font-size: 12px; color: var(--ink2); cursor: pointer;
    border-bottom: 2px solid transparent; }
  .tab.on { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }
  @media (max-width: 900px) {
    header { gap: 10px; padding: 0 10px; }
    .brand .lbl { display: none; }
    nav { overflow-x: auto; scrollbar-width: none; }
    nav::-webkit-scrollbar { display: none; }
    nav .tab { padding: 6px 5px; font-size: 11.5px; white-space: nowrap; }
    .search { max-width: none; }
  }
  @media (max-width: 620px) {
    /* the tabs are reachable from the views themselves; the search is not */
    nav .tab { display: none; }
  }
</style>
