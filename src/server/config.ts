// Configuration par variables d'environnement (voir DEPLOY.md).

import { resolve } from 'node:path';
import { DEFAULT_PLAYERS, PLAYER_HUES, type PlayerHue } from '../core/defaults';

export interface Config {
  port: number;
  /** Adresse publique de l'app, ex. https://grosmots.arnaudgay.fr */
  publicOrigin: string;
  /** Domaine utilisé pour Face ID (passkeys). */
  rpId: string;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  staticDir: string;
  production: boolean;
  /** Derrière Caddy : l'adresse IP du client est lue dans X-Forwarded-For. */
  trustProxy: boolean;
  seedPlayers: { id: string; name: string; color: PlayerHue; isAdmin: boolean }[];
  vapid: { publicKey: string; privateKey: string } | null;
  backupKeep: number;
}

/** PLAYERS="arnaud:Arnaud:admin,alexis:Alexis,…" (facultatif ; sinon les 4 joueurs du défi). */
function parsePlayers(value: string | undefined): Config['seedPlayers'] {
  if (!value) return DEFAULT_PLAYERS;
  return value.split(',').map((entry, index) => {
    const [id = '', name = id, flag] = entry.split(':').map((s) => s.trim());
    return { id, name, color: PLAYER_HUES[index % PLAYER_HUES.length] ?? 'blue', isAdmin: flag === 'admin' };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const publicOrigin = (env.PUBLIC_ORIGIN ?? (production ? '' : 'http://localhost:5173')).replace(/\/+$/, '');
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN est obligatoire en production (ex. https://grosmots.arnaudgay.fr).');
  const dataDir = resolve(env.DATA_DIR ?? 'data');
  return {
    port: Number(env.PORT ?? 8787),
    publicOrigin,
    rpId: new URL(publicOrigin).hostname,
    dataDir,
    dbPath: resolve(dataDir, 'grosmots.sqlite'),
    backupDir: resolve(dataDir, 'backups'),
    staticDir: resolve(env.STATIC_DIR ?? 'dist/client'),
    production,
    trustProxy: (env.TRUST_PROXY ?? (production ? '1' : '0')) === '1',
    seedPlayers: parsePlayers(env.PLAYERS),
    vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null,
    backupKeep: Math.max(1, Math.floor(Number(env.BACKUP_KEEP) || 30)),
  };
}
