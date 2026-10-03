<script lang="ts">
  import { listing, plural } from '../../core/french';
  import type { EpisodeView } from '../../core/types';
  import { clock } from '../lib/format';
  import { app } from '../lib/state.svelte';
  import Censored from './Censored.svelte';

  let { episode, onOpen }: { episode: EpisodeView; onOpen: () => void } = $props();

  let target = $derived(app.player(episode.targetId));
  let active = $derived(episode.reports.filter((r) => r.cancelledAt === null));
  let reporters = $derived([...new Set(active.map((r) => r.reporterId))]);
  let witnesses = $derived(
    reporters.length === 1 && reporters[0] === episode.targetId ? 'autodénonciation' : reporters.length ? `par ${listing(reporters.map((id) => app.name(id)))}` : 'signalement retiré',
  );
  let pending = $derived(episode.id.startsWith('pending-'));
  let status = $derived.by((): { label: string; tone: 'danger' | 'card' | 'muted' } | null => {
    if (episode.voided && episode.voidReason === 'contest') return { label: 'Annulé par la VAR', tone: 'danger' };
    if (episode.voided) return { label: 'Annulé', tone: 'danger' };
    if (episode.contest?.status === 'open') return { label: 'VAR en cours', tone: 'card' };
    if (episode.contest?.status === 'rejected') return { label: 'Maintenu par la VAR', tone: 'muted' };
    if (pending) return { label: 'envoi…', tone: 'muted' };
    return null;
  });
</script>

<article class="item" class:struck={episode.voided || episode.points === 0}>
  <button type="button" class="open" onclick={onOpen} aria-label="Détails : {target?.name ?? '?'}, {plural(episode.points, 'point')}, {clock(episode.startedAt)}"></button>
  <span class="time mono">{clock(episode.startedAt)}</span>
  <span class="dot" style:background={`var(--hue-${target?.color ?? 'blue'})`} aria-hidden="true"></span>
  <span class="main">
    <span class="line">
      <span class="who">{target?.name ?? '?'}</span>
      <span class="points">+{episode.points}</span>
      {#if episode.word}<span class="word"><Censored word={episode.word} /></span>{/if}
    </span>
    <span class="sub">
      {witnesses}{#if episode.kind === 'manual'}{' · '}rattrapé{/if}{#if episode.note}{' · '}« {episode.note} »{/if}
    </span>
  </span>
  {#if status}<span class="status {status.tone}">{status.label}</span>{/if}
</article>

<style>
  .item {
    position: relative;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 8px 14px;
    background: var(--panel);
  }
  .open {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .open:active {
    background: var(--sunken);
  }
  .time {
    font-size: var(--t-sm);
    color: var(--ink-3);
    pointer-events: none;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    pointer-events: none;
  }
  .main {
    display: grid;
    min-width: 0;
    pointer-events: none;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .who {
    font-weight: 650;
    white-space: nowrap;
  }
  .points {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.15rem;
    line-height: 1;
  }
  .word {
    position: relative;
    z-index: 1;
    pointer-events: auto;
  }
  .sub {
    font-size: var(--t-sm);
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .struck .points,
  .struck .who {
    text-decoration: line-through;
    text-decoration-thickness: 1.5px;
    color: var(--ink-3);
  }
  .status {
    pointer-events: none;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 3px 6px;
    border-radius: 4px;
  }
  .status.card {
    background: var(--card);
    color: var(--card-ink);
  }
  .status.danger {
    color: var(--danger);
    border: 1px solid currentColor;
  }
  .status.muted {
    color: var(--ink-3);
  }
</style>
