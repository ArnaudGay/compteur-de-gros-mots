<script lang="ts">
  import EpisodeSheet from './components/EpisodeSheet.svelte';
  import Logo from './components/Logo.svelte';
  import TabBar from './components/TabBar.svelte';
  import TileMenu from './components/TileMenu.svelte';
  import Toast from './components/Toast.svelte';
  import WordPicker from './components/WordPicker.svelte';
  import { router } from './lib/router.svelte';
  import { app } from './lib/state.svelte';
  import Account from './screens/Account.svelte';
  import Admin from './screens/Admin.svelte';
  import Counter from './screens/Counter.svelte';
  import History from './screens/History.svelte';
  import Install from './screens/Install.svelte';
  import Invite from './screens/Invite.svelte';
  import Login from './screens/Login.svelte';
  import More from './screens/More.svelte';
  import Ranking from './screens/Ranking.svelte';
  import Rules from './screens/Rules.svelte';
  import Spectator from './screens/Spectator.svelte';
  import Stats from './screens/Stats.svelte';

  let route = $derived(router.route);
  let scroller: HTMLElement | undefined = $state();

  // Chaque écran repart en haut.
  $effect(() => {
    void route.name;
    scroller?.scrollTo({ top: 0 });
  });
</script>

{#if route.name === 'invite'}
  <main class="plain"><Invite token={route.token} /></main>
{:else if route.name === 'spectator'}
  <main class="plain"><Spectator token={route.token} /></main>
{:else if app.phase === 'boot'}
  <div class="splash"><Logo size={44} /></div>
{:else if app.phase !== 'app'}
  <main class="plain"><Login /></main>
{:else}
  <div class="shell">
    <main class="screen" class:fixed={route.name === 'counter'} bind:this={scroller}>
      {#if route.name === 'counter'}
        <Counter />
      {:else if route.name === 'ranking'}
        <Ranking />
      {:else if route.name === 'history'}
        <History episodeId={route.episodeId} />
      {:else if route.name === 'stats'}
        <Stats />
      {:else if route.name === 'more'}
        <More />
      {:else if route.name === 'rules'}
        <Rules />
      {:else if route.name === 'account'}
        <Account />
      {:else if route.name === 'admin'}
        {#if app.me?.player.isAdmin}<Admin />{:else}<More />{/if}
      {:else if route.name === 'install'}
        <Install />
      {:else}
        <Counter />
      {/if}
    </main>
    <div class="toast-anchor">
      <Toast toast={app.toast} onDismiss={() => app.dismissToast()} />
    </div>
    <TabBar {route} votes={app.pendingVotes.length} go={(r) => router.go(r)} />
  </div>

  {#if app.sheet?.kind === 'word'}
    <WordPicker reportId={app.sheet.reportId} targetId={app.sheet.targetId} onClose={() => (app.sheet = null)} />
  {:else if app.sheet?.kind === 'tile'}
    <TileMenu targetId={app.sheet.targetId} onClose={() => (app.sheet = null)} />
  {:else if app.sheet?.kind === 'episode'}
    <EpisodeSheet episodeId={app.sheet.episodeId} onClose={() => (app.sheet = null)} />
  {/if}
{/if}

{#if app.transport?.demo && app.phase === 'app'}
  <div class="demo-flag" aria-hidden="true">démo</div>
{/if}

<style>
  .shell {
    position: relative;
    height: 100%;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    max-width: 640px;
    margin: 0 auto;
  }
  .screen {
    position: relative;
    min-height: 0;
    padding-top: var(--glass-top);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  /* Le compteur ne défile jamais : « clip » coupe sans en faire une zone de défilement. */
  .screen.fixed {
    overflow: hidden;
  }
  @supports (overflow: clip) {
    .screen.fixed {
      overflow: clip;
    }
  }
  .toast-anchor {
    position: relative;
    height: 0;
  }
  .plain {
    position: relative;
    height: 100%;
    padding-top: var(--glass-top);
    overflow-y: auto;
  }
  .splash {
    height: 100%;
    display: grid;
    place-items: center;
  }
  .demo-flag {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + var(--glass-top) + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    padding: 1px 8px;
    border-radius: 9px;
    background: var(--ink);
    color: var(--paper);
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    pointer-events: none;
    opacity: 0.75;
  }
</style>
