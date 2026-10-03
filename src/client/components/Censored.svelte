<script lang="ts">
  // Le mot prononcé, caché sous une bande noire façon censure. Un tap le dévoile 3 secondes.
  import { app } from '../lib/state.svelte';

  let { word }: { word: string } = $props();
  let revealed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    revealed = !revealed;
    clearTimeout(timer);
    if (revealed) timer = setTimeout(() => (revealed = false), 3000);
  }

  let open = $derived(app.reveal || revealed);
</script>

<button type="button" class="word" class:open onclick={toggle} aria-label={open ? word : `Mot censuré, ${word.length} lettres. Toucher pour le voir.`}>
  <span class="first">{word.charAt(0)}</span><span class="rest">{word.slice(1)}</span>
</button>

<style>
  .word {
    display: inline-flex;
    align-items: baseline;
    border: 0;
    padding: 0 3px;
    margin: 0;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 0.8125em;
    color: inherit;
    border-radius: 2px;
    line-height: 1.5;
  }
  .rest {
    background: var(--ink);
    color: transparent;
    border-radius: 1px;
    transition:
      background-color 160ms,
      color 160ms;
  }
  .open .rest {
    background: transparent;
    color: inherit;
  }
</style>
