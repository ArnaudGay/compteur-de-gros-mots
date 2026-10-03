<script lang="ts">
  import FlipDigit from './FlipDigit.svelte';

  let { value, label }: { value: number; label?: string } = $props();
  // Indexés depuis la droite : les unités restent en place quand on passe de 9 à 10.
  let digits = $derived(
    String(Math.max(0, value))
      .split('')
      .map((d, i, all) => ({ d, key: all.length - i })),
  );
</script>

<span class="number" role="img" aria-label={label ?? String(value)}>
  {#each digits as item (item.key)}
    <FlipDigit digit={item.d} />
  {/each}
</span>

<style>
  .number {
    display: inline-flex;
    font-family: var(--font-display);
    font-weight: 900;
    line-height: 1;
  }
</style>
