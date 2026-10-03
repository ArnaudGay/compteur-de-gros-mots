<script lang="ts">
  import Icon, { type IconName } from '../components/Icon.svelte';
  import PlayerName from '../components/PlayerName.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { canInstall } from '../lib/pwa';
  import { router, type Route } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';
  import { SWITCH } from '../lib/ui';
  import type { ThemeChoice } from '../lib/storage';

  let me = $derived(app.me?.player);
  const links: { route: Route; icon: IconName; label: string; admin?: boolean; install?: boolean }[] = [
    { route: { name: 'rules' }, icon: 'book', label: 'Règles du défi' },
    { route: { name: 'account' }, icon: 'user', label: 'Mon compte, Face ID, notifications' },
    { route: { name: 'install' }, icon: 'install', label: "Installer l'app sur l'iPhone", install: true },
    { route: { name: 'admin' }, icon: 'shield', label: 'Administration', admin: true },
  ];
</script>

<div class="page">
  <h1>Plus</h1>
  {#if me}
    <p class="lede">Connecté en tant que <PlayerName player={me} />.</p>
  {/if}

  <div class="list">
    {#each links.filter((l) => (!l.admin || me?.isAdmin) && (!l.install || canInstall())) as link (link.label)}
      <button class="row link" onclick={() => router.go(link.route)}>
        <Icon name={link.icon} size={22} />
        <span class="grow">{link.label}</span>
        <Icon name="next" size={18} />
      </button>
    {/each}
  </div>

  <h2 class="eyebrow section-title">Affichage</h2>
  <div class="list">
    <div class="row column">
      <span>Thème</span>
      <Segmented
        label="Thème"
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'light', label: 'Clair' },
          { value: 'dark', label: 'Sombre' },
        ]}
        value={app.theme}
        onChange={(value: ThemeChoice) => app.setTheme(value)}
      />
    </div>
    <label class="row toggle">
      <span class="grow">Afficher les mots en clair<span class="hint">Sinon ils sont cachés sous une bande noire.</span></span>
      <input type="checkbox" {...SWITCH} checked={app.reveal} onchange={(e) => app.setReveal(e.currentTarget.checked)} />
    </label>
  </div>

  <p class="about muted">
    Gros mots {__APP_VERSION__}{#if app.transport?.demo}{' · '}démo avec des données fictives{/if}
  </p>
</div>

<style>
  .link {
    width: 100%;
    border: 0;
    background: var(--panel);
    text-align: left;
    font-size: var(--t-md);
  }
  .link:active {
    background: var(--sunken);
  }
  .column {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding-block: 12px;
  }
  .toggle {
    cursor: pointer;
  }
  .hint {
    display: block;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  input[type='checkbox'] {
    width: 22px;
    height: 22px;
    accent-color: var(--ink);
  }
  .about {
    margin-top: 28px;
    font-size: var(--t-xs);
    text-align: center;
  }
</style>
