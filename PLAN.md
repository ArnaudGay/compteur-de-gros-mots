# Compteur de gros mots — plan

Le défi : Arnaud, Alexis, Alexandre et Gatho arrêtent de dire des gros mots. L'app sert à compter les gros mots de chacun, en direct, depuis son téléphone, avec un total fiable.

> **Statut : plan validé le 3 octobre 2026, développement lancé.**

## Décisions validées

| Sujet | Décision |
|---|---|
| Hébergement | VPS d'Arnaud. Dokploy (s'il est présent) sera probablement désinstallé car trop gourmand en RAM ; l'app tourne alors avec Docker Compose + Caddy |
| Adresse | `https://grosmots.arnaudgay.fr` (modifiable par une simple variable) |
| Appareils | **95 % sur iPhone** : tout est conçu d'abord pour iPhone (§ 7) |
| Périmètre | **Tout dans la V1**, y compris ce qui était prévu en V2 : vote de contestation, notifications, statistiques, mots, saisons, cagnotte, lien spectateur, Face ID |
| Le reste | Propositions du plan retenues : droits, fusion à 20 s avec la règle du « plus grand nombre », code à 6 chiffres via lien d'invitation, Arnaud admin |

## Sommaire

1. [En bref](#1-en-bref)
2. [Hébergement](#2-hébergement)
3. [Architecture technique](#3-architecture-technique)
4. [Données : on stocke des signalements, pas un compteur](#4-données--on-stocke-des-signalements-pas-un-compteur)
5. [Comment un point est compté](#5-comment-un-point-est-compté)
6. [Écrans et design](#6-écrans-et-design)
7. [Spécial iPhone](#7-spécial-iphone)
8. [Connexion, droits et sécurité](#8-connexion-droits-et-sécurité)
9. [Contestations, saisons, cagnotte, statistiques](#9-contestations-saisons-cagnotte-statistiques)
10. [Toutes les éventualités](#10-toutes-les-éventualités)
11. [Mise en ligne et entretien](#11-mise-en-ligne-et-entretien)
12. [Étapes de réalisation](#12-étapes-de-réalisation)
13. [Questions encore ouvertes](#13-questions-encore-ouvertes)

---

## 1. En bref

- **Hébergement sur le VPS.** Une seule application Node.js avec une base SQLite, derrière Caddy pour le HTTPS automatique, le tout dans Docker. Pas de quota d'offre gratuite, pas de mise en veille, temps réel intégré, données chez toi.
- **On enregistre chaque signalement, pas un compteur.** Les totaux sont calculés à partir de l'historique : on peut annuler, corriger, repérer les doublons et faire des stats sans jamais fausser le total.
- **Doublons gérés automatiquement.** Si deux personnes signalent le même gros mot à moins de 20 secondes d'écart, il ne compte qu'une fois : la deuxième personne devient « témoin ». Un bouton permet de corriger dans les deux sens.
- **Mise à jour instantanée.** Le +1 s'affiche tout de suite sur le téléphone qui tape, et en moins d'une demi-seconde chez les trois autres. Sans réseau, le tap est gardé et envoyé plus tard, sans risque d'être compté deux fois.
- **Pensée pour l'iPhone** : installable sur l'écran d'accueil, Face ID, notifications, retour haptique, plein écran propre autour de l'encoche.
- **Design sobre façon « tableau de score »**, sans les tics visuels des sites générés par IA.

---

## 2. Hébergement

### Pourquoi le VPS plutôt que Netlify + Supabase

| | **VPS (retenu)** | Netlify + Supabase |
|---|---|---|
| Coût | Rien de plus (VPS déjà payé) | Gratuit |
| Temps réel | Intégré à l'app : le serveur garde les connexions ouvertes | Supabase Realtime : efficace, mais un service de plus à configurer |
| Logique anti-doublons | Code TypeScript, facile à tester | Fonction SQL (PL/pgSQL) dans Supabase, plus pénible à écrire et à tester |
| Mise en veille | Jamais | Projet Supabase gratuit mis en pause après 7 jours de faible activité |
| Quotas | Ceux du VPS : l'app consomme environ 100 Mo de RAM | Netlify gratuit : 300 crédits par mois, chaque mise en production en coûte 15 (≈ 20 par mois), puis site suspendu jusqu'au mois suivant |
| Sauvegardes | Automatiques (voir § 11) | Aucune sauvegarde téléchargeable sur l'offre gratuite de Supabase |
| Maintenance | Un peu : mises à jour du système et de Docker | Quasi nulle |

### Dokploy

Dokploy fait tourner en permanence Traefik, Postgres et Redis pour lui-même : c'est ce qui consomme la RAM. Deux options :

- **Le désinstaller (recommandé si rien d'autre n'en dépend)** : l'app tourne avec Docker Compose et Caddy, quelques dizaines de Mo en tout. Avant de désinstaller, il faut vérifier qu'aucun autre site ou base de données n'est géré par Dokploy, sinon ils s'arrêteront aussi. Les commandes exactes sont dans `DEPLOY.md`.
- **Le garder** : l'app se déploie aussi via Dokploy (le `Dockerfile` suffit, Dokploy gère le domaine et le HTTPS).

### Ce qu'il faut sur le VPS

- Docker et Docker Compose.
- Un enregistrement DNS `A` : `grosmots.arnaudgay.fr` → adresse IPv4 du VPS (et `AAAA` si le VPS a une IPv6). Sans proxy (pas de « nuage orange » si le DNS est chez Cloudflare).
- Les ports 80 et 443 libres pour Caddy.
- Hygiène de base : pare-feu (ports 22, 80, 443), SSH par clé uniquement, mises à jour de sécurité automatiques.

---

## 3. Architecture technique

```
iPhone (app installée sur l'écran d'accueil)
   │   POST /api/...        → actions (tap +1, annulation, vote…)
   │   GET  /api/stream     ← flux temps réel (SSE)
   ▼
Caddy  (HTTPS automatique, Let's Encrypt)
   ▼
Serveur Node.js (Hono, TypeScript)
   ├── cœur métier partagé : fusion, contestations, saisons, stats
   ├── état en mémoire + écriture immédiate dans SQLite
   ├── diffusion temps réel, notifications Web Push
   └── SQLite (un seul fichier, mode WAL)
          └── sauvegarde quotidienne + copie hors du VPS
```

| Brique | Choix | Pourquoi |
|---|---|---|
| Interface | Svelte 5 (Vite), application monopage | Très légère sur mobile, s'ouvre instantanément depuis l'écran d'accueil |
| Serveur | Hono sur Node.js (LTS) + TypeScript | Simple, rapide, temps réel (SSE) natif |
| Cœur métier | Module TypeScript pur, partagé entre serveur, interface et démo | La règle de fusion est écrite une seule fois et testée scénario par scénario ; le téléphone l'utilise pour prédire le résultat d'un tap |
| Base de données | SQLite (better-sqlite3) | Idéal à 4 : un seul fichier à sauvegarder, écritures traitées une par une, donc aucun conflit possible |
| Temps réel | Server-Sent Events (SSE) | Plus simple que les WebSockets, reconnexion automatique |
| App mobile | PWA (manifest + service worker) | Installation sur l'écran d'accueil, ouverture instantanée, fonctionne hors ligne |
| Connexion | Code haché (Argon2) + passkeys (SimpleWebAuthn) | Code à 6 chiffres, puis Face ID |
| Notifications | Web Push (VAPID) | Fonctionne sur iPhone quand l'app est installée |
| Déploiement | Docker Compose + GitHub Actions | Tests automatiques à chaque push |
| Tests | Vitest (cœur et API) + Playwright (plusieurs joueurs simultanés) | Chaque éventualité du § 10 a son test |

Le cœur métier tourne aussi entièrement dans le navigateur pour produire une **démo cliquable** (données fictives, faux amis qui tapent de temps en temps), à ouvrir sur iPhone avant même la mise en ligne.

---

## 4. Données : on stocke des signalements, pas un compteur

On n'écrit jamais `total = total + 1`. Un simple compteur ne permet ni d'annuler le bon point, ni de repérer un doublon, ni de savoir qui a compté quoi ; et deux téléphones qui le modifient au même instant peuvent perdre un point (chacun lit 5, chacun écrit 6). À la place, chaque tap est enregistré, et le total se calcule à partir de l'historique.

| Table | Contenu |
|---|---|
| `players` | Joueurs : nom, couleur, admin, code haché, archivé |
| `episodes` | Un gros mot (ou une rafale) visant une personne : heure, points, mot, note, statut (`active`, `contested`, `void`), type (`live` ou `manual`) |
| `reports` | Les signalements, un tap = une ligne : identifiant créé par le téléphone (un tap n'est jamais enregistré deux fois), auteur, cible, heure du tap, heure de réception, mot, annulation |
| `contests`, `votes` | Contestations et votes |
| `seasons` | Saisons (nom, début, fin) |
| `journal` | Qui a fait quoi et quand : ajouts, annulations, fusions, séparations, contestations, réglages |
| `sessions`, `invitations`, `passkeys`, `push_subscriptions`, `spectator_links`, `settings` | Tables techniques |

**Total d'un joueur = somme des points de ses épisodes actifs.** Le calcul est instantané (quelques milliers de lignes au grand maximum) et toujours juste : en cas de bug, on recalcule tout depuis l'historique. Rien n'est jamais vraiment supprimé : une annulation est une information de plus.

---

## 5. Comment un point est compté

### 5.1 Le trajet d'un « +1 »

1. Gatho tape sur la case d'Alexis.
2. Son iPhone crée un identifiant unique pour ce tap, affiche le +1 immédiatement (en appliquant la même règle de fusion que le serveur), produit un petit retour haptique et affiche un bandeau avec « Annuler ».
3. Le tap part au serveur : identifiant, cible, heure.
4. Le serveur traite les taps un par un. Si l'identifiant est déjà connu, il renvoie le résultat déjà enregistré. Sinon, il applique la règle de fusion, enregistre le tap et complète le journal.
5. Le serveur pousse le nouvel état à tous les téléphones connectés, en moins d'une demi-seconde : chez tout le monde, la case d'Alexis s'allume avec « +1 · par Gatho ». Alexis reçoit une notification.
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

| Situation (Arnaud est la cible) | Taps | Points |
|---|---|---|
| Un gros mot, signalé par Alexis et par Gatho | Alexis 1, Gatho 1 | **1** |
| Trois gros mots d'affilée ; Alexis tape 3 fois, Gatho n'en a vu que 2 | Alexis 3, Gatho 2 | **3** |
| Arnaud s'autodénonce, Alexis signale aussi ce gros mot | Arnaud 1, Alexis 1 | **1** |
| Alexis signale ; Gatho signale 40 s plus tard | 2 épisodes | **2**, et on propose à Gatho « C'est le même ? » |
| Deux gros mots différents à 10 s d'écart, l'un signalé par Alexis, l'autre par Gatho | Alexis 1, Gatho 1 | **1** au départ, puis Gatho tape « C'est un autre » → **2** |

Le bandeau affiché après un tap dit toujours ce qui s'est passé, avec l'action inverse à portée de pouce :

| Cas | Bandeau |
|---|---|
| Normal | `+1 Arnaud` — **Annuler** · **Quel mot ?** |
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

| Écran | Contenu |
|---|---|
| **Compteur** (principal) | 4 grandes cases en 2 × 2, un tap = +1. **Les cases ne bougent jamais**, même quand le classement change, pour qu'on ne tape pas la mauvaise personne par réflexe. Les points du jour en bâtons de comptage. Bouton « ⋯ » par case : +2, +3, ajout « pour plus tôt » (heure + note), mot prononcé |
| **Classement** | Du plus sage au plus grossier, par période (aujourd'hui, semaine, mois, saison, total), écart avec le premier, jours depuis le dernier gros mot, montant de la cagnotte |
| **Historique** | Tous les épisodes, avec les témoins, les mots, les annulations, les corrections et les contestations en cours. Actions : annuler son signalement, contester un point reçu, voter, « C'est un autre » / « C'est le même » |
| **Stats** | Courbes par jour, séries sans gros mot (en cours et record), moments critiques (jour × heure), top des mots, « plus grosse balance » |
| **Règles** | Les règles du défi, modifiables par l'admin |
| **Réglages** | Face ID, notifications, code, appareils connectés. Pour l'admin : joueurs, invitations, saisons, cagnotte, fenêtres de fusion, lien spectateur, export, lancement officiel |
| **Connexion / invitation** | Choix du prénom + pavé numérique, ou Face ID ; guide d'installation sur l'écran d'accueil |
| **Spectateur** | Classement et derniers points en lecture seule, via un lien secret révocable |

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
```

### 6.3 Direction artistique : un tableau de score, pas un « site IA »

À éviter : dégradés violet-bleu, effets de verre, grosses ombres douces, émojis dans les titres, phrases d'accueil marketing, icônes décoratives partout, animations gratuites.

Ce qu'on fait :

- **Des chiffres énormes**, dans une police condensée à chiffres de largeur fixe : ils ne « sautent » pas quand ils changent. Le reste du texte en SF Pro, la police de l'iPhone.
- **Fond clair légèrement cassé, encre presque noire, une seule couleur d'accent** : un rouge « stylo de prof » pour les points. Chaque joueur a en plus une couleur discrète.
- **Une grille nette** : filets fins plutôt que cartes flottantes, angles peu arrondis.
- **Des animations seulement quand elles informent** : la case qui s'allume quand un point arrive, le chiffre qui s'incrémente.
- **Mode sombre automatique**, contrastes forts, grandes zones tactiles (utilisable d'une main).

---

## 7. Spécial iPhone

| Sujet | Ce qu'on fait |
|---|---|
| Installation | Depuis Safari : Partager → « Sur l'écran d'accueil ». Un guide illustré s'affiche tant que l'app n'est pas installée |
| Connexion sans ressaisie | On ouvre son lien d'invitation dans Safari, on choisit son code, puis on installe l'app : iOS copie les cookies de Safari dans l'app installée, donc on y est déjà connecté. La session est gardée dans un cookie qui ne change jamais de valeur, pour rester valable des deux côtés |
| Face ID | Après la première connexion, « Activer Face ID » crée une passkey : les connexions suivantes se font d'un regard. Le code reste toujours possible |
| Notifications | « Alexis t'a compté un gros mot », « vote demandé », « résultat du vote », « fin de saison ». iOS ne les autorise que dans l'app installée (iOS 16.4 et plus), activation par un bouton dans les réglages |
| Pastille sur l'icône | Nombre de votes en attente (mêmes conditions que les notifications) |
| Retour haptique | iOS n'a pas l'API de vibration du web : on déclenche le retour haptique des interrupteurs natifs (iOS 18 et plus) à chaque +1 |
| Encoche, Dynamic Island, barre d'accueil | Plein écran qui respecte les zones de sécurité |
| Gestes | Pas de zoom au double tap, pas de sélection de texte ni de menu contextuel sur les cases, pas de rebond parasite |
| Saisie du code | Pavé numérique intégré, façon écran de verrouillage, sans clavier iOS |
| Arrière-plan | iOS coupe les connexions des apps en arrière-plan : au retour, reconnexion et resynchronisation immédiates. iOS ne permet pas d'envoyer en arrière-plan : les taps en attente partent à la réouverture |
| Partage | Les liens d'invitation et spectateur s'envoient via la feuille de partage d'iOS (Messages, WhatsApp…) |
| Mode sombre | Suit le réglage de l'iPhone, barre d'état comprise |
| Icône | Icône dédiée pour l'écran d'accueil |

---

## 8. Connexion, droits et sécurité

- Au premier démarrage, le serveur crée les 4 joueurs et affiche dans ses journaux le lien d'invitation d'Arnaud (admin). Arnaud génère ensuite les liens des autres depuis l'app.
- En ouvrant son lien, chacun choisit son code à 6 chiffres. Codes stockés hachés (Argon2). **5 essais ratés → blocage de 15 minutes.**
- Session longue (un an, prolongée à chaque visite) dans un cookie sécurisé (`HttpOnly`, `Secure`, `SameSite`).
- Liste des appareils connectés et déconnexion à distance (téléphone perdu ou volé).
- Rien n'est visible sans être connecté (sauf via un lien spectateur), et le site n'est pas indexé par les moteurs de recherche.
- Anti-emballement : au maximum 10 taps par tranche de 10 secondes et par personne.

| Action | Qui peut la faire |
|---|---|
| Compter un gros mot | Tout le monde, pour tout le monde, y compris pour soi-même |
| Annuler un signalement | Son auteur uniquement (et l'admin) |
| « C'est un autre » / « C'est le même » | L'auteur du signalement concerné |
| Contester un point | La personne qui l'a reçu |
| Voter | Tous les joueurs sauf la personne qui conteste |
| Ajout différé, +N | Tout le monde, avec une note visible dans l'historique |
| Réglages, invitations, saisons, corrections | L'admin |

Un point reçu ne peut pas être retiré par la personne qui l'a reçu : elle peut seulement le contester.

---

## 9. Contestations, saisons, cagnotte, statistiques

**Contestation et vote**

- La personne visée peut contester un point dans les 48 h. Le point reste compté pendant le vote.
- Les trois autres joueurs votent « valable » ou « pas valable » (notification + pastille sur l'icône).
- Majorité (2 voix sur 3) : « pas valable » → le point est annulé ; « valable » → la contestation est rejetée et ne peut pas être relancée.
- Sans majorité au bout de 48 h : on regarde les votes exprimés ; en cas d'égalité ou d'absence de vote, le point reste.
- La personne qui conteste peut retirer sa contestation tant que le vote n'est pas terminé.

**Saisons**

- L'admin lance le défi officiellement (ce qui écarte les points de la phase de test), puis peut clore une saison et en ouvrir une nouvelle (par mois, par manche…). Rien n'est perdu : chaque saison a son classement, et le total reste consultable.
- En fin de saison : le plus sage, le plus grossier, le gage, le montant de la cagnotte.

**Cagnotte et gage**

- Prix du point réglable (désactivé par défaut, par exemple 0,50 €) : chaque joueur voit ce qu'il doit, et le total de la cagnotte.
- Gage libre pour le dernier de la saison (« le dernier paie le resto »).

**Statistiques**

- Points par jour sur 30 jours, par joueur.
- Jours sans gros mot : série en cours et record.
- Moments critiques : jour de la semaine × tranche horaire.
- Top des mots (le mot est facultatif, saisi en un tap après le +1).
- « Plus grosse balance » : qui signale le plus.

**Lien spectateur** : l'admin peut créer un lien secret en lecture seule (classement et derniers points en direct), et le révoquer à tout moment.

---

## 10. Toutes les éventualités

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
| Personne d'autre n'était là | Autodénonciation, sur l'honneur |
| Le téléphone d'un joueur est déchargé | Les autres comptent à sa place ; rattrapage possible ensuite |
| Vous êtes à distance (appel, vocal en jeu) | Même fonctionnement, le temps réel fait le lien |

### Litiges et triche

| Situation | Ce que fait l'app |
|---|---|
| Point jugé injuste | Contestation et vote à la majorité (§ 9) |
| Quelqu'un en « mitraille » un autre pour rire | Tout est nominatif dans l'historique, anti-emballement, contestation, l'admin peut annuler |
| Un témoin annule un point valable pour protéger un pote | L'annulation est visible (« annulé par … ») et un autre peut recompter |
| Quelqu'un essaie de retirer ses propres points | Impossible : on n'annule que ce qu'on a soi-même signalé |
| Quelqu'un utilise le compte d'un autre | Code personnel, appareils connectés visibles, déconnexion à distance |
| Tentatives pour deviner un code | Blocage après 5 essais, codes hachés |
| Le lien de l'app circule | Rien n'est visible sans compte ; pas d'inscription libre |
| Le lien spectateur circule trop | L'admin le révoque et en crée un autre |

### Comptes et appareils

| Situation | Ce que fait l'app |
|---|---|
| Code oublié | Face ID si activé ; sinon l'admin génère un nouveau lien d'invitation |
| Nouveau téléphone, ou téléphone + ordinateur | Connexion sur chaque appareil, chacun reste connecté |
| Téléphone perdu ou volé | L'admin (ou le joueur depuis un autre appareil) déconnecte cet appareil |
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
| Phase de test avant le lancement officiel | « Lancer le défi » écarte les points de test (conservés à part) |
| Fin du défi, nouvelle manche | Nouvelle saison : on repart de zéro sans rien perdre |
| Besoin des données ailleurs | Export JSON / CSV |
| Égalité au classement | Ex aequo, même rang |

---

## 11. Mise en ligne et entretien

- **Docker Compose** : l'app + Caddy (HTTPS). Redémarrage automatique en cas de plantage.
- **Sauvegardes** : copie cohérente de la base chaque nuit, 30 jours conservés sur le VPS, plus une copie hors du VPS (au choix : stockage S3 gratuit type Cloudflare R2 ou Backblaze B2, ou copie vers une autre machine). Export depuis l'app.
- **Surveillance** : route `/api/health` + sonde externe gratuite (par exemple UptimeRobot) qui t'alerte par e-mail si l'app tombe.
- **Mises à jour** : `git pull` puis `docker compose up -d --build` sur le VPS (ou automatique depuis GitHub Actions si tu le souhaites). Une mise à jour coupe l'app 2 ou 3 secondes, sans perte : les téléphones se reconnectent et renvoient leurs taps en attente.
- **Restauration** : procédure écrite dans `DEPLOY.md` et testée.

---

## 12. Étapes de réalisation

1. ~~Validation du plan~~ ✔
2. Socle du projet + cœur métier (fusion, contestations, saisons, stats) + tests de tous les scénarios
3. Serveur : base de données, API, temps réel, connexion (code + Face ID), notifications
4. Interface iPhone : tous les écrans, mode hors ligne, installation
5. Démo cliquable à ouvrir sur iPhone
6. Tests de bout en bout : plusieurs joueurs simultanés, coupures réseau simulées
7. Mise en ligne sur le VPS (après ton état des lieux du VPS et la création du DNS)
8. Quelques jours de test à quatre → ajustements → « Lancer le défi » → c'est parti

---

## 13. Questions encore ouvertes

**À régler entre vous** (ça ne bloque pas le développement ; ce sera écrit dans la page « Règles », modifiable à tout moment) :

1. « Putain, putain, putain » : 1 point ou 3 ?
2. Qu'est-ce qui compte : l'anglais (« fuck »), les « mots doux » (mince, zut), les messages écrits, les citations, les paroles de chansons ?
3. Cagnotte : combien par gros mot ? Quel gage pour le dernier ? Des saisons au mois ?

**Pour la mise en ligne** : l'état des lieux du VPS (commandes dans `DEPLOY.md`) et l'enregistrement DNS `grosmots.arnaudgay.fr`.

---

### Sources (consultées en octobre 2026)

- Supabase, mise en pause des projets gratuits : <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase, sauvegardes : <https://supabase.com/docs/guides/platform/backups>
- Netlify, fonctionnement des crédits : <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
- Apple (WWDC23), cookies copiés de Safari vers l'app installée : <https://developer.apple.com/videos/play/wwdc2023/10120/>
- WebKit, Web Push sur iPhone : <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>
- WebKit, pastille sur l'icône : <https://webkit.org/blog/14112/badging-for-home-screen-web-apps/>
- WebKit, retour haptique des interrupteurs (Safari 18) : <https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/>
- Dokploy, désinstallation : <https://docs.dokploy.com/docs/core/uninstall>
