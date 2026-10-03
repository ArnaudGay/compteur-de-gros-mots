<script lang="ts">
  import { router, type Route } from '../lib/router.svelte';
  import Icon from './Icon.svelte';

  let { to = { name: 'more' }, label = 'Plus' }: { to?: Route; label?: string } = $props();
</script>

<button type="button" class="back" onclick={() => router.go(to)}><Icon name="back" size={20} /> {label}</button>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: var(--tap);
    margin-left: -6px;
    padding: 0 6px 0 0;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-weight: 600;
  }
</style>
