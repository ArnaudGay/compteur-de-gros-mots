<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } = $props();

  let panel: HTMLDivElement | undefined = $state();

  $effect(() => {
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel}>
  <div class="grab" aria-hidden="true"></div>
  <header>
    <h2>{title}</h2>
    <button type="button" class="done" onclick={onClose}>Fermer</button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--overlay);
    animation: fade 180ms ease-out;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    /* Jamais sous la barre d'état ni sous la zone floue d'iOS 26. */
    max-height: min(88%, calc(100% - env(safe-area-inset-top, 0px) - var(--glass-top) - 8px));
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border-radius: 14px 14px 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    animation: up 240ms var(--ease);
    outline: none;
    max-width: 640px;
    margin: 0 auto;
  }
  .grab {
    width: 38px;
    height: 5px;
    border-radius: 3px;
    background: var(--rule-strong);
    margin: 7px auto 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px 6px var(--gutter);
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.1;
  }
  .done {
    min-height: var(--tap);
    padding: 0 10px;
    border: 0;
    background: transparent;
    font-weight: 600;
    color: var(--ink-2);
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px var(--gutter) 20px;
  }
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
