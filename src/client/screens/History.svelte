<script lang="ts">
  import { untrack } from 'svelte';
  import type { EpisodeView } from '../../core/types';
  import { dayKey } from '../../core/time';
  import EpisodeRow from '../components/EpisodeRow.svelte';
  import { dayLabel, today, TZ } from '../lib/format';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';

  let { episodeId = null }: { episodeId?: string | null } = $props();

  let filter = $state<string>('all');
  let loaded = $state<EpisodeView[]>([]);
  let next = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state(false);

  // Lien direct vers un point (notification de vote) : on ouvre sa fiche.
  $effect(() => {
    if (episodeId) {
      app.sheet = { kind: 'episode', episodeId };
      router.go({ name: 'history', episodeId: null }, true);
    }
  });

  async function load(reset: boolean) {
    loading = true;
    failed = false;
    try {
      const page = await app.transport.history({
        before: reset ? null : next,
        limit: 40,
        player: filter !== 'all' && filter !== 'var' ? filter : null,
        contested: filter === 'var',
      });
      loaded = reset ? page.items : [...loaded, ...page.items];
      next = page.next;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  /**
   * L'état du défi a changé : on rafraîchit tout ce qui est déjà affiché, sans revenir à la
   * première page (les pages chargées avec « Voir plus » restent là).
   */
  async function refresh() {
    const count = Math.min(200, Math.max(40, loaded.length));
    try {
      const page = await app.transport.history({
        before: null,
        limit: count,
        player: filter !== 'all' && filter !== 'var' ? filter : null,
        contested: filter === 'var',
      });
      if (loaded.length <= count) {
        loaded = page.items;
        next = page.next;
      } else {
        const fresh = new Set(page.items.map((e) => e.id));
        loaded = [...page.items, ...loaded.slice(count).filter((e) => !fresh.has(e.id))];
      }
    } catch {
      // Pas de réseau : on garde la liste affichée.
    }
  }

  // Nouveau filtre : on repart de la première page.
  $effect(() => {
    void filter;
    untrack(() => void load(true));
  });

  // Chaque changement d'état (un point, un vote…) : rafraîchissement groupé, une fois par demi-seconde au plus.
  let seenVersion: number | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const version = app.snapshot?.version ?? null;
    untrack(() => {
      if (seenVersion !== null && version !== null && version !== seenVersion && !refreshTimer) {
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          void refresh();
        }, 500);
      }
      if (version !== null) seenVersion = version;
    });
  });
  $effect(() => () => {
    if (refreshTimer) clearTimeout(refreshTimer);
  });

  /** Les points tout juste tapés (pas encore confirmés) apparaissent aussi, en direct. */
  let items = $derived.by(() => {
    const live = (app.view?.recent ?? []).filter(
      (e) => (filter === 'all' || e.targetId === filter || (filter === 'var' && e.contest?.status === 'open')) && e.voidReason !== 'merged',
    );
    const byId = new Map<string, EpisodeView>();
    for (const e of loaded) byId.set(e.id, e);
    const oldest = loaded.length && next ? loaded[loaded.length - 1]!.startedAt : -Infinity;
    for (const e of live) if (e.startedAt >= oldest) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
  });

  let groups = $derived.by(() => {
    const result: { key: string; items: EpisodeView[] }[] = [];
    for (const e of items) {
      const key = dayKey(e.startedAt, TZ);
      const group = result[result.length - 1];
      if (group && group.key === key) group.items.push(e);
      else result.push({ key, items: [e] });
    }
    return result;
  });

  let players = $derived(app.view?.players.filter((p) => p.archivedAt === null) ?? []);
</script>

<div class="page">
  <h1>Historique</h1>
  <div class="filters" role="group" aria-label="Filtrer">
    <button class="chip" class:on={filter === 'all'} onclick={() => (filter = 'all')}>Tous</button>
    {#each players as p (p.id)}
      <button class="chip" class:on={filter === p.id} onclick={() => (filter = p.id)}>
        <span class="dot" style:background={`var(--hue-${p.color})`}></span>{p.name}
      </button>
    {/each}
    <button class="chip" class:on={filter === 'var'} onclick={() => (filter = 'var')}>VAR en cours</button>
  </div>

  {#each groups as group (group.key)}
    <h2 class="eyebrow section-title">{dayLabel(group.key, today(app.now))}</h2>
    <div class="list">
      {#each group.items as e (e.id)}
        <EpisodeRow episode={e} onOpen={() => (app.sheet = { kind: 'episode', episodeId: e.id })} />
      {/each}
    </div>
  {:else}
    {#if !loading}
      <p class="empty">{failed ? "Impossible de charger l'historique. Vérifie le réseau." : filter === 'var' ? 'Aucune contestation en cours.' : 'Rien pour le moment.'}</p>
    {/if}
  {/each}

  {#if next}
    <button class="btn block more" disabled={loading} onclick={() => load(false)}>{loading ? 'Chargement…' : 'Voir plus'}</button>
  {/if}
</div>

<style>
  .filters {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 0 calc(-1 * var(--gutter));
    padding: 4px var(--gutter) 2px;
    scrollbar-width: none;
  }
  .filters::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--rule-strong);
    background: var(--panel);
    font-size: var(--t-sm);
    font-weight: 600;
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .empty {
    margin: 32px 4px;
    color: var(--ink-3);
    text-align: center;
  }
  .more {
    margin-top: 16px;
  }
</style>
