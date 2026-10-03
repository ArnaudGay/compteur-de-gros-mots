// Point d'entrée du serveur : `node dist/server/main.js` (voir DEPLOY.md).

import { serve } from '@hono/node-server';
import { de } from '../core/french';
import { createApp } from './app';
import { Auth } from './auth';
import { Backups } from './backup';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { Game } from './game';
import { Passkeys } from './passkeys';
import { Push } from './push';
import { Hub } from './realtime';
import { APP_VERSION } from './version';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const hub = new Hub();
const push = new Push(db, config);
const game = new Game(db, hub, push);
const auth = new Auth(db);
const passkeys = new Passkeys(db, config);
const backups = new Backups(db, config.backupDir, config.backupKeep, game.store.settings.timeZone);

// Premier démarrage : création des joueurs et lien d'invitation de l'admin.
const created = game.seed(config.seedPlayers);
if (created.length > 0) console.log(`[démarrage] Joueurs créés : ${created.map((p) => p.name).join(', ')}`);
for (const player of game.store.activePlayers()) {
  if (player.isAdmin && !auth.hasPin(player.id) && !auth.hasPendingInvitation(player.id, game.now())) {
    const { token } = auth.createInvitation(player.id, null, game.now());
    console.log(`[démarrage] Lien d'invitation ${de(player.name)} (admin, valable 7 jours) :\n  ${config.publicOrigin}/#/invitation/${token}`);
  }
}

const app = createApp({ config, db, game, hub, auth, passkeys, push, backups, serveClient: true });
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[démarrage] Gros mots ${APP_VERSION} écoute sur le port ${info.port} (${config.publicOrigin})`);
});

const timers = [
  setInterval(() => game.tick(), 15_000),
  setInterval(() => auth.cleanup(game.now()), 60 * 60_000),
  setInterval(() => {
    backups.runDailyIfDue(game.now()).catch((error: unknown) => console.error('[sauvegarde]', error));
  }, 10 * 60_000),
];
backups.runDailyIfDue(game.now()).catch((error: unknown) => console.error('[sauvegarde]', error));

function shutdown(signal: string) {
  console.log(`[arrêt] ${signal} reçu, fermeture propre.`);
  for (const timer of timers) clearInterval(timer);
  hub.closeAll();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
