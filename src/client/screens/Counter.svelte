<script lang="ts">
  import { listing } from '../../core/french';
  import type { Period } from '../../core/types';
  import { daysBetween } from '../../core/time';
  import Board from '../components/Board.svelte';
  import Icon from '../components/Icon.svelte';
  import Logo from '../components/Logo.svelte';
  import { clock, today } from '../lib/format';
  import { canInstall } from '../lib/pwa';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';
  import { readLocal, writeLocal } from '../lib/storage';

  let view = $derived(app.view);
  let season = $derived(view?.seasons.find((s) => s.id === view?.currentSeasonId) ?? null);
  let dayNumber = $derived(season && app.view ? daysBetween(today(season.startsAt), today(app.now)) + 1 : null);
  let period = $derived<Period>(view?.phase === 'live' && view.currentSeasonId ? 'season' : 'all');
  let total = $derived(view ? Object.values(view.totals).reduce((sum, t) => sum + t[period], 0) : 0);
  let waiting = $derived(app.waiting);
  let latest = $derived(
    (view?.recent ?? [])
      .filter((e) => !e.voided && e.points > 0)
      .slice(0, 3),
  );
  let installHidden = $state(readLocal('gm.install-hidden', false));

  const statusLabel = { live: 'en direct', connecting: 'reconnexion…', offline: 'hors ligne' } as const;
</script>

<div class="counter">
  <header class="top">
    <div class="brand">
      <Logo size={20} />
      <span class="word">Gros mots</span>
    </div>
    <span class="link {app.link}" role="status">
      <span class="pulse" aria-hidden="true"></span>{statusLabel[app.link]}{#if waiting}{' · '}{waiting} en attente{/if}
    </span>
  </header>
  <p class="sub">
    {#if view?.phase === 'test'}
      <span class="test">Phase de test</span> · les points seront remis à zéro au lancement
    {:else if season}
      {season.name} · jour {dayNumber} · {total} au total
    {/if}
  </p>

  {#if app.pendingVotes.length}
    {@const first = app.pendingVotes[0]}
    <button class="notice" onclick={() => first && router.go({ name: 'history', episodeId: first.episodeId })}>
      <span class="var">VAR</span>
      <span class="grow">{app.pendingVotes.length === 1 ? `${app.name(first?.openedBy ?? '')} conteste un point. Vote !` : `${app.pendingVotes.length} votes t'attendent.`}</span>
      <Icon name="next" size={18} />
    </button>
  {:else if canInstall() && !installHidden}
    <div class="notice install">
      <Icon name="install" size={20} />
      <button class="grow linkish" onclick={() => router.go({ name: 'install' })}>Installe l'app sur ton iPhone pour les notifications et Face ID</button>
      <button
        class="x"
        aria-label="Masquer"
        onclick={() => {
          installHidden = true;
          writeLocal('gm.install-hidden', true);
        }}><Icon name="close" size={16} /></button
      >
    </div>
  {/if}

  <div class="board-wrap">
    {#if view}
      <Board
        {view}
        meId={app.meId}
        now={app.now}
        names={(id) => app.name(id)}
        onTap={(id) => app.tap(id)}
        onMore={(id) => (app.sheet = { kind: 'tile', targetId: id })}
      />
    {:else}
      <div class="loading">Connexion au tableau…</div>
    {/if}
  </div>

  <section class="feed" aria-label="Derniers points">
    {#each latest as e (e.id)}
      {@const reporters = [...new Set(e.reports.filter((r) => r.cancelledAt === null).map((r) => r.reporterId))]}
      <button class="feed-row" onclick={() => (app.sheet = { kind: 'episode', episodeId: e.id })}>
        <span class="mono t">{clock(e.startedAt)}</span>
        <span class="dot" style:background={`var(--hue-${app.player(e.targetId)?.color ?? 'blue'})`}></span>
        <span class="n">{app.name(e.targetId)}{#if e.points > 1} ×{e.points}{/if}</span>
        <span class="by">{reporters.length === 1 && reporters[0] === e.targetId ? 'autodénonciation' : `par ${listing(reporters.map((id) => app.name(id)))}`}</span>
      </button>
    {:else}
      <p class="empty">Aucun gros mot pour l'instant. Pourvu que ça dure.</p>
    {/each}
  </section>
</div>

<style>
  .counter {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 6px 10px 0;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .word {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.55rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    line-height: 1;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-3);
  }
  .live .pulse {
    background: var(--ok);
  }
  .connecting .pulse {
    animation: blink 1s ease-in-out infinite;
  }
  .offline {
    color: var(--danger);
  }
  .offline .pulse {
    background: var(--danger);
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .sub {
    margin: -2px 4px 0;
    font-size: var(--t-sm);
    color: var(--ink-3);
    min-height: 1.2em;
  }
  .test {
    font-weight: 700;
    color: var(--ink);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 8px 6px 10px;
    border: 0;
    border-radius: var(--radius);
    background: var(--card);
    color: var(--card-ink);
    font-weight: 600;
    font-size: var(--t-sm);
    line-height: 1.3;
    text-align: left;
  }
  .notice.install {
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--rule);
  }
  .notice .grow {
    flex: 1;
    min-width: 0;
  }
  .linkish {
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font-weight: 600;
    font-size: var(--t-sm);
  }
  .x {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--ink-3);
  }
  .var {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--card-ink);
    color: var(--card);
    font-weight: 800;
    font-size: var(--t-xs);
    letter-spacing: 0.04em;
  }
  .board-wrap {
    flex: 1;
    min-height: 0;
  }
  .loading {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--ink-3);
  }
  .feed {
    display: grid;
    padding: 2px 0 6px;
    min-height: 0;
  }
  .feed-row {
    display: grid;
    grid-template-columns: auto auto auto 1fr;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    text-align: left;
    font-size: var(--t-sm);
  }
  .feed-row .t {
    color: var(--ink-3);
    font-size: var(--t-xs);
  }
  .feed-row .dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }
  .feed-row .n {
    font-weight: 650;
    white-space: nowrap;
  }
  .feed-row .by {
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    margin: 4px;
    font-size: var(--t-sm);
    color: var(--ink-3);
  }
  @media (max-height: 640px) {
    .feed {
      display: none;
    }
  }
</style>
