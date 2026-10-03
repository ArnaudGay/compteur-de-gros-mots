// Sauvegardes : une copie cohérente de la base chaque nuit (vers 4 h, heure de Paris),
// les 30 dernières sont gardées. Pour une copie hors du VPS, voir DEPLOY.md.

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dayKey, zonedParts } from '../core/time';
import type { DB } from './db';

const PREFIX = 'grosmots-';
const SUFFIX = '.sqlite';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export class Backups {
  private running = false;

  constructor(
    private readonly db: DB,
    private readonly dir: string,
    private readonly keep: number,
    private readonly timeZone: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  list(): BackupInfo[] {
    return readdirSync(this.dir)
      .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
      .map((name) => {
        const stat = statSync(join(this.dir, name));
        return { name, size: stat.size, createdAt: stat.mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  path(name: string): string | null {
    if (!/^grosmots-[0-9T-]+\.sqlite$/.test(name)) return null;
    return this.list().some((b) => b.name === name) ? join(this.dir, name) : null;
  }

  async run(now: number): Promise<BackupInfo> {
    if (this.running) throw new Error('Sauvegarde déjà en cours');
    this.running = true;
    try {
      const p = zonedParts(now, this.timeZone);
      const stamp = `${dayKey(now, this.timeZone)}T${String(p.hour).padStart(2, '0')}-${String(p.minute).padStart(2, '0')}`;
      const name = `${PREFIX}${stamp}${SUFFIX}`;
      await this.db.backup(join(this.dir, name));
      this.prune();
      const stat = statSync(join(this.dir, name));
      return { name, size: stat.size, createdAt: stat.mtimeMs };
    } finally {
      this.running = false;
    }
  }

  /** Lance la sauvegarde du jour si elle n'existe pas encore et qu'il est plus de 4 h. */
  async runDailyIfDue(now: number): Promise<BackupInfo | null> {
    if (zonedParts(now, this.timeZone).hour < 4) return null;
    const today = `${PREFIX}${dayKey(now, this.timeZone)}`;
    if (this.list().some((b) => b.name.startsWith(today))) return null;
    return this.run(now);
  }

  private prune(): void {
    const daily = new Map<string, BackupInfo>();
    for (const b of this.list()) {
      const day = b.name.slice(PREFIX.length, PREFIX.length + 10);
      if (daily.has(day)) rmSync(join(this.dir, b.name));
      else daily.set(day, b);
    }
    [...daily.values()].slice(this.keep).forEach((b) => rmSync(join(this.dir, b.name)));
  }
}
