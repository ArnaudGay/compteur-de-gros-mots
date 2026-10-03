// Démo cliquable : le vrai cœur métier tourne dans le navigateur, sans serveur.
// Deux semaines d'historique fictif, et les « amis » tapent de temps en temps.

import * as cmd from '../../core/commands';
import { DEFAULT_PLAYERS, DEFAULT_SETTINGS } from '../../core/defaults';
import { DomainError } from '../../core/errors';
import { buildStats } from '../../core/stats';
import { Store } from '../../core/store';
import { DAY, HOUR, MINUTE } from '../../core/time';
import type { Player, Snapshot } from '../../core/types';
import { buildSnapshot, episodeView, history } from '../../core/views';
import { ApiError, type AdminOverview, type Me, type PushPrefs, type StreamHandlers, type Transport } from './api';

const WORDS = ['putain', 'merde', 'putain', 'bordel', 'con', 'putain', 'chiant', 'merde', 'fait chier'];

/** Générateur pseudo-aléatoire reproductible : la démo est la même à chaque ouverture. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedStore(now: number): Store {
  const players: Player[] = DEFAULT_PLAYERS.map((p, position) => ({ ...p, position, archivedAt: null, createdAt: now - 20 * DAY }));
  const store = new Store({ players, episodes: [], reports: [], contests: [], seasons: [], settings: { ...DEFAULT_SETTINGS, pricePerPointCents: 50, forfeit: 'La lanterne rouge paie le resto.' } });
  const rand = random(42);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const ids = players.map((p) => p.id);
  // Penchants de chacun : de quoi avoir un classement lisible.
  const rate: Record<string, number> = { arnaud: 1.1, alexis: 0.6, alexandre: 1.9, gatho: 1.4 };
  let n = 0;
  const id = () => `demo-${(n++).toString(36).padStart(8, '0')}`;

  store.transact(() => {
    cmd.launchChallenge(store, { now: now - 15 * DAY, actorId: 'arnaud', newId: id }, { seasonName: 'Saison 1' });
    for (let day = 14; day >= 0; day--) {
      for (const target of ids) {
        const count = Math.floor(rand() * (rate[target] ?? 1) * 2.2);
        for (let k = 0; k < count; k++) {
          const at = now - day * DAY - Math.floor(rand() * 14 * HOUR) - 30 * MINUTE;
          if (at >= now - 10 * MINUTE) continue;
          const witness = pick(ids.filter((p) => p !== target || rand() < 0.15));
          cmd.report(store, { now: at, actorId: witness, newId: id }, { id: id(), targetId: target, occurredAt: at, word: rand() < 0.7 ? pick(WORDS) : null });
          // Souvent, un deuxième témoin confirme quelques secondes après.
          if (rand() < 0.35) {
            const second = pick(ids.filter((p) => p !== witness));
            const later = at + 2000 + Math.floor(rand() * 9000);
            cmd.report(store, { now: later, actorId: second, newId: id }, { id: id(), targetId: target, occurredAt: later });
          }
        }
      }
    }
    // Une VAR en cours : Gatho conteste un point d'hier, à toi de voter.
    const yesterday = now - 20 * HOUR;
    const point = cmd.report(store, { now: yesterday, actorId: 'alexis', newId: id }, { id: id(), targetId: 'gatho', occurredAt: yesterday, word: 'bordel' });
    cmd.openContest(store, { now: now - 3 * HOUR, actorId: 'gatho', newId: id }, { episodeId: point.episodeId, reason: 'Je lisais un titre de film à voix haute.' });
    cmd.vote(store, { now: now - 2 * HOUR, actorId: 'alexandre', newId: id }, { contestId: [...store.contests.values()][0]?.id ?? '', choice: 'valid' });
  });
  return store;
}

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDemoTransport(): Transport {
  const store = seedStore(Date.now());
  let meId: string | null = 'arnaud';
  let prefs: PushPrefs = { point: true, vote: true, result: true, season: true };
  const listeners = new Set<StreamHandlers>();
  let n = 0;
  const newId = () => `demo-live-${(n++).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  const publish = () => {
    const snap: Snapshot = buildSnapshot(store, Date.now());
    for (const l of listeners) l.snapshot(snap);
  };

  const run = <T,>(fn: (now: number) => T): { result: T; version: number } => {
    try {
      const tx = store.transact(() => fn(Date.now()));
      if (tx.changes.some((c) => c.kind !== 'journal')) setTimeout(publish, 0);
      return { result: tx.result, version: tx.version };
    } catch (error) {
      if (error instanceof DomainError) throw new ApiError(error.code, error.message, 400);
      throw error;
    }
  };

  const me = (): string => {
    if (!meId) throw new ApiError('unauthenticated', 'Connecte-toi pour continuer.', 401);
    return meId;
  };
  const ctx = () => ({ now: Date.now(), actorId: me(), newId });

  // Les amis tapent de temps en temps, parfois à deux sur le même gros mot.
  const rand = random(Date.now());
  const friendsTap = () => {
    const ids = store.activePlayers().map((p) => p.id);
    const others = ids.filter((id) => id !== meId);
    const witness = others[Math.floor(rand() * others.length)];
    const target = ids[Math.floor(rand() * ids.length)];
    if (witness && target && listeners.size > 0) {
      try {
        run((now) => cmd.report(store, { now, actorId: witness, newId }, { id: newId(), targetId: target, occurredAt: now, word: rand() < 0.5 ? (WORDS[Math.floor(rand() * WORDS.length)] ?? null) : null }));
        if (rand() < 0.4) {
          const second = others.find((id) => id !== witness);
          if (second) setTimeout(() => run((now) => cmd.report(store, { now, actorId: second, newId }, { id: newId(), targetId: target, occurredAt: now })), 2500);
        }
      } catch {
        // anti-emballement : on ignore
      }
    }
    setTimeout(friendsTap, 25_000 + rand() * 35_000);
  };
  setTimeout(friendsTap, 9_000);
  setInterval(() => {
    const due = [...store.contests.values()].some((c) => c.status === 'open' && c.deadline <= Date.now());
    if (due) run((now) => cmd.resolveDueContests(store, now));
  }, 15_000);

  const meView = (): Me => {
    const player = store.players.get(me());
    if (!player) throw new ApiError('unauthenticated', 'Connecte-toi pour continuer.', 401);
    return { player, session: { id: 'demo', method: 'pin', createdAt: Date.now() - DAY }, passkeys: [], push: { publicKey: 'demo', prefs, devices: 0 } };
  };

  const notAvailable = (what: string) => new ApiError('invalid', `${what} : pas disponible dans la démo.`, 400);

  return {
    demo: true,

    async me() {
      await delay(60);
      return meId ? meView() : null;
    },
    async loginPlayers() {
      await delay();
      return store.activePlayers().map((p) => ({ id: p.id, name: p.name, color: p.color, hasPin: true }));
    },
    async login(playerId, pin) {
      await delay(300);
      if (!/^\d{6}$/.test(pin)) throw new ApiError('invalid', 'Le code doit faire 6 chiffres.', 400);
      if (!store.players.has(playerId)) throw new ApiError('not_found', 'Joueur introuvable.', 404);
      meId = playerId;
    },
    async logout() {
      meId = null;
    },
    async invitation() {
      await delay();
      return { player: { id: 'alexis', name: 'Alexis', color: 'orange' }, expiresAt: Date.now() + 7 * DAY, hasPin: false };
    },
    async acceptInvitation(_token, pin) {
      await delay(300);
      if (!/^\d{6}$/.test(pin)) throw new ApiError('invalid', 'Le code doit faire 6 chiffres.', 400);
      meId = 'alexis';
    },
    async passkeyLogin() {
      await delay(500);
      meId = meId ?? 'arnaud';
    },
    async passkeyRegister() {
      throw notAvailable('Face ID');
    },
    async passkeyRemove() {
      return [];
    },
    async changePin() {
      await delay(300);
    },
    async sessions() {
      return [{ id: 'demo', playerId: me(), createdAt: Date.now() - DAY, lastSeenAt: Date.now(), userAgent: navigator.userAgent, method: 'pin', current: true }];
    },
    async revokeSession() {},

    async pushSubscribe() {
      throw notAvailable('Les notifications');
    },
    async pushUnsubscribe() {},
    async pushPrefs(next) {
      prefs = { ...prefs, ...next };
      return prefs;
    },
    async pushTest() {
      return 0;
    },

    connect(handlers) {
      listeners.add(handlers);
      handlers.status('connecting');
      setTimeout(() => {
        handlers.status('live');
        handlers.snapshot(buildSnapshot(store, Date.now()));
      }, 150);
      return () => listeners.delete(handlers);
    },
    spectate(_token, handlers) {
      return this.connect(handlers);
    },

    async report(input) {
      await delay(90);
      const { result, version } = run(() => cmd.report(store, ctx(), input));
      return { ...result, version };
    },
    async manual(input) {
      await delay();
      const { result, version } = run(() => cmd.addManual(store, ctx(), input));
      return { ...result, version };
    },
    async cancel(reportId) {
      await delay();
      const { result, version } = run(() => cmd.cancelReport(store, ctx(), { reportId }));
      return { ...result, version };
    },
    async split(reportId) {
      await delay();
      const { result, version } = run(() => cmd.splitReport(store, ctx(), { reportId }));
      return { ...result, version };
    },
    async merge(reportId, episodeId) {
      await delay();
      const { result, version } = run(() => cmd.mergeReport(store, ctx(), { reportId, episodeId }));
      return { ...result, version };
    },
    async setWord(reportId, word) {
      await delay();
      const { result, version } = run(() => cmd.setWord(store, ctx(), { reportId, word }));
      return { ...result, version };
    },
    async contest(episodeId, reason) {
      await delay();
      const { result, version } = run(() => cmd.openContest(store, ctx(), { episodeId, reason }));
      return { contest: result, version };
    },
    async vote(contestId, choice) {
      await delay();
      const { result, version } = run(() => cmd.vote(store, ctx(), { contestId, choice }));
      return { contest: result, version };
    },
    async withdraw(contestId) {
      await delay();
      const { result, version } = run(() => cmd.withdrawContest(store, ctx(), { contestId }));
      return { contest: result, version };
    },
    async history(params) {
      await delay();
      return history(store, { before: params.before ?? null, limit: params.limit, playerId: params.player ?? null, contested: params.contested });
    },
    async episode(id) {
      await delay(60);
      const episode = store.episodes.get(id);
      if (!episode) throw new ApiError('not_found', 'Ce point est introuvable.', 404);
      return episodeView(store, episode);
    },
    async stats(range, seasonId) {
      await delay();
      return buildStats(store, Date.now(), range, seasonId);
    },

    async adminOverview(): Promise<AdminOverview> {
      await delay();
      return {
        players: [...store.players.values()]
          .sort((a, b) => a.position - b.position)
          .map((p) => ({ ...p, hasPin: true, pendingInvitation: false, passkeys: p.id === 'arnaud' ? 1 : 0, pushDevices: 1 })),
        sessions: [],
        spectatorLinks: [],
        backups: [{ name: 'grosmots-exemple.sqlite', size: 48_000, createdAt: Date.now() - 20 * HOUR }],
      };
    },
    async invite(playerId) {
      await delay();
      return { url: `https://grosmots.arnaudgay.fr/#/invitation/exemple-${playerId}`, expiresAt: Date.now() + 7 * DAY };
    },
    async adminRevokeSession() {},
    async addPlayer(input) {
      return run(() => cmd.addPlayer(store, ctx(), input)).result;
    },
    async updatePlayer(id, patch) {
      return run(() => cmd.updatePlayer(store, ctx(), { id, ...patch })).result;
    },
    async updateSettings(patch) {
      return run(() => cmd.updateSettings(store, ctx(), patch)).result;
    },
    async launch(seasonName) {
      return run(() => cmd.launchChallenge(store, ctx(), { seasonName })).result;
    },
    async newSeason(name) {
      return run(() => cmd.startSeason(store, ctx(), { name })).result;
    },
    async renameSeason(id, name) {
      return run(() => cmd.renameSeason(store, ctx(), { id, name })).result;
    },
    async voidEpisode(id, note) {
      const { result, version } = run(() => cmd.voidEpisode(store, ctx(), { episodeId: id, note }));
      return { ...result, version };
    },
    async restoreEpisode(id) {
      const { result, version } = run(() => cmd.restoreEpisode(store, ctx(), { episodeId: id }));
      return { ...result, version };
    },
    async createSpectatorLink() {
      return { id: 'demo', url: 'https://grosmots.arnaudgay.fr/#/spectateur/exemple' };
    },
    async revokeSpectatorLink() {},
    async journal() {
      return [];
    },
    async backupNow() {
      return { name: 'grosmots-exemple.sqlite', size: 48_000, createdAt: Date.now() };
    },
    downloadUrl: () => null,
  };
}
