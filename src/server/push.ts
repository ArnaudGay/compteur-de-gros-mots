// Notifications Web Push (sur iPhone : uniquement quand l'app est installée sur l'écran d'accueil).

import webpush from 'web-push';
import type { Store } from '../core/store';
import type { DomainEvent, PlayerId } from '../core/types';
import { eligibleVoters } from '../core/commands';
import { de, listing } from '../core/french';
import { computeTotals } from '../core/views';
import type { Config } from './config';
import { getKv, setKv, type DB } from './db';

export interface PushPrefs {
  /** On m'a compté un gros mot. */
  point: boolean;
  /** Un vote m'est demandé. */
  vote: boolean;
  /** Résultat d'une contestation qui me concerne. */
  result: boolean;
  /** Fin de saison. */
  season: boolean;
}

export const DEFAULT_PREFS: PushPrefs = { point: true, vote: true, result: true, season: true };

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  badge: number;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type Row = Record<string, unknown>;

/** Mot censuré pour une notification : « p****n ». */
export function censor(word: string): string {
  if (word.length <= 2) return word[0] + '*';
  return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1];
}

export class Push {
  readonly publicKey: string;

  constructor(
    private readonly db: DB,
    config: Config,
    private readonly send: typeof webpush.sendNotification = webpush.sendNotification,
  ) {
    let keys = config.vapid;
    if (!keys) {
      const stored = getKv(db, 'vapid');
      keys = stored ? (JSON.parse(stored) as { publicKey: string; privateKey: string }) : webpush.generateVAPIDKeys();
      if (!stored) setKv(db, 'vapid', JSON.stringify(keys));
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(config.publicOrigin.startsWith('https:') ? config.publicOrigin : 'mailto:admin@localhost', keys.publicKey, keys.privateKey);
  }

  subscribe(playerId: PlayerId, sub: PushSubscriptionInput, userAgent: string | null, now: number): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET player_id = excluded.player_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(sub.endpoint, playerId, sub.keys.p256dh, sub.keys.auth, now, userAgent?.slice(0, 300) ?? null);
  }

  unsubscribe(playerId: PlayerId, endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND player_id = ?').run(endpoint, playerId);
  }

  count(playerId: PlayerId): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE player_id = ?').get(playerId) as Row;
    return Number(row.n);
  }

  prefs(playerId: PlayerId): PushPrefs {
    const row = this.db.prepare('SELECT push_prefs FROM players WHERE id = ?').get(playerId) as Row | undefined;
    if (!row?.push_prefs) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(String(row.push_prefs)) as Partial<PushPrefs>) };
  }

  setPrefs(playerId: PlayerId, prefs: Partial<PushPrefs>): PushPrefs {
    const next = { ...this.prefs(playerId), ...prefs };
    this.db.prepare('UPDATE players SET push_prefs = ? WHERE id = ?').run(JSON.stringify(next), playerId);
    return next;
  }

  /** Votes en attente pour ce joueur : sert de pastille sur l'icône de l'app. */
  static pendingVotes(store: Store, playerId: PlayerId): number {
    let pending = 0;
    for (const c of store.contests.values()) {
      if (c.status === 'open' && !c.votes[playerId] && eligibleVoters(store, c).includes(playerId)) pending += 1;
    }
    return pending;
  }

  async sendTo(playerId: PlayerId, payload: PushPayload): Promise<number> {
    const subs = this.db.prepare('SELECT * FROM push_subscriptions WHERE player_id = ?').all(playerId) as Row[];
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send(
            { endpoint: String(s.endpoint), keys: { p256dh: String(s.p256dh), auth: String(s.auth) } },
            JSON.stringify(payload),
            { TTL: 6 * 3600, urgency: 'high', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
          );
          delivered += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // Abonnement expiré ou révoqué (app supprimée, notifications coupées) : on l'oublie.
          if (status === 404 || status === 410) this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
          else console.warn('[push] envoi impossible', status ?? (error as Error).message);
        }
      }),
    );
    return delivered;
  }

  /** Transforme les événements métier en notifications, selon les préférences de chacun. */
  async handle(events: DomainEvent[], store: Store, now: number): Promise<void> {
    const name = (id: PlayerId) => store.players.get(id)?.name ?? "Quelqu'un";
    const jobs: Promise<unknown>[] = [];
    const notify = (playerId: PlayerId, kind: keyof PushPrefs, payload: Omit<PushPayload, 'badge'>) => {
      const player = store.players.get(playerId);
      if (!player || player.archivedAt !== null || !this.prefs(playerId)[kind]) return;
      jobs.push(this.sendTo(playerId, { ...payload, badge: Push.pendingVotes(store, playerId) }));
    };

    for (const event of events) {
      switch (event.type) {
        case 'point': {
          if (event.reporterId === event.targetId) break;
          const total = computeTotals(store, now)[event.targetId];
          const what = event.delta > 1 ? `${event.delta} gros mots` : 'un gros mot';
          const word = event.word ? ` · « ${censor(event.word)} »` : '';
          notify(event.targetId, 'point', {
            title: `${name(event.reporterId)} t'a compté ${what}`,
            body: `Total : ${total ? (store.settings.challengeStartedAt === null ? total.all : total.season || total.all) : '?'}${word}`,
            tag: `point-${event.targetId}`,
            url: '/#/',
          });
          break;
        }
        case 'contest-opened': {
          const episode = store.episodes.get(event.episodeId);
          const reporters = [...new Set(store.reportsOf(event.episodeId).filter((r) => r.cancelledAt === null).map((r) => name(r.reporterId)))];
          for (const voter of event.voters) {
            notify(voter, 'vote', {
              title: `${name(event.openedBy)} conteste un point`,
              body: reporters.length ? `Signalé par ${listing(reporters)}. À toi de voter.` : 'À toi de voter.',
              tag: `contest-${event.contestId}`,
              url: `/#/historique/${episode?.id ?? ''}`,
            });
          }
          break;
        }
        case 'contest-resolved': {
          if (event.status === 'withdrawn') break;
          const verdict = event.status === 'accepted' ? 'Point annulé' : 'Point maintenu';
          const concerned = new Set<PlayerId>([event.openedBy]);
          for (const r of store.reportsOf(event.episodeId)) concerned.add(r.reporterId);
          for (const playerId of concerned) {
            notify(playerId, 'result', {
              title: `VAR : ${verdict.toLowerCase()}`,
              body: `Contestation ${de(name(event.openedBy))}.`,
              tag: `contest-${event.contestId}`,
              url: `/#/historique/${event.episodeId}`,
            });
          }
          break;
        }
        case 'season-ended': {
          const season = store.seasons.get(event.seasonId);
          for (const player of store.activePlayers()) {
            notify(player.id, 'season', {
              title: `Fin de ${season?.name ?? 'la saison'}`,
              body: 'Le classement final est prêt.',
              tag: `season-${event.seasonId}`,
              url: '/#/classement',
            });
          }
          break;
        }
      }
    }
    await Promise.all(jobs);
  }
}
