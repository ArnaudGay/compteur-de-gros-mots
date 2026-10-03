<script lang="ts">
  import type { Route } from '../lib/router.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let { route, votes, go }: { route: Route; votes: number; go: (route: Route) => void } = $props();

  const TABS: { name: Route['name']; label: string; icon: IconName; target: Route }[] = [
    { name: 'counter', label: 'Compteur', icon: 'tally', target: { name: 'counter' } },
    { name: 'ranking', label: 'Classement', icon: 'ranking', target: { name: 'ranking' } },
    { name: 'history', label: 'Historique', icon: 'history', target: { name: 'history', episodeId: null } },
    { name: 'stats', label: 'Stats', icon: 'stats', target: { name: 'stats' } },
    { name: 'more', label: 'Plus', icon: 'more', target: { name: 'more' } },
  ];
  const MORE: Route['name'][] = ['more', 'rules', 'account', 'admin', 'install'];

  let active = $derived(MORE.includes(route.name) ? 'more' : route.name);
</script>

<nav class="tabs" aria-label="Navigation">
  {#each TABS as tab (tab.name)}
    <button type="button" class:active={active === tab.name} aria-current={active === tab.name ? 'page' : undefined} onclick={() => go(tab.target)}>
      <span class="icon">
        <Icon name={tab.icon} size={24} />
        {#if tab.name === 'history' && votes > 0}<span class="badge" aria-label="{votes} vote{votes > 1 ? 's' : ''} en attente">{votes}</span>{/if}
      </span>
      <span class="label">{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    border-top: 1px solid var(--rule);
    background: var(--paper);
    padding: 4px 4px 2px;
  }
  button {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-height: 50px;
    padding: 4px 0 2px;
    border: 0;
    background: transparent;
    color: var(--ink-3);
  }
  button.active {
    color: var(--ink);
  }
  .icon {
    position: relative;
  }
  .label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .badge {
    position: absolute;
    top: -4px;
    right: -10px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--card);
    color: var(--card-ink);
    font-size: 0.6875rem;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
  }
</style>
