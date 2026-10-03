<script lang="ts">
  import type { Period, Snapshot } from '../../core/types';
  import Tile from './Tile.svelte';

  let {
    view,
    meId = null,
    now,
    names,
    readonly = false,
    onTap,
    onMore,
  }: {
    view: Snapshot;
    meId?: string | null;
    now: number;
    names: (id: string) => string;
    readonly?: boolean;
    onTap?: (playerId: string) => void;
    onMore?: (playerId: string) => void;
  } = $props();

  // Les cases gardent toujours la même place (ordre fixé par l'admin), quel que soit le classement.
  let players = $derived(view.players.filter((p) => p.archivedAt === null));
  let period = $derived<Period>(view.phase === 'test' || !view.currentSeasonId ? 'all' : 'season');
  let rows = $derived(Math.ceil(players.length / 2));
</script>

<div class="board" style:grid-template-rows={`repeat(${rows}, minmax(0, 1fr))`}>
  {#each players as player (player.id)}
    <Tile
      {player}
      total={view.totals[player.id]?.[period] ?? 0}
      today={view.totals[player.id]?.today ?? 0}
      last={view.last[player.id] ?? null}
      isMe={player.id === meId}
      {now}
      {names}
      {readonly}
      onTap={() => onTap?.(player.id)}
      onMore={() => onMore?.(player.id)}
    />
  {/each}
</div>

<style>
  .board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    min-height: 0;
    height: 100%;
  }
</style>
