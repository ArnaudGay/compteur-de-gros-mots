<script lang="ts">
  import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
  import Back from '../components/Back.svelte';
  import Icon from '../components/Icon.svelte';
  import PlayerName from '../components/PlayerName.svelte';
  import type { PushPrefs, SessionRow } from '../lib/api';
  import { ago, shortDate } from '../lib/format';
  import { currentPushEndpoint, pushSupport, subscribePush, unsubscribePush } from '../lib/pwa';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';
  import { SWITCH } from '../lib/ui';

  let me = $derived(app.me);
  let passkeys = $derived(me?.passkeys ?? []);
  let support = pushSupport();
  let endpoint = $state<string | null>(null);
  let prefs = $state<PushPrefs | null>(null);
  let sessions = $state<SessionRow[]>([]);
  let busy = $state(false);
  let currentPin = $state('');
  let newPin = $state('');
  let confirmPin = $state('');
  let pinError = $state<string | null>(null);
  const webauthn = !app.transport.demo && typeof window !== 'undefined' && browserSupportsWebAuthn();

  $effect(() => {
    prefs = me?.push?.prefs ?? null;
  });

  $effect(() => {
    void currentPushEndpoint().then((e) => (endpoint = e));
    void app.transport
      .sessions()
      .then((s) => (sessions = s))
      .catch(() => undefined);
  });

  async function enableFaceId() {
    busy = true;
    const list = await app.act(() => app.transport.passkeyRegister(deviceName()), () => 'Face ID activé : la prochaine fois, un regard suffit.');
    if (list && app.me) app.me = { ...app.me, passkeys: list };
    busy = false;
  }

  async function removePasskey(id: string) {
    const list = await app.act(() => app.transport.passkeyRemove(id), () => 'Passkey supprimée');
    if (list && app.me) app.me = { ...app.me, passkeys: list };
  }

  async function enablePush() {
    if (!me?.push) return;
    busy = true;
    try {
      const subscription = await subscribePush(me.push.publicKey);
      prefs = await app.transport.pushSubscribe(subscription);
      endpoint = subscription.endpoint ?? null;
      app.info('Notifications activées sur cet iPhone');
    } catch (error) {
      app.error(error);
    }
    busy = false;
  }

  async function disablePush() {
    busy = true;
    const old = await unsubscribePush().catch(() => null);
    if (old) await app.transport.pushUnsubscribe(old).catch(() => undefined);
    endpoint = null;
    busy = false;
    app.info('Notifications désactivées sur cet appareil');
  }

  async function setPref(key: keyof PushPrefs, value: boolean) {
    const result = await app.act(() => app.transport.pushPrefs({ [key]: value }));
    if (result) prefs = result;
  }

  async function changePin(event: SubmitEvent) {
    event.preventDefault();
    pinError = null;
    if (!/^\d{6}$/.test(newPin)) return (pinError = 'Le nouveau code doit faire 6 chiffres.');
    if (newPin !== confirmPin) return (pinError = 'Les deux nouveaux codes ne sont pas identiques.');
    busy = true;
    try {
      await app.transport.changePin(currentPin, newPin);
      currentPin = newPin = confirmPin = '';
      app.info('Code modifié');
    } catch (error) {
      pinError = (error as Error).message;
    }
    busy = false;
  }

  async function revoke(id: string) {
    await app.act(() => app.transport.revokeSession(id), () => 'Appareil déconnecté');
    sessions = sessions.filter((s) => s.id !== id);
  }

  function deviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'PC';
    return 'Appareil';
  }

  function describe(s: SessionRow): string {
    const ua = s.userAgent ?? '';
    const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'PC' : 'Appareil';
    const how = s.method === 'passkey' ? 'Face ID' : s.method === 'invite' ? 'invitation' : 'code';
    return `${device} · connecté le ${shortDate(s.createdAt)} (${how})`;
  }

  const PREFS: { key: keyof PushPrefs; label: string }[] = [
    { key: 'point', label: 'Quand on me compte un gros mot' },
    { key: 'vote', label: 'Quand mon vote est demandé (VAR)' },
    { key: 'result', label: "Résultat d'une VAR qui me concerne" },
    { key: 'season', label: 'Fin de saison' },
  ];
</script>

