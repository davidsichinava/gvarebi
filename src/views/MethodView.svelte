<script>
  import { t } from '../lib/i18n.svelte.js'
  import { num } from '../lib/format.js'
  import { SHOW_1997 } from '../lib/features.js'
  let { meta } = $props()
  let k = $derived(meta.suppression.k)

  // Every sentence on this page is a locale key. It used to be 218 words of
  // English sitting directly in the markup, which meant the one page that
  // explains the method was the one page that could not be translated. Where a
  // sentence needs emphasis, the bold half is its own key (…_lead) rather than
  // markup inside a translated string — a translator should never have to hand
  // back HTML.
</script>

<div class="scroll">
  <article>
    <h1>{t('method.title')}</h1>
    <p class="stand mut">{t('method.subtitle')}</p>

    <h2>{t('source.voters')}</h2>
    <p><b>{t('method.source_voters')}</b></p>

    <h2>{t('method.names_title')}</h2>
    <p>{t('method.names_source')}</p>
    <p>{t('method.names_normalise')}</p>
    <p>{t('method.names_cohort')}</p>
    <p>{t('method.names_suppression', { k: meta.suppression.k })}</p>

    <h2>{t('method.metrics')}</h2>
	<p><b>{t('method.metrics_description')}</b></p>
    <pre>{t('method.metrics_formula')}</pre>
    <p>{t('method.metrics_note', { min: meta.suppression.min_count_for_lq })}</p>

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
