<script lang="ts">
  // Les points du jour en bâtons de comptage : quatre traits barrés par un cinquième.
  let { count, max = 15 }: { count: number; max?: number } = $props();

  const W = 4.6;
  const H = 16;
  const GROUP = 4 * W + 6;

  let shown = $derived(Math.min(count, max));
  let groups = $derived(Array.from({ length: Math.ceil(shown / 5) }, (_, g) => Math.min(5, shown - g * 5)));
  let width = $derived(Math.max(1, groups.length * GROUP - 6 + 2));

  /** Petit tremblé régulier, pour un trait « à la main ». */
  const jitter = (i: number) => (((i * 37) % 7) - 3) * 0.35;
</script>

<span class="tally" aria-label="{count} aujourd'hui">
  {#if count > 0}
    <svg viewBox="0 0 {width} {H + 2}" width={width} height={H + 2} aria-hidden="true">
      {#each groups as size, g (g)}
        {#each Array.from({ length: Math.min(size, 4) }) as _, i (i)}
          <line
            x1={1 + g * GROUP + i * W + jitter(g * 5 + i)}
            y1={1 + Math.abs(jitter(g + i))}
            x2={1 + g * GROUP + i * W - jitter(g * 5 + i + 1)}
            y2={H + 1 - Math.abs(jitter(g * 3 + i))}
          />
        {/each}
        {#if size === 5}
          <line x1={g * GROUP - 1} y1={H - 2} x2={g * GROUP + 3 * W + 3} y2={4} />
        {/if}
      {/each}
    </svg>
    {#if count > max}<span class="more">+{count - max}</span>{/if}
  {:else}
    <span class="none">rien aujourd'hui</span>
  {/if}
</span>

<style>
  .tally {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
    color: var(--ink-2);
  }
  svg {
    display: block;
    overflow: visible;
  }
  line {
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
  }
  .more {
    font-size: var(--t-xs);
    font-weight: 700;
  }
  .none {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
</style>
