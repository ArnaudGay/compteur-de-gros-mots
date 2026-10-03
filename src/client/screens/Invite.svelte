<script lang="ts">
  import InstallGuide from '../components/InstallGuide.svelte';
  import Keypad from '../components/Keypad.svelte';
  import Logo from '../components/Logo.svelte';
  import { canInstall } from '../lib/pwa';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';

  let { token }: { token: string } = $props();

  type Info = Awaited<ReturnType<typeof app.transport.invitation>>;
  let info = $state<Info | null>(null);
  let problem = $state<string | null>(null);
  let step = $state<'choose' | 'confirm' | 'done'>('choose');
  let first = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    app.transport
      .invitation(token)
      .then((i) => (info = i))
      .catch((e: Error) => (problem = e.message));
  });

  async function onCode(code: string) {
    error = null;
    if (step === 'choose') {
      first = code;
      step = 'confirm';
      return;
    }
    if (code !== first) {
      error = 'Les deux codes sont différents. Recommence.';
      step = 'choose';
      return;
    }
    busy = true;
    try {
      await app.transport.acceptInvitation(token, code);
      step = 'done';
    } catch (e) {
      error = (e as Error).message;
      step = 'choose';
    }
    busy = false;
  }

  async function start() {
    router.go({ name: 'counter' }, true);
    await app.loadMe();
  }
</script>

<div class="invite">
  <header>
    <Logo size={30} />
    {#if info}
      <p class="eyebrow">Invitation</p>
      <h1>{info.player.name}</h1>
    {:else}
      <h1>Gros mots</h1>
    {/if}
  </header>

  {#if problem}
    <p class="problem">{problem}</p>
    <button class="btn" onclick={() => router.go({ name: 'login' }, true)}>Aller à la connexion</button>
  {:else if !info}
    <p class="muted">Chargement de l'invitation…</p>
  {:else if step === 'done'}
    <div class="done">
      <p class="ok">C'est fait : tu fais partie du défi.</p>
      {#if canInstall()}
        <p>Dernière étape, la plus importante sur iPhone : installe l'app.</p>
        <div class="card"><InstallGuide /></div>
        <button class="btn block" onclick={start}>Plus tard, ouvrir le compteur</button>
      {:else}
        <button class="btn primary block" onclick={start}>Ouvrir le compteur</button>
      {/if}
    </div>
  {:else}
    <p class="ask">
      {#if step === 'choose'}
        {#if info.hasPin}
          Choisis ton nouveau code à 6 chiffres. Il remplacera l'ancien : tes autres appareils seront déconnectés et Face ID sera à réactiver.
        {:else}
          Choisis ton code à 6 chiffres.
        {/if}
      {:else}
        Retape-le pour confirmer.
      {/if}
    </p>
    {#key step}
      <Keypad {busy} {error} onComplete={onCode} />
    {/key}
    <p class="note">Évite 123456 ou six fois le même chiffre : les prénoms du défi sont connus de tous.</p>
  {/if}
</div>

<style>
  .invite {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 14px;
    padding: 24px var(--gutter) 32px;
    max-width: 440px;
    margin: 0 auto;
    text-align: center;
  }
  header {
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 3.2rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 0.9;
  }
  .ask {
    margin: 0;
    font-weight: 600;
  }
  .note {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
  .done {
    display: grid;
    gap: 14px;
    width: 100%;
    text-align: left;
  }
  .done p {
    margin: 0;
  }
  .ok {
    font-weight: 700;
    font-size: var(--t-lg);
    text-align: center;
  }
  .card {
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--panel);
    border: 1px solid var(--rule);
  }
</style>
