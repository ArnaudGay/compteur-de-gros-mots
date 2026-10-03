<script lang="ts">
  import { SUGGESTED_WORDS } from '../../core/defaults';
  import { app } from '../lib/state.svelte';
  import Sheet from './Sheet.svelte';

  let { reportId, targetId, onClose }: { reportId: string; targetId: string; onClose: () => void } = $props();

  let custom = $state('');

  // Les mots déjà entendus passent devant les suggestions.
  let words = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const e of app.view?.recent ?? []) for (const r of e.reports) if (r.word) counts.set(r.word, (counts.get(r.word) ?? 0) + 1);
    const heard = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    return [...new Set([...heard, ...SUGGESTED_WORDS])].slice(0, 12);
  });

  async function choose(word: string | null) {
    onClose();
    await app.setWord(reportId, word);
  }
</script>

<Sheet title="Quel mot ?" {onClose}>
  <p class="lede">Pour les stats : le mot que {app.name(targetId)} a dit. Il reste caché dans l'historique.</p>
  <div class="chips">
    {#each words as word (word)}
      <button type="button" class="chip" onclick={() => choose(word)}>{word}</button>
    {/each}
  </div>
  <form
    class="custom"
    onsubmit={(event) => {
      event.preventDefault();
      if (custom.trim()) void choose(custom);
    }}
  >
    <label class="sr-only" for="word-custom">Autre mot</label>
    <input id="word-custom" class="input" maxlength="30" autocomplete="off" autocapitalize="off" placeholder="Autre mot" bind:value={custom} />
    <button class="btn primary" type="submit" disabled={!custom.trim()}>OK</button>
  </form>
</Sheet>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
    border: 1px solid var(--rule-strong);
    background: var(--panel);
    font-weight: 600;
  }
  .chip:active {
    background: var(--card);
    color: var(--card-ink);
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-top: 18px;
  }
</style>
