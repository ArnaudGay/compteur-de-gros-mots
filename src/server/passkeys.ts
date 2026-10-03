// Face ID / Touch ID (passkeys WebAuthn) avec SimpleWebAuthn.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { DomainError } from '../core/errors';
import { MINUTE } from '../core/time';
import type { Player } from '../core/types';
import { randomToken } from './auth';
import type { Config } from './config';
import type { DB } from './db';

const CHALLENGE_TTL = 5 * MINUTE;

export interface PasskeyInfo {
  id: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

type Row = Record<string, unknown>;

export class Passkeys {
  private challenges = new Map<string, { challenge: string; expiresAt: number }>();

  constructor(
    private readonly db: DB,
    private readonly config: Config,
  ) {}

  private remember(key: string, challenge: string, now: number): void {
    for (const [k, v] of this.challenges) if (v.expiresAt <= now) this.challenges.delete(k);
    this.challenges.set(key, { challenge, expiresAt: now + CHALLENGE_TTL });
  }

  private take(key: string, now: number): string {
    const entry = this.challenges.get(key);
    this.challenges.delete(key);
    if (!entry || entry.expiresAt <= now) throw new DomainError('expired', 'La demande Face ID a expiré, recommence.');
    return entry.challenge;
  }

  list(playerId: string): PasskeyInfo[] {
    const rows = this.db.prepare('SELECT * FROM passkeys WHERE player_id = ? ORDER BY created_at').all(playerId) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      label: r.label === null ? null : String(r.label),
      createdAt: Number(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
    }));
  }

  remove(playerId: string, id: string): void {
    this.db.prepare('DELETE FROM passkeys WHERE id = ? AND player_id = ?').run(id, playerId);
  }

  async registrationOptions(player: Player, sessionId: string, now: number) {
    const existing = this.db.prepare('SELECT id, transports FROM passkeys WHERE player_id = ?').all(player.id) as Row[];
    const options = await generateRegistrationOptions({
      rpName: 'Gros mots',
      rpID: this.config.rpId,
      userName: player.name,
      userDisplayName: player.name,
      userID: new TextEncoder().encode(player.id),
      attestationType: 'none',
      excludeCredentials: existing.map((r) => ({
        id: String(r.id),
        transports: r.transports ? (JSON.parse(String(r.transports)) as string[]) : undefined,
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    this.remember(`reg:${sessionId}`, options.challenge, now);
    return options;
  }

  async verifyRegistration(player: Player, sessionId: string, response: RegistrationResponseJSON, label: string | null, now: number) {
    const expectedChallenge = this.take(`reg:${sessionId}`, now);
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.config.publicOrigin,
      expectedRPID: this.config.rpId,
      requireUserVerification: false,
    }).catch(() => ({ verified: false as const }));
    if (!result.verified) throw new DomainError('invalid', "Face ID n'a pas pu être activé. Réessaie.");
    const { credential } = result.registrationInfo;
    this.db
      .prepare(
        `INSERT INTO passkeys (id, player_id, public_key, counter, transports, created_at, label)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter`,
      )
      .run(
        credential.id,
        player.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports ? JSON.stringify(credential.transports) : null,
        now,
        label?.slice(0, 40) ?? null,
      );
  }

  async authenticationOptions(now: number) {
    const options = await generateAuthenticationOptions({ rpID: this.config.rpId, userVerification: 'preferred' });
    const flowId = randomToken(16);
    this.remember(`auth:${flowId}`, options.challenge, now);
    return { flowId, options };
  }

  /** Renvoie le joueur reconnu par Face ID. */
  async verifyAuthentication(flowId: string, response: AuthenticationResponseJSON, now: number): Promise<string> {
    const expectedChallenge = this.take(`auth:${flowId}`, now);
    const row = this.db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id) as Row | undefined;
    if (!row) throw new DomainError('not_found', "Cette passkey n'est plus reconnue. Connecte-toi avec ton code.");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.config.publicOrigin,
      expectedRPID: this.config.rpId,
      credential: {
        id: String(row.id),
        publicKey: new Uint8Array(row.public_key as Buffer),
        counter: Number(row.counter),
        transports: row.transports ? (JSON.parse(String(row.transports)) as string[]) : undefined,
      },
      requireUserVerification: false,
    }).catch(() => ({ verified: false, authenticationInfo: null }));
    if (!result.verified || !result.authenticationInfo) throw new DomainError('invalid', 'Face ID non reconnu. Connecte-toi avec ton code.');
    this.db
      .prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
      .run(result.authenticationInfo.newCounter, now, String(row.id));
    return String(row.player_id);
  }
}
