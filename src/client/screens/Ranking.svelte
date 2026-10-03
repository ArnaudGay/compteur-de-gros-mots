<script lang="ts">
  import { plural } from '../../core/french';
  import type { Period, Season, StatsView } from '../../core/types';
  import PlayerName from '../components/PlayerName.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { ago, daysSince, money, shortDate } from '../lib/format';
  import { app } from '../lib/state.svelte';
  import { readLocal, writeLocal } from '../lib/storage';

  let view = $derived(app.view);
  let live = $derived(view?.phase === 'live' && !!view.currentSeasonId);
  let period = $state<Period>(readLocal<Period>('gm.ranking-period', 'season'));
  let effective = $derived<Period>(!live && period === 'season' ? 'all' : period);

  let options = $derived(
    [
      { value: 'today' as const, label: 'Jour' },
      { value: 'week' as const, label: 'Semaine' },
      { value: 'month' as const, label: 'Mois' },
      ...(live ? [{ value: 'season' as const, label: 'Saison' }] : []),
      { value: 'all' as const, label: 'Total' },
    ],
  );

  /** Du plus sage au plus grossier ; les ex æquo partagent le même rang. */
  let rows = $derived.by(() => {
    if (!view) return [];
    const players = view.players.filter((p) => p.archivedAt === null);
    const sorted = players
      .map((p) => ({ player: p, points: view.totals[p.id]?.[effective] ?? 0, last: view.last[p.id] }))
      .sort((a, b) => a.points - b.points || a.player.position - b.player.position);
    const best = sorted[0]?.points ?? 0;
    return sorted.map((row) => ({
      ...row,
      rank: sorted.findIndex((r) => r.points === row.points) + 1,
      tied: sorted.filter((r) => r.points === row.points).length > 1,
      gap: row.points - best,
    }));
  });
  let worst = $derived(rows.length > 1 && rows[rows.length - 1]!.points > rows[0]!.points ? rows[rows.length - 1]!.points : null);
  let price = $derived(view?.settings.pricePerPointCents ?? 0);
  let pot = $derived(rows.reduce((sum, r) => sum + r.points, 0) * price);
  let season = $derived(view?.seasons.find((s) => s.id === view?.currentSeasonId) ?? null);
  let past = $derived((view?.seasons ?? []).filter((s) => s.endsAt !== null).reverse());

  let pastSeason = $state<Season | null>(null);
  let pastStats = $state<StatsView | null>(null);

  async function openSeason(s: Season) {
    pastSeason = s;
    pastStats = null;
    pastStats = await app.act(() => app.transport.stats('season', s.id));
  }

  const periodLabel: Record<Period, string> = { today: "aujourd'hui", week: 'cette semaine', month: 'ce mois-ci', season: 'cette saison', all: 'au total' };
</script>

<div class="page">
  <h1>Classement</h1>
  <p class="lede">Le moins de points gagne.{#if season && live}{' '}{season.name} depuis le {shortDate(season.startsAt)}{/if}</p>

  <Segmented
    label="Période"
    {options}
    value={effective}
    onChange={(value) => {
      period = value;
      writeLocal('gm.ranking-period', value);
    }}
  />

  <ol class="list ranking">
    {#each rows as row (row.player.id)}
      {@const days = row.last ? daysSince(row.last.at, app.now) : null}
      <li class="row" class:me={row.player.id === app.meId}>
        <span class="rank display">{row.rank}</span>
        <span class="grow">
          <span class="line">
            <PlayerName player={row.player} me={row.player.id === app.meId} />
            {#if row.rank === 1 && worst !== null}<span class="tag best">en tête</span>{/if}
            {#if worst !== null && row.points === worst}<span class="tag worst">lanterne rouge</span>{/if}
          </span>
          <span class="detail">
            {#if row.gap > 0}{plural(row.gap, 'point')} de retard{' · '}{/if}{#if row.last}dernier {ago(row.last.at, app.now)}{#if days !== null && days > 0}{' · '}{plural(days, 'jour')} sans{/if}{:else}aucun gros mot{/if}{#if price > 0}{' · '}doit {money(row.points * price)}{/if}
          </span>
        </span>
        <span class="points display" aria-label="{plural(row.points, 'point')} {periodLabel[effective]}">{row.points}</span>
      </li>
    {/each}
  </ol>
  {#if rows.some((r) => r.tied)}<p class="note muted">Même nombre de points : même rang.</p>{/if}

  {#if price > 0 || view?.settings.forfeit}
    <section class="pot">
      {#if price > 0}
        <div>
          <span class="eyebrow">Cagnotte {periodLabel[effective]}</span>
          <strong class="display">{money(pot)}</strong>
          <span class="muted">{money(price)} par gros mot</span>
        </div>
      {/if}
      {#if view?.settings.forfeit}
        <div>
          <span class="eyebrow">Gage de la lanterne rouge</span>
          <p>{view.settings.forfeit}</p>
        </div>
      {/if}
    </section>
  {/if}

  {#if past.length}
    <h2 class="eyebrow section-title">Saisons terminées</h2>
    <div class="list">
      {#each past as s (s.id)}
        <button class="row season" onclick={() => openSeason(s)}>
          <span class="grow">{s.name}</span>
          <span class="muted">{shortDate(s.startsAt)} → {s.endsAt ? shortDate(s.endsAt) : ''}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if pastSeason}
  <Sheet title={pastSeason.name} onClose={() => (pastSeason = null)}>
    {#if !pastStats}
      <p class="muted">Chargement…</p>
    {:else}
      {@const final = [...pastStats.players].sort((a, b) => a.points - b.points)}
      <ol class="list ranking">
        {#each final as s, i (s.playerId)}
          <li class="row">
            <span class="rank display">{final.findIndex((x) => x.points === s.points) + 1}</span>
            <span class="grow"><PlayerName player={app.player(s.playerId)} /></span>
            <span class="points display">{s.points}</span>
          </li>
          {#if i === final.length - 1 && price > 0}
            <li class="row muted">Cagnotte : {money(pastStats.totalPoints * price)}</li>
          {/if}
        {/each}
      </ol>
    {/if}
  </Sheet>
{/if}

<style>
  .ranking {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
  }
  .ranking .row {
    min-height: 66px;
  }
  .rank {
    width: 28px;
    font-size: 1.9rem;
    text-align: center;
    color: var(--ink-3);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .detail {
    display: block;
    margin-top: 3px;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .points {
    font-size: 2.6rem;
    min-width: 2ch;
    text-align: right;
  }
  .tag {
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 5px;
    border-radius: 3px;
  }
  .tag.best {
    border: 1px solid var(--ok);
    color: var(--ok);
  }
  .tag.worst {
    border: 1px solid var(--danger);
    color: var(--danger);
  }
  .note {
    font-size: var(--t-xs);
    margin: 8px 4px 0;
  }
  .pot {
    display: grid;
    gap: 14px;
    margin-top: 18px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--panel);
    border: 1px solid var(--rule);
  }
  .pot div {
    display: grid;
    gap: 2px;
  }
  .pot strong {
    font-size: 2.4rem;
  }
  .pot p {
    margin: 2px 0 0;
    font-weight: 600;
  }
  .season {
    width: 100%;
    border: 0;
    background: var(--panel);
    text-align: left;
  }
</style>
