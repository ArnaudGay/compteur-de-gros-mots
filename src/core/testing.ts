// Outils pour les tests : un défi à 4 joueurs et une horloge contrôlée.

import { DEFAULT_PLAYERS, DEFAULT_SETTINGS } from './defaults';
import { Store } from './store';
import type { Ctx } from './commands';
import type { Millis, PlayerId, Settings } from './types';

/** Lundi 5 octobre 2026, 12 h à Paris (10 h UTC). */
export const T0: Millis = Date.UTC(2026, 9, 5, 10, 0, 0);

export function makeStore(settings: Partial<Settings> = {}): Store {
  return new Store({
    players: DEFAULT_PLAYERS.map((p, position) => ({ ...p, position, archivedAt: null, createdAt: T0 - 86_400_000 })),
    episodes: [],
    reports: [],
    contests: [],
    seasons: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  });
}

let counter = 0;
export function id(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(8, '0')}`;
}

export function ctx(actorId: PlayerId, now: Millis): Ctx {
  return { actorId, now, newId: () => id('gen') };
}

/** Exécute une action dans une transaction, comme le serveur. */
export function run<T>(store: Store, fn: () => T): T {
  return store.transact(fn).result;
}
