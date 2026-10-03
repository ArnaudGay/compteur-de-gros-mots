// Base SQLite : un seul fichier, mode WAL. Les données du défi sont chargées en mémoire au
// démarrage, puis chaque changement y est écrit immédiatement (dans une transaction).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS } from '../core/defaults';
import type { Change, StoreData } from '../core/store';
import type { Contest, Episode, Player, Report, Season, Settings } from '../core/types';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    pin_hash TEXT,
    pin_set_at INTEGER,
    push_prefs TEXT
  );
  CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES players(id),
    kind TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    voided_at INTEGER,
    voided_by TEXT,
    void_reason TEXT,
    void_note TEXT
  );
  CREATE INDEX episodes_target ON episodes (target_id, started_at);
  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    target_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    count INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    word TEXT,
    link TEXT NOT NULL,
    cancelled_at INTEGER,
    cancelled_by TEXT
  );
  CREATE INDEX reports_episode ON reports (episode_id);
  CREATE TABLE contests (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    opened_by TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    reason TEXT,
    deadline INTEGER NOT NULL,
    votes TEXT NOT NULL,
    status TEXT NOT NULL,
    resolved_at INTEGER
  );
  CREATE TABLE seasons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER
  );
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT,
    method TEXT NOT NULL
  );
  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    created_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    label TEXT
  );
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE TABLE spectator_links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE TABLE server_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = Number(db.pragma('user_version', { simple: true }));
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

// --- Conversion lignes <-> objets ---------------------------------------------

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toPlayer(r: Row): Player {
  return {
    id: String(r.id),
    name: String(r.name),
    color: String(r.color),
    isAdmin: num(r.is_admin) === 1,
    position: num(r.position),
    archivedAt: optNum(r.archived_at),
    createdAt: num(r.created_at),
  };
}

function toEpisode(r: Row): Episode {
  return {
    id: String(r.id),
    targetId: String(r.target_id),
    kind: r.kind === 'manual' ? 'manual' : 'live',
    startedAt: num(r.started_at),
    note: optStr(r.note),
    createdAt: num(r.created_at),
    createdBy: String(r.created_by),
    voidedAt: optNum(r.voided_at),
    voidedBy: optStr(r.voided_by),
    voidReason: optStr(r.void_reason) as Episode['voidReason'],
    voidNote: optStr(r.void_note),
  };
}

function toReport(r: Row): Report {
  return {
    id: String(r.id),
    episodeId: String(r.episode_id),
    targetId: String(r.target_id),
    reporterId: String(r.reporter_id),
    count: num(r.count),
    occurredAt: num(r.occurred_at),
    receivedAt: num(r.received_at),
    word: optStr(r.word),
    link: String(r.link) as Report['link'],
    cancelledAt: optNum(r.cancelled_at),
    cancelledBy: optStr(r.cancelled_by),
  };
}

function toContest(r: Row): Contest {
  return {
    id: String(r.id),
    episodeId: String(r.episode_id),
    openedBy: String(r.opened_by),
    openedAt: num(r.opened_at),
    reason: optStr(r.reason),
    deadline: num(r.deadline),
    votes: JSON.parse(String(r.votes)) as Contest['votes'],
    status: String(r.status) as Contest['status'],
    resolvedAt: optNum(r.resolved_at),
  };
}

function toSeason(r: Row): Season {
  return { id: String(r.id), name: String(r.name), startsAt: num(r.starts_at), endsAt: optNum(r.ends_at) };
}

export function loadStoreData(db: DB): StoreData {
  const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get() as Row | undefined;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(settingsRow ? (JSON.parse(String(settingsRow.data)) as Partial<Settings>) : {}) };
  return {
    players: (db.prepare('SELECT * FROM players').all() as Row[]).map(toPlayer),
    episodes: (db.prepare('SELECT * FROM episodes').all() as Row[]).map(toEpisode),
    reports: (db.prepare('SELECT * FROM reports').all() as Row[]).map(toReport),
    contests: (db.prepare('SELECT * FROM contests').all() as Row[]).map(toContest),
    seasons: (db.prepare('SELECT * FROM seasons').all() as Row[]).map(toSeason),
    settings,
  };
}

