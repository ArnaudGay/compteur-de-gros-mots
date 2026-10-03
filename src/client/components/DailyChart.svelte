<script lang="ts">
  // Points par jour, un petit graphique par joueur (même échelle pour tous, pour comparer).
  import type { Player, PlayerStats } from '../../core/types';
  import { dayLabel } from '../lib/format';

  let { players, stats, days, todayKey }: { players: Player[]; stats: PlayerStats[]; days: string[]; todayKey: string } = $props();

  const H = 46;
  const TOP = 4;
  let width = $state(320);

  // Au-delà de 45 jours, on regroupe par semaine pour garder des barres lisibles.
  let weekly = $derived(days.length > 45);
  let buckets = $derived.by(() => {
    if (!weekly) return days.map((d, i) => ({ label: dayLabel(d, todayKey), from: i, to: i }));
    const result: { label: string; from: number; to: number }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push({ label: `semaine du ${dayLabel(days[i] ?? '', todayKey).toLowerCase()}`, from: i, to: Math.min(i + 6, days.length - 1) });
    }
    return result;
  });
  let series = $derived(
    stats.map((s) => ({
      stats: s,
      player: players.find((p) => p.id === s.playerId),
      values: buckets.map((b) => s.perDay.slice(b.from, b.to + 1).reduce((a, v) => a + v, 0)),
    })),
  );
  let max = $derived(Math.max(1, ...series.flatMap((s) => s.values)));
  let slot = $derived(width / Math.max(1, buckets.length));
  let bar = $derived(Math.max(2, Math.min(24, slot - 2)));

  let tip = $state<{ x: number; y: number; text: string } | null>(null);

  function column(value: number) {
    return value === 0 ? 0 : Math.max(3, (value / max) * (H - TOP));
  }

  /** Barre avec un bout arrondi de 4 px, carrée sur la ligne de base. */
  function path(x: number, h: number, w: number): string {
    const r = Math.min(4, w / 2, h);
    const y = H - h;
    return `M${x},${H}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H}Z`;
  }
</script>

<div class="multiples" bind:clientWidth={width}>
  {#each series as s (s.stats.playerId)}
    <figure class="panel">
      <figcaption>
        <span class="dot" style:background={`var(--hue-${s.player?.color ?? 'blue'})`}></span>
        <span class="who">{s.player?.name ?? '?'}</span>
        <span class="total">{s.stats.points}</span>
      </figcaption>
      <svg viewBox="0 0 {width} {H + 1}" width={width} height={H + 1} role="img" aria-label="{s.player?.name} : {s.stats.points} points sur la période, au plus {Math.max(...s.values)} {weekly ? 'par semaine' : 'par jour'}">
        <line class="base" x1="0" x2={width} y1={H + 0.5} y2={H + 0.5} />
        {#each s.values as value, i (i)}
          {@const h = column(value)}
          {@const x = i * slot + (slot - bar) / 2}
          {#if h > 0}<path d={path(x, h, bar)} style:fill={`var(--hue-${s.player?.color ?? 'blue'})`} />{/if}
          <rect
            class="hit"
            x={i * slot}
            y="0"
            width={slot}
            height={H}
            role="presentation"
            onpointerenter={() => (tip = { x: i * slot + slot / 2, y: 0, text: `${buckets[i]?.label} · ${value} point${value > 1 ? 's' : ''}` })}
            onpointerdown={() => (tip = { x: i * slot + slot / 2, y: 0, text: `${buckets[i]?.label} · ${value} point${value > 1 ? 's' : ''}` })}
            onpointerleave={() => (tip = null)}
          />
        {/each}
      </svg>
    </figure>
  {/each}
  <div class="axis">
    <span>{dayLabel(days[0] ?? todayKey, todayKey)}</span>
    <span>{weekly ? 'par semaine' : 'par jour'} · max {max}</span>
    <span>{dayLabel(days[days.length - 1] ?? todayKey, todayKey)}</span>
  </div>
  {#if tip}
    <div class="tip" style:left="{Math.min(Math.max(tip.x, 70), width - 70)}px" role="status">{tip.text}</div>
  {/if}
</div>

<style>
  .multiples {
    position: relative;
    display: grid;
    gap: 12px;
  }
  .panel {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--t-sm);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .who {
    font-weight: 650;
  }
  .total {
    margin-left: auto;
    font-weight: 700;
    color: var(--ink-2);
  }
  svg {
    display: block;
    overflow: visible;
  }
  .base {
    stroke: var(--rule-strong);
    stroke-width: 1;
  }
  .hit {
    fill: transparent;
  }
  .hit:hover {
    fill: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .axis {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .tip {
    position: absolute;
    top: -8px;
    transform: translateX(-50%);
    padding: 5px 9px;
    border-radius: 6px;
    background: var(--toast);
    color: var(--toast-ink);
    font-size: var(--t-xs);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
