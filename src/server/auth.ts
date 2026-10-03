// Connexion : codes à 6 chiffres (hachés en Argon2), sessions longues, invitations,
// limitation des essais. La valeur du cookie de session ne change jamais : iOS copie les
// cookies de Safari dans l'app installée, les deux copies doivent rester valables.

import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DomainError } from '../core/errors';
import { DAY, MINUTE } from '../core/time';
import type { DB } from './db';

export const SESSION_COOKIE = 'gm_session';
export const SESSION_TTL = 365 * DAY;
/** On ne réécrit la date de dernière visite qu'une fois par heure. */
const TOUCH_EVERY = 60 * MINUTE;
export const INVITE_TTL = 7 * DAY;

const PLAYER_MAX_FAILURES = 5;
const PLAYER_LOCK = 15 * MINUTE;
const IP_MAX_FAILURES = 20;
const IP_WINDOW = 60 * MINUTE;

export type LoginMethod = 'pin' | 'passkey' | 'invite';

export interface SessionInfo {
  id: string;
  playerId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string | null;
  method: LoginMethod;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Refuse les codes trop faciles à deviner (les prénoms du défi sont connus de tous). */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'Le code doit faire 6 chiffres.';
  if (/^(\d)\1{5}$/.test(pin)) return 'Code trop simple : évite six fois le même chiffre.';
  const digits = [...pin].map(Number);
  const step = (delta: number) => digits.every((d, i) => i === 0 || d === ((digits[i - 1] ?? 0) + delta + 10) % 10);
  if (step(1) || step(-1)) return 'Code trop simple : évite les suites comme 123456.';
  return null;
}

type Row = Record<string, unknown>;

function toSession(r: Row): SessionInfo {
  return {
    id: String(r.id),
    playerId: String(r.player_id),
    createdAt: Number(r.created_at),
    lastSeenAt: Number(r.last_seen_at),
    expiresAt: Number(r.expires_at),
    userAgent: r.user_agent === null ? null : String(r.user_agent),
    method: String(r.method) as LoginMethod,
  };
}

export class Auth {
  private playerFailures = new Map<string, { count: number; first: number; lockedUntil: number }>();
  private ipFailures = new Map<string, { count: number; first: number }>();

  constructor(private readonly db: DB) {}

  // --- Codes -------------------------------------------------------------------

  hasPin(playerId: string): boolean {
    const row = this.db.prepare('SELECT pin_hash FROM players WHERE id = ?').get(playerId) as Row | undefined;
    return Boolean(row?.pin_hash);
  }

  async setPin(playerId: string, pin: string, now: number): Promise<void> {
    const problem = pinProblem(pin);
    if (problem) throw new DomainError('invalid', problem);
    const pinHash = await hash(pin);
    this.db.prepare('UPDATE players SET pin_hash = ?, pin_set_at = ? WHERE id = ?').run(pinHash, now, playerId);
  }

  /** Vérifie un code en appliquant les blocages ; renvoie l'erreur à afficher. */
  async checkPin(playerId: string, pin: string, ip: string, now: number): Promise<void> {
    this.assertNotLocked(playerId, ip, now);
    const row = this.db.prepare('SELECT pin_hash, archived_at FROM players WHERE id = ?').get(playerId) as Row | undefined;
    const pinHash = row && row.archived_at === null ? row.pin_hash : null;
    const ok = typeof pinHash === 'string' && /^\d{6}$/.test(pin) && (await verify(pinHash, pin).catch(() => false));
    if (!ok) {
      const remaining = this.recordFailure(playerId, ip, now);
      if (!pinHash) throw new DomainError('invalid', "Pas encore de code pour ce compte : il faut d'abord ouvrir le lien d'invitation.");
      throw new DomainError(
        remaining > 0 ? 'invalid' : 'locked',
        remaining > 0 ? `Code incorrect. Encore ${remaining} essai${remaining > 1 ? 's' : ''}.` : "Trop d'essais : réessaie dans 15 minutes.",
      );
    }
    this.playerFailures.delete(playerId);
  }