/** Prépare l'écriture des changements du cœur métier. */
export function createPersister(db: DB): (changes: Change[]) => void {
  const upsertPlayer = db.prepare(`
    INSERT INTO players (id, name, color, is_admin, position, archived_at, created_at)
    VALUES (@id, @name, @color, @isAdmin, @position, @archivedAt, @createdAt)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color, is_admin = excluded.is_admin,
      position = excluded.position, archived_at = excluded.archived_at`);
  const upsertEpisode = db.prepare(`
    INSERT INTO episodes (id, target_id, kind, started_at, note, created_at, created_by, voided_at, voided_by, void_reason, void_note)
    VALUES (@id, @targetId, @kind, @startedAt, @note, @createdAt, @createdBy, @voidedAt, @voidedBy, @voidReason, @voidNote)
    ON CONFLICT (id) DO UPDATE SET target_id = excluded.target_id, started_at = excluded.started_at, note = excluded.note,
      voided_at = excluded.voided_at, voided_by = excluded.voided_by, void_reason = excluded.void_reason, void_note = excluded.void_note`);
  const upsertReport = db.prepare(`
    INSERT INTO reports (id, episode_id, target_id, reporter_id, count, occurred_at, received_at, word, link, cancelled_at, cancelled_by)
    VALUES (@id, @episodeId, @targetId, @reporterId, @count, @occurredAt, @receivedAt, @word, @link, @cancelledAt, @cancelledBy)
    ON CONFLICT (id) DO UPDATE SET episode_id = excluded.episode_id, word = excluded.word, link = excluded.link,
      cancelled_at = excluded.cancelled_at, cancelled_by = excluded.cancelled_by`);
  const upsertContest = db.prepare(`
    INSERT INTO contests (id, episode_id, opened_by, opened_at, reason, deadline, votes, status, resolved_at)
    VALUES (@id, @episodeId, @openedBy, @openedAt, @reason, @deadline, @votes, @status, @resolvedAt)
    ON CONFLICT (id) DO UPDATE SET votes = excluded.votes, status = excluded.status, resolved_at = excluded.resolved_at`);
  const upsertSeason = db.prepare(`
    INSERT INTO seasons (id, name, starts_at, ends_at) VALUES (@id, @name, @startsAt, @endsAt)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, starts_at = excluded.starts_at, ends_at = excluded.ends_at`);
  const upsertSettings = db.prepare(`
    INSERT INTO settings (id, data) VALUES (1, @data) ON CONFLICT (id) DO UPDATE SET data = excluded.data`);
  const insertJournal = db.prepare('INSERT INTO journal (at, actor_id, action, data) VALUES (@at, @actorId, @action, @data)');

  const write = db.transaction((changes: Change[]) => {
    for (const change of changes) {
      switch (change.kind) {
        case 'player':
          upsertPlayer.run({ ...change.row, isAdmin: change.row.isAdmin ? 1 : 0 });
          break;
        case 'episode':
          upsertEpisode.run(change.row);
          break;
        case 'report':
          upsertReport.run(change.row);
          break;
        case 'contest':
          upsertContest.run({ ...change.row, votes: JSON.stringify(change.row.votes) });
          break;
        case 'season':
          upsertSeason.run(change.row);
          break;
        case 'settings':
          upsertSettings.run({ data: JSON.stringify(change.row) });
          break;
        case 'journal':
          insertJournal.run({ ...change.row, data: JSON.stringify(change.row.data) });
          break;
      }
    }
  });
  return (changes) => {
    if (changes.length > 0) write(changes);
  };
}

export function getKv(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM server_kv WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

export function setKv(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO server_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
