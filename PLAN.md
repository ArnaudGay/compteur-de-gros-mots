# Compteur de gros mots — plan à valider

Le défi : Arnaud, Alexis, Alexandre et Gatho arrêtent de dire des gros mots. L'app sert à compter les gros mots de chacun, en direct, depuis son téléphone, avec un total fiable.

> **Statut : plan en attente de validation.** Rien n'est encore codé. Les points à trancher sont regroupés à la fin (§ 12).

## Sommaire

1. [En bref](#1-en-bref)
2. [Hébergement](#2-hébergement)
3. [Architecture technique](#3-architecture-technique)
4. [Données : on stocke des signalements, pas un compteur](#4-données--on-stocke-des-signalements-pas-un-compteur)
5. [Comment un point est compté](#5-comment-un-point-est-compté)
6. [Écrans et design](#6-écrans-et-design)
7. [Connexion, droits et sécurité](#7-connexion-droits-et-sécurité)
8. [Toutes les éventualités](#8-toutes-les-éventualités)
9. [Périmètre V1 / V2](#9-périmètre-v1--v2)
10. [Mise en ligne et entretien](#10-mise-en-ligne-et-entretien)
11. [Étapes de réalisation](#11-étapes-de-réalisation)
12. [Questions à trancher](#12-questions-à-trancher)

---

## 1. En bref

- **Hébergement sur ton VPS.** Une seule application (SvelteKit, Node.js) avec une base SQLite, derrière Caddy pour le HTTPS automatique, le tout dans Docker. Pas de quota d'offre gratuite, pas de mise en veille, temps réel intégré, données chez toi.
- **On enregistre chaque signalement, pas un compteur.** Les totaux sont calculés à partir de l'historique : on peut annuler, corriger, repérer les doublons et faire des stats sans jamais fausser le total.
- **Doublons gérés automatiquement.** Si deux personnes signalent le même gros mot à moins de 20 secondes d'écart, il ne compte qu'une fois : la deuxième personne devient « témoin ». Un bouton permet de corriger dans les deux sens.
- **Mise à jour instantanée.** Le +1 s'affiche tout de suite sur le téléphone qui tape, et en moins d'une demi-seconde chez les trois autres. Sans réseau, le tap est gardé et envoyé plus tard, sans risque d'être compté deux fois.
- **Design sobre façon « tableau de score »**, pensé pour le téléphone et installable comme une vraie app, sans les tics visuels des sites générés par IA.

---

## 2. Hébergement

### Comparatif

| | **VPS (recommandé)** | Netlify + Supabase |
|---|---|---|
| Coût | Rien de plus (VPS déjà payé), + un domaine si tu n'en as pas | Gratuit |
| Temps réel | Intégré à l'app : le serveur garde les connexions ouvertes | Supabase Realtime : efficace, mais un service de plus à configurer |
| Logique anti-doublons | Code TypeScript dans une transaction, facile à tester | Fonction SQL (PL/pgSQL) dans Supabase, plus pénible à écrire et à tester |
| Mise en veille | Jamais | Projet Supabase gratuit mis en pause après 7 jours de faible activité (vacances, pause du défi…) |
| Quotas | Ceux du VPS : l'app consomme environ 100 Mo de RAM | Netlify gratuit : 300 crédits par mois, chaque mise en production en coûte 15 (≈ 20 par mois), puis site suspendu jusqu'au mois suivant |
| Sauvegardes | À mettre en place (prévu, voir § 10) | Aucune sauvegarde téléchargeable sur l'offre gratuite de Supabase |
| Connexion par code perso | Simple | Supabase Auth est prévu pour e-mail + mot de passe : un code demande un contournement (faux e-mails) |
| Maintenance | Un peu : mises à jour du système et de Docker | Quasi nulle |

**Verdict.** Pour 4 utilisateurs, avec du temps réel et une logique anti-doublons, un seul serveur qu'on maîtrise est plus simple, plus rapide et plus fiable. Netlify + Supabase reste un plan B correct si tu ne veux rien maintenir : le reste du plan s'y adapte (Postgres au lieu de SQLite, règle de fusion écrite en fonction SQL, export quotidien automatique pour compenser l'absence de sauvegardes).

À noter aussi : en septembre 2026, plusieurs utilisateurs du plan gratuit de Netlify ont signalé sur le forum officiel un bug de crédits qui bloquait leurs mises en production.

### Ce qu'il faut sur le VPS

- Docker et Docker Compose.
- Un domaine ou sous-domaine qui pointe vers le VPS, par exemple `grosmots.tondomaine.fr`. Le HTTPS est indispensable pour installer l'app sur l'écran d'accueil et pour sécuriser les cookies de connexion.
- Les ports 80 et 443 libres. Si un reverse proxy tourne déjà (nginx, Traefik, Caddy), on se branche dessus au lieu d'en ajouter un.
- Hygiène de base : pare-feu (ports 22, 80, 443), SSH par clé uniquement, mises à jour de sécurité automatiques.

---

## 3. Architecture technique

```
Téléphones (app web installable, PWA)
   │   POST /api/reports     → un tap « +1 »
   │   GET  /api/stream      ← flux temps réel (SSE)
   ▼
Caddy  (HTTPS automatique, Let's Encrypt)
   ▼
App SvelteKit  (Node.js LTS, TypeScript)
   ├── règle de comptage et de fusion des doublons
   ├── diffusion temps réel à tous les téléphones connectés
   └── SQLite (un seul fichier, mode WAL)
          └── sauvegarde quotidienne + copie hors du VPS
```

| Brique | Choix | Pourquoi |
|---|---|---|
| Framework | SvelteKit (Svelte 5) + TypeScript | Interface et API dans un seul projet ; très léger sur mobile |
| Base de données | SQLite (better-sqlite3) + Drizzle pour les migrations | Idéal à 4 : un seul fichier à sauvegarder, écritures traitées une par une, donc aucun conflit possible |
| Temps réel | Server-Sent Events (SSE) | Plus simple que les WebSockets, reconnexion automatique intégrée aux navigateurs |
| App mobile | PWA (manifest + service worker) | « Ajouter à l'écran d'accueil » sur iPhone et Android, ouverture instantanée, fonctionne hors ligne |
| Déploiement | Docker Compose + GitHub Actions | Un push sur `main` → tests → mise en ligne automatique |
| Tests | Vitest (logique) + Playwright (4 navigateurs en parallèle) | La règle anti-doublons est testée scénario par scénario |

Si tu préfères React pour pouvoir maintenir le code toi-même, dis-le : ça ne change rien au reste du plan.

---

## 4. Données : on stocke des signalements, pas un compteur

On n'écrit jamais `total = total + 1`. Un simple compteur ne permet ni d'annuler le bon point, ni de repérer un doublon, ni de savoir qui a compté quoi ; et deux téléphones qui le modifient au même instant peuvent perdre un point (chacun lit 5, chacun écrit 6). À la place, chaque tap est enregistré, et le total se calcule à partir de l'historique.

**`players` — les joueurs**

| Champ | Rôle |
|---|---|
| `id`, `slug` | `arnaud`, `alexis`, `alexandre`, `gatho` |
| `display_name`, `color` | Nom affiché, couleur discrète |
| `pin_hash` | Code personnel haché (vide tant que l'invitation n'a pas été utilisée) |
| `is_admin` | Arnaud |
| `archived_at` | Retirer un joueur sans perdre son historique |

**`episodes` — un gros mot (ou une rafale), vu par un ou plusieurs témoins**

| Champ | Rôle |
|---|---|
| `id` | Identifiant |
| `target_id` | Qui a dit le gros mot |
| `started_at` | Heure du premier signalement |
| `points` | Points de l'épisode, recalculés à chaque changement (règle du § 5.3) |
| `kind` | `live` (taps en direct) ou `manual` (ajout différé, +N) |
| `note`, `word` | Facultatifs |
| `status` | `active`, `contested` ou `void` |

**`reports` — les signalements (un tap = une ligne)**

| Champ | Rôle |
|---|---|
| `id` | Identifiant unique créé par le téléphone : un même tap n'est jamais enregistré deux fois |
| `episode_id`, `target_id`, `reporter_id` | Épisode, cible, auteur |
| `occurred_at` | Heure du tap selon le téléphone (contrôlée par rapport à l'heure du serveur) |
| `received_at` | Heure de réception par le serveur |
| `link` | `auto` (fusion automatique), `merged` (« c'est le même ») ou `split` (« c'est un autre ») |
| `cancelled_at`, `cancelled_by` | Annulation : rien n'est jamais vraiment supprimé |

**`journal` — qui a fait quoi et quand :** ajouts, annulations, fusions, séparations, contestations, connexions, changements de réglages.

S'y ajoutent les tables techniques `sessions`, `invitations` et `settings` (fenêtre de fusion, date de début du défi…).

**Total d'un joueur = somme des points de ses épisodes actifs.** Le calcul est instantané (quelques milliers de lignes au grand maximum) et toujours juste : en cas de bug, on recalcule tout depuis l'historique.

---

## 5. Comment un point est compté

### 5.1 Le trajet d'un « +1 »

1. Gatho tape sur la case d'Alexis.
2. Son téléphone crée un identifiant unique pour ce tap, affiche le +1 immédiatement (en appliquant la même règle de fusion que le serveur), vibre (Android) et affiche un bandeau avec « Annuler ».
3. Le tap part au serveur : identifiant, cible, heure.
4. Le serveur traite les taps un par un, dans une transaction. Si l'identifiant est déjà connu, il renvoie le résultat déjà enregistré. Sinon, il applique la règle de fusion, enregistre le tap et complète le journal.
5. Le serveur pousse le nouvel état à tous les téléphones connectés, en moins d'une demi-seconde : chez tout le monde, la case d'Alexis s'allume avec « +1 · par Gatho ».
6. Le téléphone de Gatho compare sa prédiction à la réponse du serveur. En cas de différence, le serveur a raison et l'affichage se corrige.

### 5.2 Trois sortes de doublons, trois parades

| Doublon | Exemple | Parade |
|---|---|---|
| Technique | Le réseau envoie deux fois la même requête | Identifiant unique par tap : la deuxième est ignorée |
| Accidentel | Double tap involontaire, mauvaise case | Case verrouillée 0,3 s après un tap, « Annuler » pendant 10 s, puis depuis l'historique |
| Humain | Alexis et Gatho signalent le même gros mot d'Arnaud | Fusion automatique en un seul épisode (ci-dessous) |

Et un garde-fou visuel : chaque case affiche en direct « il y a 4 s · par Alexis ». On voit que c'est déjà compté avant même de taper.

### 5.3 La règle de fusion

- Un **épisode** regroupe les signalements visant une même personne tant que le premier date de moins de **20 secondes** (réglable).
- **Chaque témoin compte de son côté, et on garde le plus grand nombre** : les points d'un épisode correspondent au nombre de taps du témoin qui en a fait le plus.

Exemples, Arnaud étant la cible :

| Situation | Taps | Points |
|---|---|---|
| Un gros mot, signalé par Alexis et par Gatho | Alexis 1, Gatho 1 | **1** |
| Trois gros mots d'affilée ; Alexis tape 3 fois, Gatho n'en a vu que 2 | Alexis 3, Gatho 2 | **3** |
| Arnaud s'autodénonce, Alexis signale aussi ce gros mot | Arnaud 1, Alexis 1 | **1** |
| Alexis signale ; Gatho signale 40 s plus tard | 2 épisodes | **2**, et on propose à Gatho « C'est le même ? » |
| Deux gros mots différents à 10 s d'écart, l'un signalé par Alexis, l'autre par Gatho | Alexis 1, Gatho 1 | **1** au départ, puis Gatho tape « C'est un autre » → **2** |

Le bandeau affiché après un tap dit toujours ce qui s'est passé, avec l'action inverse à portée de pouce :

| Cas | Bandeau |
|---|---|
| Normal | `+1 Arnaud` — **Annuler** |
| Fusionné | `Déjà compté par Alexis il y a 4 s. Ton signalement confirme le point.` — **C'est un autre** |
| Épisode récent, hors fenêtre (de 20 s à 2 min) | `+1 Arnaud. Alexis en a signalé un il y a 40 s.` — **C'est le même** |

Chaque correction se fait en un tap et reste tracée dans l'historique.

### 5.4 Hors ligne, arrière-plan, coupures

- **Pas de réseau** (métro, cave…) : le tap est mis en file d'attente sur le téléphone (badge « 1 en attente ») et envoyé dès le retour du réseau, avec l'heure réelle du tap. Il fusionne donc correctement avec les signalements des autres.
- **Retour dans l'app** après l'avoir quittée ou après avoir verrouillé l'écran : la connexion temps réel est rétablie et l'état complet rechargé aussitôt.
- **Indicateur discret** en haut de l'écran : en direct / reconnexion… / hors ligne.
- **Heure du téléphone fausse** : l'heure du tap n'est retenue que si elle est cohérente avec celle du serveur (jamais dans le futur, au plus 24 h dans le passé) ; sinon, l'heure du serveur fait foi.

---

## 6. Écrans et design

### 6.1 Les écrans

1. **Connexion** : je choisis mon prénom, je tape mon code à 6 chiffres. Une seule fois par appareil (session de plusieurs mois).
2. **Compteur** (écran principal) : 4 grandes cases en 2 × 2, un tap = +1. **Les cases ne bougent jamais**, même quand le classement change, pour qu'on ne tape pas la mauvaise personne par réflexe. Un bouton « ⋯ » par case : +2, +3, ajout « pour plus tôt » (heure + note).
3. **Classement** : du plus sage au plus grossier, par période (aujourd'hui, semaine, mois, total), écart avec le premier, nombre de jours depuis le dernier gros mot.
4. **Historique** : tous les épisodes, avec les témoins, les annulations et les corrections. Actions : annuler son signalement, contester un point reçu, « C'est un autre » / « C'est le même ».
5. **Règles** : les règles du défi telles que vous les aurez fixées (ce qui compte, ce qui ne compte pas).
6. **Réglages** : changer son code, se déconnecter. Pour l'admin : invitations, réinitialisation des codes, appareils connectés, fenêtre de fusion, date de début du défi, export des données.

### 6.2 Maquette de l'écran principal

```
┌─────────────────────────────────────┐
│ GROS MOTS               ● en direct │
│ Jour 12 du défi · 47 au total       │
├──────────────────┬──────────────────┤
│ ARNAUD       moi │ ALEXIS           │
│                  │                  │
│        12        │        7         │
│                  │ +1 · par Gatho   │
│ il y a 2 h       │ il y a 4 s       │
├──────────────────┼──────────────────┤
│ ALEXANDRE        │ GATHO            │
│                  │                  │
│        19        │        9         │
│                  │                  │
│ il y a 1 j       │ il y a 35 min    │
├──────────────────┴──────────────────┤
│ Derniers points                     │
│ 14:32  Alexis     par Gatho, Arnaud │
│ 12:05  Gatho      par Alexandre     │
│ 09:41  Alexandre  par Alexandre     │
├─────────────────────────────────────┤
│  Compteur   Classement   Historique │
└─────────────────────────────────────┘

Bandeau après un tap :
┌─────────────────────────────────────┐
│ +1 Alexis                   Annuler │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Déjà compté par Gatho il y a 4 s.   │
│ Ton signalement confirme le point.  │
│                      C'est un autre │
└─────────────────────────────────────┘
```

### 6.3 Direction artistique : un tableau de score, pas un « site IA »

À éviter : dégradés violet-bleu, effets de verre, grosses ombres douces, émojis dans les titres, phrases d'accueil marketing, icônes décoratives partout, animations gratuites.

Ce qu'on fait :

- **Des chiffres énormes**, dans une police condensée à chiffres de largeur fixe : ils ne « sautent » pas quand ils changent. Le reste du texte en police système : rendu natif, chargement instantané.
- **Fond clair légèrement cassé, encre presque noire, une seule couleur d'accent** : un rouge « stylo de prof » pour les points. Chaque joueur a en plus une couleur discrète.
- **Une grille nette** : filets fins plutôt que cartes flottantes, angles peu arrondis.
- **Des animations seulement quand elles informent** : la case qui s'allume quand un point arrive, le chiffre qui s'incrémente.
- **Mode sombre automatique**, contrastes forts, grandes zones tactiles (utilisable d'une main).

Avant de coder l'app complète, je réalise une **maquette cliquable** (données fictives) que vous testez sur vos téléphones pour valider le look.

---

## 7. Connexion, droits et sécurité

- Arnaud (admin) génère un **lien d'invitation personnel** pour chacun, à envoyer par message. En l'ouvrant, chacun choisit son code à 6 chiffres.
- Codes stockés hachés (Argon2). **5 essais ratés → blocage de 15 minutes.**
- Session longue dans un cookie sécurisé (`HttpOnly`, `Secure`), prolongée à chaque visite.
- Liste des appareils connectés et déconnexion à distance (téléphone perdu ou volé).
- Rien n'est visible sans être connecté, et le site n'est pas indexé par les moteurs de recherche.
- Anti-emballement : au maximum 10 taps par tranche de 10 secondes et par personne (doigt qui glisse, blague qui dégénère).

| Action | Qui peut la faire |
|---|---|
| Compter un gros mot | Tout le monde, pour tout le monde, y compris pour soi-même |
| Annuler un signalement | Son auteur uniquement (et l'admin) |
| « C'est un autre » / « C'est le même » | L'auteur du signalement concerné |
| Contester un point | La personne qui l'a reçu |
| Ajout différé, +N | Tout le monde, avec une note visible dans l'historique |
| Réglages, invitations, corrections | L'admin |

Un point reçu ne peut pas être retiré par la personne qui l'a reçu : elle peut seulement le contester.

---

## 8. Toutes les éventualités

### Comptage

| Situation | Ce que fait l'app |
|---|---|
| Deux personnes signalent le même gros mot en même temps | Fusion : 1 point, 2 témoins |
| Elles signalent à quelques secondes d'écart | Fusion sous 20 s ; au-delà, proposition « C'est le même ? » pendant 2 min |
| Rafale de gros mots | Chaque tap d'un même témoin compte ; entre témoins, on garde le plus grand nombre |
| Deux gros mots différents fusionnés à tort | « C'est un autre » rétablit le point |
| Double tap involontaire | Verrou de 0,3 s, puis « Annuler » |
| Mauvaise personne tapée | « Annuler », puis taper la bonne case |
| Requête envoyée deux fois par le réseau | Identifiant unique : comptée une seule fois |
| Deux taps arrivent au serveur à la même milliseconde | Traités l'un après l'autre : aucun point perdu, aucun doublon |
| Autodénonciation | Autorisée ; elle compte comme un témoignage |
| Gros mot oublié, à rattraper plus tard | Ajout « pour plus tôt », avec l'heure et une note |
| Plusieurs points d'un coup (« +5 pour la soirée d'hier ») | Ajout +N avec note, visible dans l'historique |
| Personne d'autre n'était là | Auto-dénonciation, sur l'honneur |
| Le téléphone d'un joueur est déchargé | Les autres comptent à sa place ; rattrapage possible ensuite |
| Vous êtes à distance (appel, vocal en jeu) | Même fonctionnement, le temps réel fait le lien |

### Litiges et triche

| Situation | Ce que fait l'app |
|---|---|
| Point jugé injuste | La cible le conteste ; il est marqué « contesté » et son auteur peut le retirer (vote à la majorité en V2) |
| Quelqu'un en « mitraille » un autre pour rire | Tout est nominatif dans l'historique, anti-emballement, l'admin peut annuler |
| Un témoin annule un point valable pour protéger un pote | L'annulation est visible (« annulé par … ») et un autre peut recompter |
| Quelqu'un essaie de retirer ses propres points | Impossible : on n'annule que ce qu'on a soi-même signalé |
| Quelqu'un utilise le compte d'un autre | Code personnel, appareils connectés visibles, déconnexion à distance |
| Tentatives pour deviner un code | Blocage après 5 essais, codes hachés |
| Le lien de l'app circule | Rien n'est visible sans compte, pas d'inscription libre |

### Comptes et appareils

| Situation | Ce que fait l'app |
|---|---|
| Code oublié | L'admin génère un nouveau lien d'invitation |
| Nouveau téléphone, ou téléphone + ordinateur | Connexion sur chaque appareil, chacun reste connecté |
| Téléphone perdu ou volé | L'admin déconnecte cet appareil |
| On se prête un téléphone | Se déconnecter puis se reconnecter : le code suffit |
| Une cinquième personne rejoint le défi, un joueur abandonne | L'admin ajoute ou archive un joueur, l'historique est conservé, la grille s'adapte |

### Réseau et temps réel

| Situation | Ce que fait l'app |
|---|---|
| Pas de réseau | File d'attente sur le téléphone, envoi automatique au retour du réseau |
| App en arrière-plan, écran verrouillé | Resynchronisation dès le retour dans l'app |
| Connexion temps réel coupée | « reconnexion… », puis reconnexion automatique |
| Serveur redémarré ou mis à jour | Les téléphones se reconnectent seuls, les taps en attente partent |
| Serveur en panne prolongée | L'app s'ouvre quand même (cache), les taps attendent, l'admin est alerté |
| Heure du téléphone fausse | L'heure du serveur fait foi si l'écart est incohérent |
| Même compte ouvert dans deux onglets | Les deux restent synchronisés |
| Changement d'heure, passage de minuit | Stockage en UTC ; affichage et stats « par jour » à l'heure de Paris |

### Données

| Situation | Ce que fait l'app |
|---|---|
| Panne ou perte du VPS | Sauvegardes quotidiennes + copie hors du VPS, procédure de restauration testée |
| Bug qui fausserait un total | Totaux recalculés depuis l'historique, jamais stockés « en dur » |
| Fausse manip de l'admin | Rien n'est supprimé (annulation logique) + journal |
| Phase de test avant le lancement officiel | Remise à zéro au lancement grâce à la date de début du défi |
| Fin du défi, nouvelle manche | Saisons (V2) : on repart de zéro sans rien perdre |
| Besoin des données ailleurs | Export CSV / JSON |
| Égalité au classement | Ex aequo, même rang |

---

## 9. Périmètre V1 / V2

### V1 — tout ce qu'il faut pour lancer le défi

- Connexion par code, invitations, sessions longues, rôle admin
- Écran compteur : +1 en un tap, menu « ⋯ » (+N, ajout différé avec note)
- Fusion automatique des doublons et bandeau de correction (Annuler / C'est un autre / C'est le même)
- Temps réel, affichage instantané, file d'attente hors ligne
- Classement par période
- Historique complet, annulation, contestation simple
- Page « Règles »
- App installable (PWA), mode sombre
- Administration : invitations, codes, appareils, réglages, export
- Sauvegardes, surveillance, déploiement automatique, tests automatisés

### V2 — après une ou deux semaines d'utilisation

- Contestation avec vote à la majorité des trois autres
- Notifications (« Alexis t'a compté un gros mot ») ; sur iPhone, uniquement si l'app est installée sur l'écran d'accueil
- Statistiques : courbes, records de jours sans gros mot, heures critiques, « plus grosse balance »
- Le mot prononcé et le top des mots
- Saisons : classement par mois ou par manche, historique conservé
- Cagnotte ou gages (par exemple 0,50 € le gros mot, le dernier paie le resto)
- Lien spectateur en lecture seule
- Connexion par Face ID / empreinte (passkeys)

---

## 10. Mise en ligne et entretien

- **Docker Compose** : l'app + Caddy (HTTPS). Redémarrage automatique en cas de plantage.
- **Sauvegardes** : copie cohérente de la base chaque nuit, 30 jours conservés sur le VPS, plus une copie hors du VPS (réplication continue avec Litestream vers un stockage gratuit type Cloudflare R2 ou Backblaze B2, ou copie quotidienne vers une autre machine). Bouton d'export dans l'app.
- **Surveillance** : route `/api/health` + sonde externe gratuite (par exemple UptimeRobot) qui t'alerte par e-mail si l'app tombe.
- **Déploiement** : push sur `main` → GitHub Actions lance les tests → construit l'image Docker → met à jour le VPS. Une mise à jour coupe l'app 2 ou 3 secondes, sans perte : les téléphones se reconnectent et renvoient leurs taps en attente.
- **Restauration** : procédure écrite et testée une fois avant le lancement.

---

## 11. Étapes de réalisation

Chaque étape arrive sous forme de pull request sur GitHub, que tu peux relire avant de l'intégrer.

0. Validation de ce plan et réponses aux questions ci-dessous
1. Maquette cliquable → test sur vos téléphones → validation du design
2. Socle : projet, base de données, Docker, intégration continue
3. Cœur : règle de fusion + tests de tous les scénarios du § 8
4. API, temps réel, connexion
5. Écrans, mode hors ligne, installation sur téléphone
6. Tests de bout en bout : 4 navigateurs simultanés, coupures réseau simulées
7. Mise en ligne sur le VPS : domaine, HTTPS, sauvegardes, surveillance
8. Quelques jours de test à quatre → ajustements → remise à zéro → lancement officiel du défi

---

## 12. Questions à trancher

### Avant de coder

1. **Hébergement** : OK pour le VPS ? Si oui : quel système (Ubuntu, Debian…), Docker est-il déjà installé, y a-t-il déjà un reverse proxy ou d'autres sites dessus ?
2. **Domaine** : as-tu un domaine dont on peut utiliser un sous-domaine (par exemple `grosmots.tondomaine.fr`) ?
3. **Droits** : tout le monde compte pour tout le monde (soi-même compris), seul l'auteur annule, la cible conteste. OK ?
4. **Doublons** : fenêtre de 20 s et règle « on garde le plus grand nombre de taps d'un même témoin ». OK ?
5. **Connexion** : code à 6 chiffres via lien d'invitation, Arnaud admin. OK ?
6. **Périmètre** : la découpe V1 / V2 te convient ? Quelque chose à remonter en V1 ?

### À régler entre vous (n'empêche pas de commencer ; ce sera affiché dans la page « Règles »)

7. « Putain, putain, putain » : 1 point ou 3 ?
8. Qu'est-ce qui compte : l'anglais (« fuck »), les « mots doux » (mince, zut), les messages écrits, les citations, les paroles de chansons ?
9. Y a-t-il un enjeu (cagnotte, gage pour le dernier), une date de fin, des manches ?

---

### Sources (consultées en octobre 2026)

- Supabase, mise en pause des projets gratuits : <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase, sauvegardes : <https://supabase.com/docs/guides/platform/backups>
- Netlify, fonctionnement des crédits : <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
- Forum Netlify, bug de crédits sur le plan gratuit (septembre 2026) : <https://answers.netlify.com/t/free-plan-operational-credits-issue-production-deploys-still-paused-sep-2026/169244>
