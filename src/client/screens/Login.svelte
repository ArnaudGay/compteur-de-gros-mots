<script lang="ts">
  import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
  import Icon from '../components/Icon.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Logo from '../components/Logo.svelte';
  import type { LoginPlayer } from '../lib/api';
  import { app } from '../lib/state.svelte';

  let players = $state<LoginPlayer[]>([]);
  let chosen = $state<LoginPlayer | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let unreachable = $state(false);
  let loading = $state(false);
  const webauthn = app.transport.demo || (typeof window !== 'undefined' && browserSupportsWebAuthn());

  async function loadPlayers() {
    loading = true;
    try {
      players = await app.transport.loginPlayers();
      unreachable = false;
    } catch {
      unreachable = true;
    }
    loading = false;
  }

  // Serveur injoignable (pas de réseau, mise à jour en cours) : on réessaie dès que possible.
  $effect(() => {
    void loadPlayers();
    const retry = () => {
      if (unreachable && !loading && document.visibilityState === 'visible') void loadPlayers();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    const timer = setInterval(retry, 15_000);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      clearInterval(timer);
    };
  });

  async function submit(pin: string) {
    if (!chosen) return;
    busy = true;
    error = null;
    try {
      await app.transport.login(chosen.id, pin);
      await app.loadMe();
    } catch (e) {
      error = (e as Error).message;
    }
    busy = false;
  }

  async function faceId() {
    busy = true;
    error = null;
    try {
      await app.transport.passkeyLogin();
      await app.loadMe();
    } catch (e) {
      const message = (e as Error).message;
      if (!/annulé/i.test(message)) error = message;
    }
    busy = false;
  }
</script>

<div class="login">
  <header>
    <Logo size={34} />
    <h1>Gros mots</h1>
    <p>Le compteur d'Arnaud, Alexis, Alexandre et Gatho.</p>
  </header>

  {#if unreachable}
    <div class="unreachable">
      <p class="error">Impossible de joindre le serveur. Vérifie ta connexion, puis réessaie.</p>
      <button class="btn block" disabled={loading} onclick={loadPlayers}>{loading ? 'Connexion…' : 'Réessayer'}</button>
    </div>
  {:else if !chosen}
    {#if webauthn}
      <button class="btn primary block faceid" disabled={busy} onclick={faceId}><Icon name="faceid" size={22} /> Se connecter avec Face ID</button>
      {#if error}<p class="error">{error}</p>{/if}
      <p class="or">ou choisis ton prénom</p>
    {:else}
      <p class="or">Qui es-tu ?</p>
    {/if}
    <div class="players">
      {#each players as p (p.id)}
        <button class="player" disabled={!p.hasPin} onclick={() => (chosen = p)}>
          <span class="dot" style:background={`var(--hue-${p.color})`}></span>
          <span class="name">{p.name}</span>
          {#if !p.hasPin}<span class="hint">pas encore de code</span>{/if}
        </button>
      {/each}
    </div>
    <p class="note">Pas encore de code ? Demande ton lien d'invitation à l'admin.</p>
  {:else}
    <div class="pin">
      <button class="change" onclick={() => ((chosen = null), (error = null))}>
        <Icon name="back" size={18} /> <span class="dot" style:background={`var(--hue-${chosen.color})`}></span>{chosen.name}
      </button>
      <p class="ask">Ton code à 6 chiffres</p>
      <Keypad {busy} {error} onComplete={submit} />
    </div>
  {/if}
</div>

<style>
  .login {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    padding: 24px var(--gutter) 32px;
    max-width: 420px;
    margin: 0 auto;
  }
  header {
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
    margin-bottom: 8px;
  }
  h1 {
    margin: 4px 0 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 3rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 0.9;
  }
  header p {
    margin: 0;
    color: var(--ink-3);
    font-size: var(--t-sm);
  }
  .faceid {
    min-height: 54px;
    font-size: var(--t-lg);
  }
  .unreachable {
    display: grid;
    gap: 12px;
  }
  .or {
    margin: 6px 0 0;
    text-align: center;
    color: var(--ink-3);
    font-size: var(--t-sm);
  }
  .players {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .player {
    display: grid;
    justify-items: start;
    gap: 4px;
    min-height: 72px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--rule);
    background: var(--panel);
    text-align: left;
  }
  .player:active {
    background: var(--sunken);
  }
  .player:disabled {
    opacity: 0.55;
  }
  .player .name {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.4rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .hint {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .note {
    margin: 4px 0 0;
    text-align: center;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .pin {
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .change {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    padding: 0 12px;
    border: 1px solid var(--rule);
    border-radius: 22px;
    background: var(--panel);
    font-weight: 700;
  }
  .ask {
    margin: 10px 0 0;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: var(--danger);
    text-align: center;
    font-weight: 600;
    font-size: var(--t-sm);
  }
</style>
