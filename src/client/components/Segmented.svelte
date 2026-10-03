<script lang="ts" generics="T extends string">
  let { options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string } = $props();
</script>

<div class="segmented" role="radiogroup" aria-label={label} style:grid-template-columns={`repeat(${options.length}, 1fr)`}>
  {#each options as option (option.value)}
    <button type="button" role="radio" aria-checked={value === option.value} class:on={value === option.value} onclick={() => onChange(option.value)}>
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: grid;
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
    background: var(--sunken);
  }
  button {
    min-height: 34px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-2);
    white-space: nowrap;
  }
  button.on {
    background: var(--panel);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
</style>
