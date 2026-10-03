# Gros mots

Le compteur de gros mots d'Arnaud, Alexis, Alexandre et Gatho : chacun compte en un tap les gros mots des autres (ou les siens), tout le monde voit le score en direct, et les doublons ne comptent qu'une fois.

- **Plan et décisions** : [PLAN.md](PLAN.md)
- **Mise en ligne sur le VPS** : [DEPLOY.md](DEPLOY.md)

## Ce que fait l'app

- Tableau 2 × 2 aux cases fixes : un tap = +1, affiché tout de suite et en direct chez les autres (flux SSE, quelques dizaines de millisecondes).
- **Anti-doublons** : deux témoins du même gros mot à moins de 20 s → 1 point ; chaque témoin compte de son côté et on garde le plus grand nombre. Bandeau « Annuler », « C'est un autre », « C'est le même », « Quel mot ? ».
- **Hors ligne** : les taps sont gardés sur le téléphone et envoyés au retour du réseau, avec leur heure réelle, sans double comptage.
- **VAR** : la personne visée conteste, les trois autres votent, la majorité décide.
- Classement par période, saisons, cagnotte et gage, historique complet, statistiques (courbes, séries sans gros mot, moments critiques, top des mots).
- Pensé pour l'iPhone : app installable sur l'écran d'accueil, Face ID (passkeys), notifications et pastille, retour haptique, mode sombre.
- Administration : invitations, joueurs, saisons, réglages, lien spectateur, exports, sauvegardes quotidiennes.

## Technique

| Partie | Outils |
|---|---|
| Cœur métier (`src/core`) | TypeScript pur, partagé par le serveur, l'interface et la démo : règle de fusion, contestations, saisons, totaux à l'heure de Paris, statistiques |
| Serveur (`src/server`) | Node.js, Hono, SQLite (better-sqlite3), Argon2, SimpleWebAuthn, Web Push |
| Interface (`src/client`) | Svelte 5, Vite, service worker (`src/sw`) |
| Tests | Vitest (`src/**/*.test.ts`), Playwright (`e2e/`) |
| Déploiement | Docker, Caddy (`docker-compose.yml`, `deploy/`) |

## Développement

```sh
npm install
npm run dev          # serveur sur :8787 + interface sur http://localhost:5173
```

Au premier démarrage, le serveur crée les joueurs et affiche dans le terminal le lien d'invitation d'Arnaud. Pour en créer d'autres :

```sh
DATA_DIR=data PUBLIC_ORIGIN=http://localhost:5173 npx tsx src/server/cli.ts invite alexis
```

## Vérifications

```sh
npm run check        # types (interface, serveur, service worker)
npm test             # tests unitaires et d'intégration
npm run build        # compile l'interface (dist/client) et le serveur (dist/server)
npm run test:e2e     # tests de bout en bout sur le serveur compilé (après npm run build)
```

## Démo

```sh
npm run build:demo   # dist/demo/index.html : l'app complète en un seul fichier, sans serveur
```

La démo fait tourner le vrai cœur métier dans le navigateur, avec deux semaines de données fictives et de faux amis qui tapent de temps en temps.

Captures au format iPhone : `node scripts/screenshots.mjs` (démo) et `node scripts/screenshots-auth.mjs` (connexion, sur le serveur compilé). Icônes : `node scripts/make-icons.mjs`.

## Crédits

Police d'affichage : Big Shoulders Display, sous licence SIL Open Font License (`src/client/fonts/OFL-big-shoulders.txt`).
