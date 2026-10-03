// État complet du défi, gardé en mémoire (quelques milliers de lignes au plus).
// Chaque modification est enregistrée comme « changement » : le serveur les écrit dans
// SQLite, la démo les ignore. Les objets ne sont jamais modifiés sur place : on les remplace.
// `transact` rend chaque action atomique : en cas d'erreur, la mémoire revient à l'état d'avant.

import type {
  Contest,
  DomainEvent,
  Episode,
  JournalEntry,
  Player,
  PlayerId,
  Report,
  Season,
  Settings,
} from './types';

export type Change =
  | { kind: 'player'; row: Player }
  | { kind: 'episode'; row: Episode }
  | { kind: 'report'; row: Report }
  | { kind: 'contest'; row: Contest }
  | { kind: 'season'; row: Season }
  | { kind: 'settings'; row: Settings }
  | { kind: 'journal'; row: JournalEntry };

export interface StoreData {
  players: Player[];
  episodes: Episode[];
  reports: Report[];
  contests: Contest[];
  seasons: Season[];
  settings: Settings;
}

export interface Transaction<T> {
  result: T;
  changes: Change[];
  events: DomainEvent[];
  version: number;
}

export class Store {
  readonly players = new Map<PlayerId, Player>();
  readonly episodes = new Map<string, Episode>();
  readonly reports = new Map<string, Report>();
  readonly contests = new Map<string, Contest>();
  readonly seasons = new Map<string, Season>();
  settings: Settings;
  /** Incrémenté à chaque action qui modifie l'état : le client sait ainsi s'il est à jour. */
  version = 0;

  private readonly reportsByEpisode = new Map<string, Report[]>();
  private readonly episodesByTarget = new Map<PlayerId, Episode[]>();
  private readonly contestsByEpisode = new Map<string, Contest[]>();
  private changes: Change[] = [];
  private events: DomainEvent[] = [];
  private undo: (() => void)[] | null = null;

  constructor(data: StoreData) {
    this.settings = data.settings;
    for (const p of data.players) this.players.set(p.id, p);
    for (const e of data.episodes) this.indexEpisode(e);
    for (const r of data.reports) this.indexReport(r);
    for (const c of data.contests) this.indexContest(c);
    for (const s of data.seasons) this.seasons.set(s.id, s);
  }

  // --- Lecture -------------------------------------------------------------

  reportsOf(episodeId: string): readonly Report[] {
    return this.reportsByEpisode.get(episodeId) ?? [];
  }

  episodesOf(targetId: PlayerId): readonly Episode[] {
    return this.episodesByTarget.get(targetId) ?? [];
  }

  contestsOf(episodeId: string): readonly Contest[] {
    return this.contestsByEpisode.get(episodeId) ?? [];
  }

  /** Joueurs actifs (non archivés), dans l'ordre de la grille. */
  activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.archivedAt === null).sort((a, b) => a.position - b.position);
  }

  // --- Transactions ----------------------------------------------------------

  /**
   * Exécute une action. `persist` reçoit les changements avant validation : s'il échoue
   * (disque plein…), l'action est annulée en mémoire aussi.
   */
  transact<T>(fn: () => T, persist?: (changes: Change[]) => void): Transaction<T> {
    if (this.undo) throw new Error('Transaction déjà en cours');
    this.undo = [];
    try {
      const result = fn();
      const changes = this.changes;
      persist?.(changes);
      this.changes = [];
      const events = this.events;
      this.events = [];
      if (changes.some((c) => c.kind !== 'journal')) this.version += 1;
      this.undo = null;
      return { result, changes, events, version: this.version };
    } catch (error) {
      const undo = this.undo ?? [];
      for (let i = undo.length - 1; i >= 0; i--) undo[i]?.();
      this.undo = null;
      this.changes = [];
      this.events = [];
      throw error;
    }
  }

  // --- Écriture (uniquement dans une transaction) ----------------------------

  putPlayer(row: Player): void {
    const previous = this.players.get(row.id);
    this.record(() => (previous ? this.players.set(previous.id, previous) : this.players.delete(row.id)));
    this.players.set(row.id, row);
    this.changes.push({ kind: 'player', row });
  }

  putEpisode(row: Episode): void {
    const previous = this.episodes.get(row.id);
    this.record(() => (previous ? this.indexEpisode(previous) : this.unindexEpisode(row)));
    this.indexEpisode(row);
    this.changes.push({ kind: 'episode', row });
  }

  putReport(row: Report): void {
    const previous = this.reports.get(row.id);
    this.record(() => (previous ? this.indexReport(previous) : this.unindexReport(row)));
    this.indexReport(row);
    this.changes.push({ kind: 'report', row });
  }

  putContest(row: Contest): void {
    const previous = this.contests.get(row.id);
    this.record(() => (previous ? this.indexContest(previous) : this.unindexContest(row)));
    this.indexContest(row);
    this.changes.push({ kind: 'contest', row });
  }

  putSeason(row: Season): void {
    const previous = this.seasons.get(row.id);
    this.record(() => (previous ? this.seasons.set(previous.id, previous) : this.seasons.delete(row.id)));
    this.seasons.set(row.id, row);
    this.changes.push({ kind: 'season', row });
  }

  putSettings(row: Settings): void {
    const previous = this.settings;
    this.record(() => {
      this.settings = previous;
    });
    this.settings = row;
    this.changes.push({ kind: 'settings', row });
  }

  log(row: JournalEntry): void {
    this.changes.push({ kind: 'journal', row });
  }

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  private record(restore: () => void): void {
    if (!this.undo) throw new Error('Modification hors transaction');
    this.undo.push(restore);
  }

  // --- Index ---------------------------------------------------------------

  private indexEpisode(row: Episode): void {
    const previous = this.episodes.get(row.id);
    if (previous && previous.targetId !== row.targetId) this.unindexEpisode(previous);
    this.episodes.set(row.id, row);
    upsert(this.episodesByTarget, row.targetId, row);
  }

  private unindexEpisode(row: Episode): void {
    this.episodes.delete(row.id);
    remove(this.episodesByTarget, row.targetId, row.id);
  }

  private indexReport(row: Report): void {
    const previous = this.reports.get(row.id);
    if (previous && previous.episodeId !== row.episodeId) remove(this.reportsByEpisode, previous.episodeId, row.id);
    this.reports.set(row.id, row);
    upsert(this.reportsByEpisode, row.episodeId, row);
  }

  private unindexReport(row: Report): void {
    this.reports.delete(row.id);
    remove(this.reportsByEpisode, row.episodeId, row.id);
  }

  private indexContest(row: Contest): void {
    this.contests.set(row.id, row);
    upsert(this.contestsByEpisode, row.episodeId, row);
  }

  private unindexContest(row: Contest): void {
    this.contests.delete(row.id);
    remove(this.contestsByEpisode, row.episodeId, row.id);
  }
}

function upsert<K, V extends { id: string }>(index: Map<K, V[]>, key: K, row: V): void {
  const list = index.get(key);
  if (!list) {
    index.set(key, [row]);
    return;
  }
  const i = list.findIndex((item) => item.id === row.id);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

function remove<K, V extends { id: string }>(index: Map<K, V[]>, key: K, id: string): void {
  const list = index.get(key);
  if (!list) return;
  const i = list.findIndex((item) => item.id === id);
  if (i >= 0) list.splice(i, 1);
}
