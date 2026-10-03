<script lang="ts">
  import { PLAYER_HUES } from '../../core/defaults';
  import { de } from '../../core/french';
  import { DAY, HOUR } from '../../core/time';
  import type { Player } from '../../core/types';
  import Back from '../components/Back.svelte';
  import Icon from '../components/Icon.svelte';
  import PlayerName from '../components/PlayerName.svelte';
  import type { AdminOverview, JournalRow } from '../lib/api';
  import { ago, longDate, shortDate } from '../lib/format';
  import { shareLink } from '../lib/pwa';
  import { app } from '../lib/state.svelte';

  let overview = $state<AdminOverview | null>(null);
  let journal = $state<JournalRow[] | null>(null);
  let busy = $state(false);
  let confirm = $state<string | null>(null);
  let seasonName = $state('');
  let invites = $state<Record<string, string>>({});
  let editing = $state<string | null>(null);
  let editName = $state('');
  let newPlayer = $state({ name: '', color: 'magenta' });

  let view = $derived(app.view);
  let settings = $derived(view?.settings);
  let season = $derived(view?.seasons.find((s) => s.id === view?.currentSeasonId) ?? null);

  // Formulaire des réglages, initialisé depuis l'état courant.
  let form = $state({ price: '0', forfeit: '', merge: 20, suggest: 120, contest: 48, vote: 48, rules: '' });
  let formLoaded = false;
  $effect(() => {
    if (settings && !formLoaded) {
      formLoaded = true;
      form = {
        price: (settings.pricePerPointCents / 100).toFixed(2).replace('.', ','),
        forfeit: settings.forfeit,
        merge: Math.round(settings.mergeWindowMs / 1000),
        suggest: Math.round(settings.suggestWindowMs / 1000),
        contest: Math.round(settings.contestWindowMs / HOUR),
        vote: Math.round(settings.voteDurationMs / HOUR),
        rules: settings.rules,
      };
    }
  });

  async function refresh() {
    overview = await app.act(() => app.transport.adminOverview());
  }
  $effect(() => {
    void refresh();
  });

  async function run<T>(fn: () => Promise<T>, success: string): Promise<T | null> {
    busy = true;
    const result = await app.act(fn, () => success);
    busy = false;
    confirm = null;
    void refresh();
    return result;
  }

  async function invite(p: Player) {
    const result = await run(() => app.transport.invite(p.id), `Lien créé pour ${p.name}`);
    if (!result) return;
    invites = { ...invites, [p.id]: result.url };
    const shared = await shareLink(`Gros mots : invitation ${de(p.name)}`, `${p.name}, voici ton lien pour rejoindre le compteur de gros mots (valable 7 jours) :`, result.url);
    if (shared === 'copied') app.info('Lien copié', 'Colle-le dans un message.');
  }

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    const price = Math.round(Number(form.price.replace(',', '.')) * 100);
    if (!Number.isFinite(price) || price < 0) return app.info('Le prix du point est invalide.');
    await run(
      () =>
        app.transport.updateSettings({
          pricePerPointCents: price,
          forfeit: form.forfeit,
          mergeWindowMs: form.merge * 1000,
          suggestWindowMs: form.suggest * 1000,
          contestWindowMs: form.contest * HOUR,
          voteDurationMs: form.vote * HOUR,
        }),
      'Réglages enregistrés',
    );
  }

  async function saveRules() {
    await run(() => app.transport.updateSettings({ rules: form.rules }), 'Règles enregistrées');
  }

  async function addPlayer(event: SubmitEvent) {
    event.preventDefault();
    const id = newPlayer.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    if (id.length < 2) return app.info('Prénom trop court.');
    const result = await run(() => app.transport.addPlayer({ id, name: newPlayer.name, color: newPlayer.color }), `${newPlayer.name} ajouté au défi`);
    if (result) newPlayer = { name: '', color: 'magenta' };
  }

  function device(ua: string | null): string {
    if (!ua) return 'Navigateur';
    if (ua.includes('iPhone')) return 'iPhone';
    if (ua.includes('iPad')) return 'iPad';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('Macintosh')) return 'Mac';
    return 'Navigateur';
  }

  async function loadJournal() {
    journal = await app.act(() => app.transport.journal());
  }

  const ACTIONS: Record<string, string> = {
    report: 'a compté un gros mot',
    manual: 'a rattrapé des points',
    cancel: 'a retiré un signalement',
    split: 'a séparé un signalement',
    merge: 'a regroupé un signalement',
    word: 'a précisé un mot',
    contest: 'a demandé la VAR',
    vote: 'a voté',
    'contest-resolved': 'fin de VAR',
    void: 'a annulé un point',
    restore: 'a rétabli un point',
    'player-add': 'a ajouté un joueur',
    'player-update': 'a modifié un joueur',
    settings: 'a changé les réglages',
    launch: 'a lancé le défi',
    season: 'a ouvert une saison',
    'season-rename': 'a renommé une saison',
    seed: 'création du défi',
  };
