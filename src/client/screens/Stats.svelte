<script lang="ts">
  import { untrack } from 'svelte';
  import { plural } from '../../core/french';
  import type { StatsRange, StatsView } from '../../core/types';
  import Censored from '../components/Censored.svelte';
  import DailyChart from '../components/DailyChart.svelte';
  import Heatmap from '../components/Heatmap.svelte';
  import PlayerName from '../components/PlayerName.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { dayLabel, today } from '../lib/format';
  import { app } from '../lib/state.svelte';
  import { readLocal, writeLocal } from '../lib/storage';

  let range = $state<StatsRange>(readLocal<StatsRange>('gm.stats-range', '30d'));
  let stats = $state<StatsView | null>(null);
  let failed = $state(false);
  let asTable = $state(false);

  $effect(() => {
    const r = range;
    void app.snapshot?.version;
    untrack(() => {
      app.transport
        .stats(r)
        .then((s) => {
          stats = s;
          failed = false;
        })
        .catch(() => {
          failed = true;
        });
    });
  });

  let players = $derived(app.view?.players ?? []);
  let todayKey = $derived(today(app.now));
  let wordMax = $derived(Math.max(1, ...(stats?.topWords.map((w) => w.points) ?? [1])));
  let byStreak = $derived(stats ? [...stats.players].sort((a, b) => b.currentStreak - a.currentStreak) : []);
  let bySnitch = $derived(stats ? [...stats.players].sort((a, b) => b.reportsOnOthers - a.reportsOnOthers) : []);
</script>

<div class="page">
  <h1>Stats</h1>
  <Segmented
    label="Période"
    options={[
      { value: 'season', label: 'Saison' },
      { value: '30d', label: '30 jours' },
      { value: 'all', label: 'Tout' },
    ]}
    value={range}
    onChange={(value) => {
      range = value;
      writeLocal('gm.stats-range', value);
    }}
  />

  {#if failed && !stats}
    <p class="empty">Impossible de charger les stats. Vérifie le réseau.</p>
  {:else if !stats}
    <p class="empty">Chargement…</p>
  {:else}
    <p class="summary">
      <strong class="display">{stats.totalPoints}</strong>
      <span>{stats.totalPoints > 1 ? 'gros mots' : 'gros mot'} en {plural(stats.days.length, 'jour')}, soit {(stats.totalPoints / Math.max(1, stats.days.length)).toFixed(1).replace('.', ',')} par jour</span>
    </p>

    <section>
      <div class="section-head">
        <h2 class="eyebrow">Gros mots par jour</h2>
        <button class="linkish" onclick={() => (asTable = !asTable)}>{asTable ? 'Graphique' : 'Tableau'}</button>
      </div>
      <div class="card">
        {#if asTable}
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">Jour</th>
                  {#each stats.players as s (s.playerId)}<th scope="col">{app.name(s.playerId)}</th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each [...stats.days].reverse() as day, i (day)}
                  {@const index = stats.days.length - 1 - i}
                  <tr>
                    <th scope="row">{dayLabel(day, todayKey)}</th>
                    {#each stats.players as s (s.playerId)}<td>{s.perDay[index] ?? 0}</td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <DailyChart {players} stats={stats.players} days={stats.days} {todayKey} />
        {/if}
      </div>
    </section>

    <section>
      <h2 class="eyebrow section-title">Jours sans gros mot</h2>
      <div class="list">
        {#each byStreak as s (s.playerId)}
          <div class="row">
            <span class="grow">
              <PlayerName player={app.player(s.playerId)} me={s.playerId === app.meId} />
              <span class="detail">record : {plural(s.bestStreak, 'jour')}{#if s.worstDay}{' · '}pire journée : {s.worstDay.points} ({dayLabel(s.worstDay.day, todayKey).toLowerCase()}){/if}</span>
            </span>
            <span class="big display">{s.currentStreak}</span>
          </div>
        {/each}
      </div>
      <p class="note muted">Le chiffre compte les jours depuis le dernier gros mot, aujourd'hui compris.</p>
    </section>

    <section>
      <h2 class="eyebrow section-title">Moments critiques</h2>
      <div class="card"><Heatmap data={stats.heatmap} /></div>
    </section>

    <section>
      <h2 class="eyebrow section-title">Top des mots</h2>
      {#if stats.topWords.length}
        <div class="card words">
          {#each stats.topWords as w (w.word)}
            <div class="word-row">
              <span class="w"><Censored word={w.word} /></span>
              <span class="track"><span class="fill" style:width="{(w.points / wordMax) * 100}%"></span></span>
              <span class="v">{w.points}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="note muted">Aucun mot précisé pour l'instant. Après un +1, touche « Quel mot ? ».</p>
      {/if}
    </section>

    <section>
      <h2 class="eyebrow section-title">Qui balance le plus</h2>
      <div class="list">
        {#each bySnitch as s (s.playerId)}
          <div class="row">
            <span class="grow"><PlayerName player={app.player(s.playerId)} me={s.playerId === app.meId} /></span>
            <span class="muted small">{plural(s.selfReports, 'autodénonciation')}</span>
            <span class="big display">{s.reportsOnOthers}</span>
          </div>
        {/each}
      </div>
      <p class="note muted">Signalements faits sur les autres.</p>
    </section>
  {/if}
</div>

<style>
  .summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 18px 4px 6px;
    color: var(--ink-2);
  }
  .summary strong {
    font-size: 3rem;
    color: var(--ink);
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 28px 4px 8px;
  }
  .card {
    padding: 14px;
    border-radius: var(--radius-lg);
    background: var(--panel);
    border: 1px solid var(--rule);
  }
  .linkish {
    border: 0;
    background: transparent;
    padding: 6px 0;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .table-wrap {
    overflow-x: auto;
    max-height: 360px;
  }
  .data {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
  }
  .data th,
  .data td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--rule);
    text-align: right;
    white-space: nowrap;
  }
  .data th:first-child {
    text-align: left;
    font-weight: 500;
  }
  .data thead th {
    position: sticky;
    top: 0;
    background: var(--panel);
    font-weight: 700;
  }
  .detail {
    display: block;
    margin-top: 3px;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .big {
    font-size: 2.2rem;
    min-width: 2ch;
    text-align: right;
  }
  .small {
    font-size: var(--t-xs);
  }
  .note {
    font-size: var(--t-xs);
    margin: 8px 4px 0;
  }
  .words {
    display: grid;
    gap: 10px;
  }
  .word-row {
    display: grid;
    grid-template-columns: 7.5rem 1fr 2ch;
    align-items: center;
    gap: 10px;
  }
  .w {
    overflow: hidden;
    white-space: nowrap;
  }
  .track {
    height: 10px;
  }
  .fill {
    display: block;
    height: 100%;
    min-width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--ink-2);
  }
  .v {
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 40px 4px;
    color: var(--ink-3);
    text-align: center;
  }
</style>
