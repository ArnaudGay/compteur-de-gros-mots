<script lang="ts">
  import { de, listing, plural } from '../../core/french';
  import { boundariesOf, segmentOf } from '../../core/merge';
  import type { EpisodeView, ReportView } from '../../core/types';
  import { clock, longDate, remaining } from '../lib/format';
  import { app } from '../lib/state.svelte';
  import Censored from './Censored.svelte';
  import Icon from './Icon.svelte';
  import PlayerName from './PlayerName.svelte';
  import Sheet from './Sheet.svelte';

  let { episodeId, onClose }: { episodeId: string; onClose: () => void } = $props();

  let loaded = $state<EpisodeView | null>(null);
  let missing = $state(false);
  let reason = $state('');
  let adminNote = $state('');
  let busy = $state(false);

  // L'épisode reste à jour en direct : on préfère la version de l'état reçu, sinon on la demande.
  // Un point tout juste tapé (« pending-… ») change d'identifiant une fois confirmé par le
  // serveur : on le retrouve grâce à son signalement.
  let pendingReportId = $derived(episodeId.startsWith('pending-') ? episodeId.slice('pending-'.length) : null);
  let live = $derived(
    app.view?.recent.find((e) => e.id === episodeId) ??
      (pendingReportId ? app.view?.recent.find((e) => e.reports.some((r) => r.id === pendingReportId)) : undefined) ??
      null,
  );
  let episode = $derived(live ?? loaded);
  let gone = $derived(missing || (pendingReportId !== null && !live && !app.pending.some((p) => p.id === pendingReportId && !p.cancel)));
  let isPending = $derived(!!episode && episode.id.startsWith('pending-'));

  $effect(() => {
    void app.snapshot?.version;
    if (live || episodeId.startsWith('pending-')) return;
    app.transport
      .episode(episodeId)
      .then((e) => {
        loaded = e;
      })
      .catch(() => {
        missing = true;
      });
  });

  let meId = $derived(app.meId);
  let isAdmin = $derived(app.me?.player.isAdmin === true);
  let target = $derived(episode ? app.player(episode.targetId) : undefined);
  let contest = $derived(episode?.contest ?? null);
  /** En cours de vote ou déjà jugé : le point ne se découpe plus et ne se regroupe plus. */
  let judged = $derived(!!contest && contest.status !== 'withdrawn');
  let activeReports = $derived(episode?.reports.filter((r) => r.cancelledAt === null) ?? []);
  let canContest = $derived(
    !!episode &&
      !!app.view &&
      episode.targetId === meId &&
      !episode.voided &&
      episode.points > 0 &&
      !isPending &&
      app.serverNow() - episode.createdAt <= app.view.settings.contestWindowMs &&
      (!contest || contest.status === 'withdrawn'),
  );
  let canVote = $derived(!!contest && !!meId && contest.status === 'open' && contest.voters.includes(meId) && !contest.votes[meId]);

  /** Épisodes voisins de la même personne, pour « C'est le même » (mêmes règles que le serveur). */
  let neighbours = $derived.by(() => {
    if (!episode || !app.view || episode.kind !== 'live' || episode.voided || judged) return [];
    const view = app.view;
    const window = Math.max(view.settings.suggestWindowMs, 120_000);
    const limits = boundariesOf(view.settings.challengeStartedAt, view.seasons);
    const side = segmentOf(episode.startedAt, limits);
    return view.recent.filter(
      (e) =>
        e.id !== episode.id &&
        e.targetId === episode.targetId &&
        e.kind === 'live' &&
        !e.voided &&
        e.points > 0 &&
        Math.abs(e.startedAt - episode.startedAt) <= window &&
        segmentOf(e.startedAt, limits) === side &&
        (!e.contest || e.contest.status === 'withdrawn'),
    );
  });

  function linkLabel(r: ReportView): string | null {
    if (r.link === 'auto') return 'regroupé automatiquement';
    if (r.link === 'merged') return 'regroupé à la main';
    if (r.link === 'split') return 'compté à part';
    if (r.link === 'manual') return 'rattrapé';
    return null;
  }

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  }

  const statusText: Record<string, string> = {
    open: 'Vote en cours',
    accepted: 'Point annulé par le vote',
    rejected: 'Point maintenu par le vote',
    withdrawn: 'Contestation retirée',
  };
