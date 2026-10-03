// Petites commandes d'administration, à lancer sur le serveur :
//   docker compose exec app node dist/server/cli.js invite arnaud
//   docker compose exec app node dist/server/cli.js players
//   docker compose exec app node dist/server/cli.js backup

import { de } from '../core/french';
import { Auth } from './auth';
import { Backups } from './backup';
import { loadConfig } from './config';
import { loadStoreData, openDatabase } from './db';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const [command, arg] = process.argv.slice(2);
const now = Date.now();

switch (command) {
  case 'invite': {
    const players = loadStoreData(db).players;
    const player = players.find((p) => p.id === arg);
    if (!player) {
      console.error(`Joueur inconnu « ${arg ?? ''} ». Joueurs : ${players.map((p) => p.id).join(', ')}`);
      process.exit(1);
    }
    const { token, expiresAt } = new Auth(db).createInvitation(player.id, null, now);
    console.log(`Lien d'invitation ${de(player.name)} (jusqu'au ${new Date(expiresAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}) :`);
    console.log(`${config.publicOrigin}/#/invitation/${token}`);
    break;
  }
  case 'players': {
    const auth = new Auth(db);
    for (const p of loadStoreData(db).players) {
      console.log(`${p.id}\t${p.name}\t${p.isAdmin ? 'admin' : ''}\t${auth.hasPin(p.id) ? 'code choisi' : 'pas de code'}\t${p.archivedAt ? 'archivé' : ''}`);
    }
    break;
  }
  case 'backup': {
    const backups = new Backups(db, config.backupDir, config.backupKeep, 'Europe/Paris');
    const info = await backups.run(now);
    console.log(`Sauvegarde créée : ${config.backupDir}/${info.name} (${Math.round(info.size / 1024)} Ko)`);
    break;
  }
  default:
    console.log('Commandes : invite <joueur> · players · backup');
}
db.close();
