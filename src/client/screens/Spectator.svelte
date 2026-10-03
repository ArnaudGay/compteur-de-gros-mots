<script lang="ts">
  import type { Snapshot } from '../../core/types';
  import Board from '../components/Board.svelte';
  import Logo from '../components/Logo.svelte';
  import type { LinkStatus } from '../lib/api';
  import { app } from '../lib/state.svelte';

  let { token }: { token: string } = $props();
  let snapshot = $state<Snapshot | null>(null);
  let link = $state<LinkStatus>('connecting');

  $effect(() => {
    const stop = app.transport.spectate(token, {
      snapshot: (s) => (snapshot = s),
      status: (s) => (link = s),
    });
    return stop;
  });

  let names = (id: string) => snapshot?.players.find((p) => p.id === id)?.name ?? '?';
  let now = $derived(app.clock + (snapshot ? snapshot.now - Date.now() : 0));
</script>

<div class="spectator">
  <header>
    <Logo size={20} />
    <span class="word">Gros mots</span>
    <span class="tag">spectateur</span>
    <span class="link">{link === 'live' ? 'en direct' : link === 'offline' ? 'hors ligne' : 'connexion…'}</span>
  </header>
  <div class="board">
    {#if snapshot}
      <Board view={snapshot} {now} {names} readonly />
    {:else}
      <p class="muted">{link === 'offline' ? 'Pas de réseau.' : 'Chargement…'}</p>
    {/if}
  </div>
  <p class="foot muted">Lecture seule. Le moins de points gagne.</p>
</div>

<style>
  .spectator {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .word {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.5rem;
    text-transform: uppercase;
  }
  .tag {
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--ink-2);
  }
  .link {
    margin-left: auto;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .board {
    flex: 1;
    min-height: 0;
  }
  .foot {
    margin: 0;
    text-align: center;
    font-size: var(--t-xs);
  }
</style>