</script>

<Sheet title={target ? `${plural(episode?.points ?? 0, 'point')} pour ${target.name}` : 'Détails'} {onClose}>
  {#if !episode}
    <p class="muted">{gone ? 'Ce point est introuvable.' : 'Chargement…'}</p>
  {:else}
    <p class="when">{longDate(episode.startedAt)}{#if episode.kind === 'manual'}{' · '}rattrapé après coup{/if}</p>
    {#if episode.voided}
      <p class="banner danger">
        {episode.voidReason === 'contest' ? 'Annulé par la VAR' : 'Annulé par l’admin'}{#if episode.voidNote} : {episode.voidNote}{/if}
      </p>
    {/if}
    {#if episode.note}<p class="note">« {episode.note} »</p>{/if}

    <h3 class="eyebrow">Témoins</h3>
    <div class="list">
      {#each episode.reports as r (r.id)}
        <div class="row report" class:cancelled={r.cancelledAt !== null}>
          <div class="grow">
            <div class="who">
              <PlayerName player={app.player(r.reporterId)} me={r.reporterId === meId} size="sm" />
              <span class="mono muted">{clock(r.occurredAt)}</span>
              {#if r.count > 1}<span class="count">×{r.count}</span>{/if}
              {#if r.word}<Censored word={r.word} />{/if}
            </div>
            <div class="sub muted">
              {#if r.cancelledAt !== null}retiré{#if r.cancelledBy && r.cancelledBy !== r.reporterId}{' '}par {app.name(r.cancelledBy)}{/if}{:else}{linkLabel(r) ?? 'premier signalement'}{/if}
            </div>
          </div>
          {#if r.cancelledAt === null && (r.reporterId === meId || (isAdmin && episode.targetId !== meId))}
            <div class="actions">
              {#if !isPending && episode.kind === 'live' && !episode.voided && !judged && activeReports.length > 1 && r.reporterId === meId}
                <button class="btn small" disabled={busy} onclick={() => run(() => app.splitTap(r.id))}>C'est un autre</button>
              {/if}
              {#if r.reporterId === meId}
                <button class="btn small" disabled={busy} onclick={() => app.openWord(r.id, episode.targetId)}>Mot</button>
              {/if}
              <button class="btn small danger" disabled={busy} onclick={() => app.cancelTap(r.id)}>Retirer</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if neighbours.length && !isPending && activeReports.some((r) => r.reporterId === meId)}
      <h3 class="eyebrow">C'est le même gros mot qu'un autre ?</h3>
      <div class="list">
        {#each neighbours as n (n.id)}
          {@const mine = activeReports.find((r) => r.reporterId === meId)}
          <button class="row pick" disabled={busy || !mine} onclick={() => mine && run(() => app.mergeTap(mine.id, n.id))}>
            <span class="grow">Regrouper avec le point de {clock(n.startedAt)} ({listing([...new Set(n.reports.filter((x) => x.cancelledAt === null).map((x) => app.name(x.reporterId)))])})</span>
            <Icon name="next" size={18} />
          </button>
        {/each}
      </div>
    {/if}

    {#if contest}
      <h3 class="eyebrow">
        <span class="var">VAR</span>
        {contest.status === 'withdrawn' && episode.voided && episode.voidReason === 'admin' ? 'Close : point annulé par l’admin' : statusText[contest.status]}
      </h3>
      <div class="list">
        <div class="row column">
          <p class="contest-head">
            {contest.openedBy === meId ? 'Tu contestes ce point' : `Contestation ${de(app.name(contest.openedBy))}`}{#if contest.status === 'open'}{' · '}{remaining(contest.deadline, app.now)}{/if}
          </p>
          {#if contest.reason}<p class="reason">« {contest.reason} »</p>{/if}
          <ul class="votes">
            {#each contest.voters as voter (voter)}
              {@const choice = contest.votes[voter]}
              <li>
                <PlayerName player={app.player(voter)} me={voter === meId} size="sm" />
                <span class="choice" class:valid={choice === 'valid'} class:invalid={choice === 'invalid'}>
                  {choice === 'valid' ? 'valable' : choice === 'invalid' ? 'pas valable' : 'en attente'}
                </span>
              </li>
            {/each}
          </ul>
          {#if canVote}
            <div class="vote">
              <button class="btn" disabled={busy} onclick={() => run(() => app.act(() => app.transport.vote(contest.id, 'valid'), () => 'Vote enregistré'))}>Valable</button>
              <button class="btn primary" disabled={busy} onclick={() => run(() => app.act(() => app.transport.vote(contest.id, 'invalid'), () => 'Vote enregistré'))}>Pas valable</button>
            </div>
          {/if}
          {#if contest.status === 'open' && contest.openedBy === meId}
            <button class="btn small" disabled={busy} onclick={() => run(() => app.act(() => app.transport.withdraw(contest.id), () => 'Contestation retirée'))}>Retirer ma contestation</button>
          {/if}
        </div>
      </div>
    {/if}

    {#if canContest}
      <h3 class="eyebrow">Ce point est injuste ?</h3>
      <div class="list">
        <div class="row column">
          <p class="muted small">Les trois autres votent. À la majorité, le point est annulé ou maintenu. Sans majorité au bout de 48 h, il reste.</p>
          <textarea class="input" rows="2" maxlength="200" placeholder="Pourquoi ? (facultatif)" bind:value={reason}></textarea>
          <button class="btn card" disabled={busy} onclick={() => run(() => app.act(() => app.transport.contest(episode.id, reason || null), () => 'VAR demandée : les autres vont voter'))}>
            <Icon name="var" size={20} /> Demander la VAR
          </button>
        </div>
      </div>
    {/if}

    {#if isAdmin && !isPending && episode.targetId !== meId}
      <h3 class="eyebrow">Admin</h3>
      <div class="list">
        <div class="row column">
          {#if episode.voided && episode.voidReason === 'admin'}
            <button class="btn" disabled={busy} onclick={() => run(() => app.act(() => app.transport.restoreEpisode(episode.id), () => 'Point rétabli'))}>Rétablir ce point</button>
          {:else if !episode.voided}
            <input class="input" maxlength="200" placeholder="Motif (facultatif)" bind:value={adminNote} />
            <button class="btn danger" disabled={busy} onclick={() => run(() => app.act(() => app.transport.voidEpisode(episode.id, adminNote || null), () => 'Point annulé'))}>Annuler ce point</button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .when {
    margin: 0 0 8px;
    color: var(--ink-2);
  }
  .banner {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: var(--radius);
    font-weight: 600;
  }
  .banner.danger {
    color: var(--danger);
    border: 1px solid currentColor;
  }
  .note,
  .reason {
    margin: 0 0 8px;
    font-style: italic;
    color: var(--ink-2);
  }
  h3 {
    margin: 22px 4px 8px;
  }
  .var {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--ink);
    color: var(--paper);
    margin-right: 4px;
  }
  .report .who {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .report .sub {
    font-size: var(--t-xs);
    margin-top: 2px;
  }
  .cancelled .who {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .count {
    font-weight: 700;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    max-width: 55%;
  }
  .row.column {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding-block: 14px;
  }
  .pick {
    width: 100%;
    border: 0;
    background: var(--panel);
    text-align: left;
  }
  .contest-head {
    margin: 0;
    font-weight: 600;
  }
  .votes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .votes li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .choice {
    font-size: var(--t-sm);
    color: var(--ink-3);
  }
  .choice.valid {
    color: var(--ok);
    font-weight: 600;
  }
  .choice.invalid {
    color: var(--danger);
    font-weight: 600;
  }
  .vote {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .small {
    font-size: var(--t-sm);
    margin: 0;
  }
</style>