<div class="page">
  <Back />
  <h1>Mon compte</h1>
  {#if me}<p class="lede"><PlayerName player={me.player} /></p>{/if}

  <h2 class="eyebrow section-title">Face ID</h2>
  <div class="list">
    {#each passkeys as p (p.id)}
      <div class="row">
        <Icon name="faceid" size={22} />
        <span class="grow">{p.label ?? 'Passkey'}<span class="hint">créée le {shortDate(p.createdAt)}{#if p.lastUsedAt}{' · '}utilisée {ago(p.lastUsedAt, app.now)}{/if}</span></span>
        <button class="btn small danger" onclick={() => removePasskey(p.id)}>Supprimer</button>
      </div>
    {/each}
    <div class="row column">
      {#if webauthn}
        <p class="hint">Connecte-toi d'un regard sur un nouvel appareil, sans taper ton code.</p>
        <button class="btn primary" disabled={busy} onclick={enableFaceId}><Icon name="faceid" size={20} /> {passkeys.length ? 'Ajouter cet appareil' : 'Activer Face ID'}</button>
      {:else}
        <p class="hint">{app.transport.demo ? 'Face ID : pas disponible dans la démo.' : 'Cet appareil ne prend pas en charge les passkeys.'}</p>
      {/if}
    </div>
  </div>

  <h2 class="eyebrow section-title">Notifications</h2>
  <div class="list">
    {#if support === 'install-first'}
      <div class="row column">
        <p class="hint">Sur iPhone, les notifications ne marchent que dans l'app installée sur l'écran d'accueil.</p>
        <button class="btn" onclick={() => router.go({ name: 'install' })}>Comment installer l'app</button>
      </div>
    {:else if support === 'denied'}
      <div class="row column"><p class="hint">Notifications bloquées. Autorise-les dans Réglages › Notifications › Gros mots.</p></div>
    {:else if support === 'unsupported'}
      <div class="row column"><p class="hint">{app.transport.demo ? 'Notifications : pas disponibles dans la démo.' : 'Cet appareil ne prend pas en charge les notifications.'}</p></div>
    {:else if !endpoint}
      <div class="row column">
        <p class="hint">Sois prévenu quand on te compte un gros mot ou quand ton vote est demandé.</p>
        <button class="btn primary" disabled={busy} onclick={enablePush}><Icon name="bell" size={20} /> Activer les notifications</button>
      </div>
    {:else}
      {#each PREFS as pref (pref.key)}
        <label class="row toggle">
          <span class="grow">{pref.label}</span>
          <input type="checkbox" {...SWITCH} checked={prefs?.[pref.key] ?? true} onchange={(e) => setPref(pref.key, e.currentTarget.checked)} />
        </label>
      {/each}
      <div class="row buttons">
        <button class="btn small" onclick={() => app.act(() => app.transport.pushTest(), (n) => (n > 0 ? 'Notification de test envoyée' : 'Aucun appareil abonné'))}>Envoyer un test</button>
        <button class="btn small danger" disabled={busy} onclick={disablePush}>Désactiver ici</button>
      </div>
    {/if}
  </div>

  <h2 class="eyebrow section-title">Changer mon code</h2>
  <form class="list" onsubmit={changePin}>
    <div class="row column">
      <div class="field">
        <label for="pin-current">Code actuel</label>
        <input id="pin-current" class="input" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" pattern="[0-9]*" bind:value={currentPin} />
      </div>
      <div class="field">
        <label for="pin-new">Nouveau code (6 chiffres)</label>
        <input id="pin-new" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*" bind:value={newPin} />
      </div>
      <div class="field">
        <label for="pin-confirm">Nouveau code, encore</label>
        <input id="pin-confirm" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*" bind:value={confirmPin} />
      </div>
      {#if pinError}<p class="error" role="alert">{pinError}</p>{/if}
      <button class="btn" type="submit" disabled={busy || currentPin.length !== 6}>Changer le code</button>
    </div>
  </form>

  <h2 class="eyebrow section-title">Mes appareils connectés</h2>
  <div class="list">
    {#each sessions as s (s.id)}
      <div class="row">
        <Icon name="phone" size={22} />
        <span class="grow">{describe(s)}<span class="hint">{s.current ? 'cet appareil' : `vu ${ago(s.lastSeenAt, app.now)}`}</span></span>
        {#if !s.current}<button class="btn small danger" onclick={() => revoke(s.id)}>Déconnecter</button>{/if}
      </div>
    {:else}
      <div class="row"><span class="hint">Aucun appareil.</span></div>
    {/each}
  </div>

  <button class="btn block logout" onclick={() => app.logout()}>Se déconnecter de cet appareil</button>
</div>

<style>
  .column {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding-block: 14px;
  }
  .hint {
    display: block;
    margin: 0;
    font-size: var(--t-sm);
    color: var(--ink-3);
  }
  .grow .hint {
    font-size: var(--t-xs);
  }
  .toggle {
    cursor: pointer;
  }
  input[type='checkbox'] {
    width: 22px;
    height: 22px;
    accent-color: var(--ink);
  }
  .buttons {
    justify-content: flex-end;
    gap: 8px;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
    font-size: var(--t-sm);
  }
  .logout {
    margin-top: 28px;
    color: var(--danger);
  }
</style>