</script>

<div class="page">
  <Back />
  <h1>Administration</h1>

  <!-- Lancement et saisons -->
  <h2 class="eyebrow section-title">Défi et saisons</h2>
  <div class="list">
    <div class="row column">
      {#if view?.phase === 'test'}
        <p><strong>Phase de test.</strong> Quand tout le monde est prêt, lance le défi : les points de test ne compteront plus, la première saison démarre.</p>
        <input class="input" maxlength="40" placeholder="Nom de la saison (par défaut : Saison 1)" bind:value={seasonName} />
        {#if confirm === 'launch'}
          <div class="pair">
            <button class="btn" onclick={() => (confirm = null)}>Pas encore</button>
            <button class="btn card" disabled={busy} onclick={() => run(() => app.transport.launch(seasonName || null), "C'est parti !")}>Oui, lancer</button>
          </div>
        {:else}
          <button class="btn primary" onclick={() => (confirm = 'launch')}>Lancer le défi officiellement</button>
        {/if}
      {:else}
        <p>Saison en cours : <strong>{season?.name ?? '—'}</strong>{#if season}{' '}depuis le {shortDate(season.startsAt)}{/if}.</p>
        <input class="input" maxlength="40" placeholder="Nom de la nouvelle saison" bind:value={seasonName} />
        {#if confirm === 'season'}
          <div class="pair">
            <button class="btn" onclick={() => (confirm = null)}>Annuler</button>
            <button class="btn card" disabled={busy} onclick={() => run(() => app.transport.newSeason(seasonName || null), 'Nouvelle saison ouverte')}>Clore et ouvrir</button>
          </div>
        {:else}
          <button class="btn" onclick={() => (confirm = 'season')}>Clore la saison et en ouvrir une nouvelle</button>
        {/if}
        {#if season && seasonName}
          <button class="btn small" disabled={busy} onclick={() => season && run(() => app.transport.renameSeason(season.id, seasonName), 'Saison renommée')}>Renommer la saison en cours</button>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Joueurs -->
  <h2 class="eyebrow section-title">Joueurs</h2>
  <div class="list">
    {#each overview?.players ?? [] as p (p.id)}
      <div class="row column player" class:archived={p.archivedAt !== null}>
        <div class="line">
          <PlayerName player={p} me={p.id === app.meId} />
          {#if p.isAdmin}<span class="tag">admin</span>{/if}
          {#if p.archivedAt !== null}<span class="tag">archivé</span>{/if}
        </div>
        <p class="hint">
          {p.hasPin ? 'code choisi' : p.pendingInvitation ? 'invitation en attente' : 'pas encore invité'} · Face ID : {p.passkeys} · notifications : {p.pushDevices}
        </p>
        {#if invites[p.id]}
          <p class="invite"><Icon name="link" size={16} /><span>{invites[p.id]}</span></p>
        {/if}
        {#if editing === p.id}
          <div class="edit">
            <input class="input" maxlength="24" bind:value={editName} aria-label="Prénom" />
            <div class="hues" role="radiogroup" aria-label="Couleur">
              {#each PLAYER_HUES as hue (hue)}
                <button
                  type="button"
                  class="hue"
                  class:on={p.color === hue}
                  role="radio"
                  aria-checked={p.color === hue}
                  aria-label={hue}
                  style:background={`var(--hue-${hue})`}
                  onclick={() => run(() => app.transport.updatePlayer(p.id, { color: hue }), 'Couleur changée')}
                ></button>
              {/each}
            </div>
            <div class="pair">
              <button class="btn small" onclick={() => (editing = null)}>Fermer</button>
              <button class="btn small primary" disabled={busy || !editName.trim()} onclick={() => run(() => app.transport.updatePlayer(p.id, { name: editName }), 'Prénom changé').then(() => (editing = null))}>Enregistrer</button>
            </div>
            {#if p.id !== app.meId}
              <div class="pair">
                <button class="btn small" disabled={busy} onclick={() => run(() => app.transport.updatePlayer(p.id, { isAdmin: !p.isAdmin }), p.isAdmin ? 'Droits retirés' : 'Droits donnés')}>{p.isAdmin ? "Retirer l'admin" : 'Rendre admin'}</button>
                <button class="btn small danger" disabled={busy} onclick={() => run(() => app.transport.updatePlayer(p.id, { archived: p.archivedAt === null }), p.archivedAt === null ? `${p.name} archivé` : `${p.name} de retour`)}>{p.archivedAt === null ? 'Archiver' : 'Désarchiver'}</button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="pair">
            <button class="btn small" disabled={busy || p.archivedAt !== null} onclick={() => invite(p)}><Icon name="share" size={16} /> {p.hasPin ? 'Nouveau code' : 'Inviter'}</button>
            <button
              class="btn small"
              onclick={() => {
                editing = p.id;
                editName = p.name;
              }}>Modifier</button
            >
          </div>
        {/if}
      </div>
    {/each}
    <form class="row column" onsubmit={addPlayer}>
      <p class="hint">Ajouter quelqu'un au défi (sa case s'ajoute en bas du tableau).</p>
      <div class="pair">
        <input class="input" maxlength="24" placeholder="Prénom" bind:value={newPlayer.name} aria-label="Prénom du nouveau joueur" />
        <button class="btn" type="submit" disabled={busy || newPlayer.name.trim().length < 2}><Icon name="plus" size={18} /> Ajouter</button>
      </div>
    </form>
  </div>
  <p class="note muted">« Nouveau code » envoie un lien pour choisir un nouveau code (code oublié). Il est valable 7 jours et ne sert qu'une fois.</p>

  <!-- Cagnotte et réglages -->
  <h2 class="eyebrow section-title">Cagnotte, fusion et VAR</h2>
  <form class="list" onsubmit={saveSettings}>
    <div class="row column">
      <div class="field">
        <label for="s-price">Prix d'un gros mot (€, 0 = pas de cagnotte)</label>
        <input id="s-price" class="input" inputmode="decimal" bind:value={form.price} />
      </div>
      <div class="field">
        <label for="s-forfeit">Gage du dernier</label>
        <input id="s-forfeit" class="input" maxlength="140" placeholder="Ex. le dernier paie le resto" bind:value={form.forfeit} />
      </div>
      <div class="grid2">
        <div class="field">
          <label for="s-merge">Fusion auto (s)</label>
          <input id="s-merge" class="input" type="number" min="5" max="120" bind:value={form.merge} />
        </div>
        <div class="field">
          <label for="s-suggest">« C'est le même ? » (s)</label>
          <input id="s-suggest" class="input" type="number" min="10" max="600" bind:value={form.suggest} />
        </div>
        <div class="field">
          <label for="s-contest">Délai pour contester (h)</label>
          <input id="s-contest" class="input" type="number" min="1" max="336" bind:value={form.contest} />
        </div>
        <div class="field">
          <label for="s-vote">Durée du vote (h)</label>
          <input id="s-vote" class="input" type="number" min="1" max="168" bind:value={form.vote} />
        </div>
      </div>
      <button class="btn primary" type="submit" disabled={busy}>Enregistrer</button>
    </div>
  </form>

  <!-- Règles -->
  <h2 class="eyebrow section-title">Règles du défi</h2>
  <div class="list">
    <div class="row column">
      <label class="sr-only" for="s-rules">Règles</label>
      <textarea id="s-rules" class="input rules" rows="12" maxlength="4000" bind:value={form.rules}></textarea>
      <p class="hint">Une ligne vide sépare les paragraphes ; « - » au début d'une ligne fait une liste.</p>
      <button class="btn" disabled={busy} onclick={saveRules}>Enregistrer les règles</button>
    </div>
  </div>

  <!-- Spectateur -->
  <h2 class="eyebrow section-title">Lien spectateur</h2>
  <div class="list">
    {#each overview?.spectatorLinks ?? [] as link (link.id)}
      <div class="row column">
        <p class="invite"><Icon name="eye" size={16} /><span>{link.url}</span></p>
        <div class="pair">
          <button class="btn small" onclick={() => shareLink('Gros mots : spectateur', 'Le classement du défi, en direct :', link.url)}><Icon name="share" size={16} /> Partager</button>
          <button class="btn small danger" disabled={busy} onclick={() => run(() => app.transport.revokeSpectatorLink(link.id), 'Lien révoqué')}>Révoquer</button>
        </div>
      </div>
    {/each}
    <div class="row column">
      <p class="hint">Un lien secret en lecture seule : classement et derniers points, en direct, sans compte.</p>
      <button class="btn" disabled={busy} onclick={() => run(() => app.transport.createSpectatorLink(), 'Lien spectateur créé')}>Créer un lien spectateur</button>
    </div>
  </div>

  <!-- Appareils -->
  <h2 class="eyebrow section-title">Appareils connectés</h2>
  <div class="list">
    {#each overview?.sessions ?? [] as s (s.id)}
      <div class="row">
        <span class="grow"
          ><PlayerName player={app.player(s.playerId)} size="sm" /><span class="hint">{device(s.userAgent)} · vu {ago(s.lastSeenAt, app.now)}</span></span
        >
        <button class="btn small danger" disabled={busy} onclick={() => run(() => app.transport.adminRevokeSession(s.id), 'Appareil déconnecté')}>Déconnecter</button>
      </div>
    {:else}
      <div class="row"><span class="hint">{app.transport.demo ? "Pas d'appareils dans la démo." : 'Aucun appareil connecté.'}</span></div>
    {/each}
  </div>

  <!-- Données -->
  <h2 class="eyebrow section-title">Données et sauvegardes</h2>
  <div class="list">
    <div class="row column">
      {#if !__DEMO__ && app.transport.downloadUrl('csv')}
        <div class="pair">
          <a class="btn small" href={app.transport.downloadUrl('csv')} download><Icon name="download" size={16} /> Export CSV</a>
          <a class="btn small" href={app.transport.downloadUrl('json')} download><Icon name="download" size={16} /> Export JSON</a>
        </div>
      {:else}
        <p class="hint">Exports : pas disponibles dans la démo.</p>
      {/if}
      <p class="hint">Une sauvegarde est faite chaque nuit vers 4 h ; les 30 dernières sont gardées sur le serveur.</p>
      {#each (overview?.backups ?? []).slice(0, 5) as b (b.name)}
        {@const url = app.transport.downloadUrl('backup', b.name)}
        <div class="backup">
          <span class="grow mono">{b.name}</span>
          <span class="hint">{Math.max(1, Math.round(b.size / 1024))} Ko</span>
          {#if !__DEMO__ && url}<a class="btn small" href={url} download aria-label="Télécharger {b.name}"><Icon name="download" size={16} /></a>{/if}
        </div>
      {/each}
      <button class="btn" disabled={busy} onclick={() => run(() => app.transport.backupNow(), 'Sauvegarde faite')}>Sauvegarder maintenant</button>
    </div>
  </div>

  <!-- Journal -->
  <h2 class="eyebrow section-title">Journal</h2>
  <div class="list">
    {#if journal}
      {#each journal.slice(0, 80) as entry, i (i)}
        <div class="row small-row">
          <span class="mono hint">{longDate(entry.at).replace(/ \d{4} à/, ',')}</span>
          <span class="grow">{entry.actorId ? app.name(entry.actorId) : 'Système'} {ACTIONS[entry.action] ?? entry.action}</span>
        </div>
      {:else}
        <div class="row"><span class="hint">Rien pour l'instant.</span></div>
      {/each}
    {:else}
      <div class="row column"><button class="btn" onclick={loadJournal}>Afficher les dernières actions</button></div>
    {/if}
  </div>
  <p class="note muted">Rien n'est jamais supprimé : chaque action est notée ici.</p>
  <p class="note muted">Les invitations expirent après {Math.round((7 * DAY) / DAY)} jours.</p>
</div>

<style>
  .column {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding-block: 14px;
  }
  .column p {
    margin: 0;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pair > * {
    flex: 1;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .player .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .archived {
    opacity: 0.6;
  }
  .tag {
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 5px;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    color: var(--ink-2);
  }
  .hint {
    display: block;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .invite {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    word-break: break-all;
    color: var(--ink-2);
    user-select: all;
  }
  .edit {
    display: grid;
    gap: 10px;
  }
  .hues {
    display: flex;
    gap: 10px;
  }
  .hue {
    width: 34px;
    height: 34px;
    border-radius: 6px;
    border: 3px solid transparent;
  }
  .hue.on {
    border-color: var(--ink);
  }
  .rules {
    min-height: 260px;
    font-size: 15px;
  }
  .backup {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--t-xs);
  }
  .backup .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .small-row {
    min-height: 40px;
    font-size: var(--t-sm);
    align-items: baseline;
  }
  .note {
    font-size: var(--t-xs);
    margin: 8px 4px 0;
  }
</style>
