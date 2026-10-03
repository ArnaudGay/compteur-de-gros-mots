// Le défi côté serveur : l'état en mémoire, son écriture dans SQLite, la diffusion temps réel
// et les notifications. Node.js traite une action à la fois : deux taps simultanés sont
// toujours appliqués l'un après l'autre, sans conflit possible.

import { resolveDueContests } from '../core/commands';
import { Store } from '../core/store';
import { dayKey } from '../core/time';
import type { Player, Snapshot } from '../core/types';
import { buildSnapshot } from '../core/views';
import type { Config } from './config';
import { createPersister, loadStoreData, type DB } from './db';
import type { Push } from './push';
import type { Hub } from './realtime';

export class Game {
  readonly store: Store;
  private readonly persist: ReturnType<typeof createPersister>;
  private lastDay: string;

  constructor(
    private readonly db: DB,
    readonly hub: Hub,
    private readonly push: Push | null,
    private readonly clock: () => number = Date.now,
  ) {
    this.store = new Store(loadStoreData(db));
    // Versions croissantes même après un redémarrage.
    this.store.version = clock();
    this.persist = createPersister(db);
    this.lastDay = dayKey(clock(), this.store.settings.timeZone);
  }

  now(): number {
    return this.clock();
  }

  /** Crée les joueurs au tout premier démarrage. */
  seed(players: Config['seedPlayers']): Player[] {
    if (this.store.players.size > 0) return [];
    const now = this.now();
    const created = players.map((p, position): Player => ({ ...p, position, archivedAt: null, createdAt: now }));
    this.run((store) => {
      for (const p of created) store.putPlayer(p);
      store.putSettings(store.settings);
      store.log({ at: now, actorId: null, action: 'seed', data: { players: created.map((p) => p.id) } });
    });
    return created;
  }

  /** Exécute une action : écriture atomique, diffusion du nouvel état, notifications. */
  run<T>(fn: (store: Store, now: number) => T): { result: T; version: number } {
    const now = this.now();
    const tx = this.store.transact(() => fn(this.store, now), this.persist);
    if (tx.changes.some((c) => c.kind !== 'journal')) this.publish();
    if (tx.events.length > 0 && this.push) {
      void this.push.handle(tx.events, this.store, now).catch((error: unknown) => console.warn('[push]', error));
    }
    return { result: tx.result, version: tx.version };
  }

  snapshot(): Snapshot {
    return buildSnapshot(this.store, this.now());
  }

  publish(): void {
    if (this.hub.size > 0) this.hub.broadcast('snapshot', this.snapshot());
  }

  /** Tâche régulière : clôt les votes échus et rafraîchit les totaux à minuit. */
  tick(): void {
    const now = this.now();
    const due = [...this.store.contests.values()].some((c) => c.status === 'open' && c.deadline <= now);
    if (due) this.run((store) => resolveDueContests(store, now));
    const today = dayKey(now, this.store.settings.timeZone);
    if (today !== this.lastDay) {
      this.lastDay = today;
      this.publish();
    }
  }
}
