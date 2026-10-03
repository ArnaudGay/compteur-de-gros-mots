<script lang="ts">
  import Back from '../components/Back.svelte';
  import { hours, money, seconds } from '../lib/format';
  import { app } from '../lib/state.svelte';

  let settings = $derived(app.view?.settings);

  /** Texte libre de l'admin : paragraphes, titres courts et listes à tirets. */
  let blocks = $derived.by(() => {
    const text = settings?.rules ?? '';
    return text
      .split(/\n\s*\n/)
      .map((chunk) => chunk.split('\n').map((l) => l.trim()).filter(Boolean))
      .filter((lines) => lines.length > 0)
      .map((lines) => {
        const items = lines.filter((l) => l.startsWith('- '));
        const head = lines.filter((l) => !l.startsWith('- '));
        return { head, items: items.map((l) => l.slice(2)) };
      });
  });
</script>

<div class="page">
  <Back />
  <h1>Règles du défi</h1>

  <article class="rules">
    {#each blocks as block, i (i)}
      {#each block.head as line (line)}
        {#if block.items.length && block.head.length === 1}
          <h2>{line}</h2>
        {:else}
          <p>{line}</p>
        {/if}
      {/each}
      {#if block.items.length}
        <ul>
          {#each block.items as item (item)}<li>{item}</li>{/each}
        </ul>
      {/if}
    {/each}
  </article>

  {#if settings}
    <h2 class="eyebrow section-title">Réglages en vigueur</h2>
    <dl class="list facts">
      <div class="row"><dt class="grow">Deux signalements du même gros mot</dt><dd>fusionnés sous {seconds(settings.mergeWindowMs)}</dd></div>
      <div class="row"><dt class="grow">« C'est le même ? » proposé</dt><dd>jusqu'à {seconds(settings.suggestWindowMs)}</dd></div>
      <div class="row"><dt class="grow">Délai pour contester</dt><dd>{hours(settings.contestWindowMs)}</dd></div>
      <div class="row"><dt class="grow">Durée du vote</dt><dd>{hours(settings.voteDurationMs)}</dd></div>
      <div class="row"><dt class="grow">Cagnotte</dt><dd>{settings.pricePerPointCents > 0 ? `${money(settings.pricePerPointCents)} par gros mot` : 'désactivée'}</dd></div>
      {#if settings.forfeit}<div class="row"><dt class="grow">Gage du dernier</dt><dd>{settings.forfeit}</dd></div>{/if}
    </dl>
    {#if app.me?.player.isAdmin}<p class="note muted">Tu peux modifier ces règles dans Administration.</p>{/if}
  {/if}
</div>

<style>
  .rules {
    max-width: 65ch;
    line-height: 1.55;
  }
  .rules h2 {
    margin: 22px 0 6px;
    font-size: var(--t-lg);
  }
  .rules p {
    margin: 10px 0;
  }
  .rules ul {
    margin: 6px 0 0;
    padding-left: 1.2em;
  }
  .rules li {
    margin: 6px 0;
  }
  .rules li::marker {
    content: '— ';
    color: var(--ink-3);
  }
  .facts {
    margin: 0;
  }
  dt {
    color: var(--ink-2);
    font-size: var(--t-sm);
  }
  dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
    font-size: var(--t-sm);
  }
  .note {
    font-size: var(--t-xs);
    margin: 8px 4px;
  }
</style>