  private assertNotLocked(playerId: string, ip: string, now: number): void {
    const player = this.playerFailures.get(playerId);
    if (player && player.lockedUntil > now) {
      const minutes = Math.ceil((player.lockedUntil - now) / MINUTE);
      throw new DomainError('locked', `Trop d'essais : réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
    }
    const byIp = this.ipFailures.get(ip);
    if (byIp && now - byIp.first < IP_WINDOW && byIp.count >= IP_MAX_FAILURES) {
      throw new DomainError('locked', "Trop d'essais depuis cette connexion : réessaie dans une heure.");
    }
  }

  /** Enregistre un échec et renvoie le nombre d'essais restants avant blocage. */
  private recordFailure(playerId: string, ip: string, now: number): number {
    const player = this.playerFailures.get(playerId);
    const entry = player && now - player.first < PLAYER_LOCK ? player : { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= PLAYER_MAX_FAILURES) entry.lockedUntil = now + PLAYER_LOCK;
    this.playerFailures.set(playerId, entry);

    const byIp = this.ipFailures.get(ip);
    const ipEntry = byIp && now - byIp.first < IP_WINDOW ? byIp : { count: 0, first: now };
    ipEntry.count += 1;
    this.ipFailures.set(ip, ipEntry);
    return Math.max(0, PLAYER_MAX_FAILURES - entry.count);
  }

  // --- Sessions ------------------------------------------------------------------

  createSession(playerId: string, method: LoginMethod, userAgent: string | null, now: number): string {
    const token = randomToken();
    this.db
      .prepare(
        'INSERT INTO sessions (id, player_id, created_at, last_seen_at, expires_at, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(sha256(token), playerId, now, now, now + SESSION_TTL, userAgent?.slice(0, 300) ?? null, method);
    return token;
  }

  getSession(token: string | undefined, now: number): SessionInfo | null {
    if (!token || token.length > 100) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sha256(token)) as Row | undefined;
    if (!row) return null;
    const session = toSession(row);
    if (session.expiresAt <= now) {
      this.revokeSession(session.id);
      return null;
    }
    return session;
  }

  /** Prolonge la session ; renvoie vrai si le cookie doit être renvoyé avec la nouvelle échéance. */
  touchSession(session: SessionInfo, now: number): boolean {
    if (now - session.lastSeenAt < TOUCH_EVERY) return false;
    this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, now + SESSION_TTL, session.id);
    return true;
  }

  revokeSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  listSessions(playerId?: string): SessionInfo[] {
    const rows = playerId
      ? this.db.prepare('SELECT * FROM sessions WHERE player_id = ? ORDER BY last_seen_at DESC').all(playerId)
      : this.db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC').all();
    return (rows as Row[]).map(toSession);
  }

  // --- Invitations -----------------------------------------------------------------

  createInvitation(playerId: string, createdBy: string | null, now: number): { token: string; expiresAt: number } {
    const token = randomToken(24);
    const expiresAt = now + INVITE_TTL;
    this.db
      .prepare('INSERT INTO invitations (id, player_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), playerId, createdBy, now, expiresAt);
    return { token, expiresAt };
  }

  findInvitation(token: string, now: number): { id: string; playerId: string; expiresAt: number } {
    const row = this.db.prepare('SELECT * FROM invitations WHERE id = ?').get(sha256(token)) as Row | undefined;
    if (!row) throw new DomainError('not_found', "Ce lien d'invitation n'existe pas.");
    if (row.used_at !== null) throw new DomainError('expired', "Ce lien a déjà servi. Demande-en un nouveau à l'admin si besoin.");
    if (Number(row.expires_at) <= now) throw new DomainError('expired', "Ce lien a expiré. Demande-en un nouveau à l'admin.");
    return { id: String(row.id), playerId: String(row.player_id), expiresAt: Number(row.expires_at) };
  }

  markInvitationUsed(id: string, now: number): void {
    this.db.prepare('UPDATE invitations SET used_at = ? WHERE id = ?').run(now, id);
  }

  hasPendingInvitation(playerId: string, now: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM invitations WHERE player_id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1')
      .get(playerId, now);
    return Boolean(row);
  }

  /** Nettoyage périodique des sessions et invitations expirées. */
  cleanup(now: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM invitations WHERE expires_at <= ? AND used_at IS NULL').run(now - DAY);
    for (const [key, entry] of this.playerFailures) if (entry.lockedUntil < now && now - entry.first > PLAYER_LOCK) this.playerFailures.delete(key);
    for (const [key, entry] of this.ipFailures) if (now - entry.first > IP_WINDOW) this.ipFailures.delete(key);
  }
}
