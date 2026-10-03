<script lang="ts">
  import { isInAppBrowser, isStandalone } from '../lib/pwa';
  import Icon from './Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  const inApp = isInAppBrowser();
</script>

{#if isStandalone()}
  <p class="done"><Icon name="check" size={20} /> L'app est installée sur ton écran d'accueil.</p>
{:else}
  <div class="guide" class:compact>
    {#if inApp}
      <p class="warn">Tu es dans WhatsApp, Messenger ou Instagram : ouvre d'abord ce lien dans Safari (menu ⋯ → « Ouvrir dans Safari »).</p>
    {/if}
    <ol>
      <li>
        <span class="step">1</span>
        <span>Dans Safari, touche <strong>Partager</strong> <span class="glyph"><Icon name="share" size={18} /></span> (en bas de l'écran, ou dans le menu ⋯ selon ta version d'iOS).</span>
      </li>
      <li>
        <span class="step">2</span>
        <span>Choisis <strong>« Sur l'écran d'accueil »</strong> <span class="glyph"><Icon name="install" size={18} /></span>, puis <strong>Ajouter</strong>.</span>
      </li>
      <li>
        <span class="step">3</span>
        <span>Ouvre <strong>Gros mots</strong> depuis ton écran d'accueil : tu y es déjà connecté. C'est là que marchent les notifications et Face ID.</span>
      </li>
    </ol>
  </div>
{/if}

<style>
  .guide {
    display: grid;
    gap: 12px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 14px;
  }
  li {
    display: grid;
    grid-template-columns: 30px 1fr;
    gap: 10px;
    align-items: start;
    line-height: 1.45;
  }
  .step {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.05rem;
  }
  .glyph {
    display: inline-flex;
    vertical-align: -3px;
    padding: 1px 3px;
    border: 1px solid var(--rule-strong);
    border-radius: 5px;
    background: var(--panel);
  }
  .warn {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--card-soft);
    font-weight: 600;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--ok);
    font-weight: 600;
  }
  .compact li {
    font-size: var(--t-sm);
  }
</style>
