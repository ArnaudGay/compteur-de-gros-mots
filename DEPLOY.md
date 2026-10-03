# Mise en ligne sur le VPS

Ce qui tourne sur le serveur : **deux conteneurs Docker**.

- `app` : l'application (Node.js + SQLite), environ 60 Mo de RAM. La base et les sauvegardes vivent dans le volume Docker `gros-mots-data`.
- `caddy` : le serveur web devant l'app. Il obtient et renouvelle tout seul le certificat HTTPS (Let's Encrypt) pour `grosmots.arnaudgay.fr`.

Compte une demi-heure la première fois.

---

## 1. État des lieux du VPS

Connecte-toi en SSH et colle ce bloc ; envoie-moi le résultat si tu veux que je vérifie avec toi.

```sh
cat /etc/os-release | head -2; uname -m; free -h; df -h /
docker --version; docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker service ls 2>/dev/null
sudo ss -tlnp | grep -E ':(80|443) '
```

Ce qu'on cherche :

- **Docker** est-il installé ? Sinon : `curl -fsSL https://get.docker.com | sudo sh`.
- **Dokploy** tourne-t-il ? (conteneurs ou services `dokploy`, `dokploy-traefik`, `dokploy-postgres`, `dokploy-redis`)
- **Les ports 80 et 443** sont-ils déjà pris ? (par Traefik de Dokploy, nginx, Apache…)
- **D'autres sites ou applis** tournent-ils sur ce VPS ? Ils ne doivent pas tomber.

## 2. Dokploy : le retirer ou le garder

### Option A — Le retirer (recommandé si rien d'autre n'en dépend)

> ⚠️ Avant tout : si d'autres applis ont été déployées avec Dokploy (`docker service ls`, `docker ps`), elles perdront leur adresse web (c'est Traefik, dans Dokploy, qui les servait). Note-les avant.

Commandes de la [documentation officielle de Dokploy](https://docs.dokploy.com/docs/core/uninstall), limitées à Dokploy lui-même :

```sh
docker service remove dokploy dokploy-traefik dokploy-postgres dokploy-redis
docker container remove -f dokploy-traefik
docker volume remove -f dokploy dokploy-postgres dokploy-redis
docker network remove -f dokploy-network
sudo rm -rf /etc/dokploy
```

Si plus aucun service Swarm ne tourne (`docker service ls` est vide), quitte le mode Swarm activé par Dokploy :

```sh
docker swarm leave --force
```

N'utilise pas les commandes de nettoyage global (`docker system prune --all --volumes`) de la doc Dokploy si d'autres conteneurs ou données vivent sur le VPS : elles effacent tout ce qui n'est pas en cours d'exécution.

Vérifie que la RAM est revenue : `free -h`.

### Option B — Le garder

Pas de Caddy dans ce cas : Dokploy s'occupe du domaine et du HTTPS.

1. Dans Dokploy, crée une **Application** (pas un service « Compose ») reliée au dépôt GitHub `ArnaudGay/compteur-de-gros-mots`, type de construction **Dockerfile**.
2. Variables d'environnement : `PUBLIC_ORIGIN=https://grosmots.arnaudgay.fr` et `TRUST_PROXY=1`.
3. **Stockage des données** : indispensable, sinon tout est effacé à chaque mise à jour. Ce n'est **pas** une base de données à créer dans Dokploy (rien à faire dans « Databases ») : la base est un simple fichier SQLite que l'app écrit elle-même dans `/data`, avec ses sauvegardes. Le volume ne se règle pas à la création de l'application, mais ensuite : ouvre l'application, onglet **Advanced**, section **Volumes**, bouton **Add Volume**, type **Volume Mount** :
   - **Volume Name** : `gros-mots-data`
   - **Mount Path** : `/data`

   Évite « Bind Mount » : avec un chemin relatif (`../files/…`), il ne marche pas avec Dokploy ; avec un chemin absolu, il faut d'abord donner le dossier à l'utilisateur de l'app (`sudo chown -R 1000:1000 /chemin/du/dossier`), sinon l'app s'arrête au démarrage.
4. Domaine : `grosmots.arnaudgay.fr`, port du conteneur `8787`, HTTPS avec Let's Encrypt.
5. Déploie, puis passe directement à l'étape 6 (l'étape 5 ne concerne que l'option A).
6. Vérifie que le volume marche : redéploie une deuxième fois. Les journaux ne doivent **pas** afficher de nouveau « Joueurs créés » ; s'ils l'affichent, les données repartent de zéro à chaque déploiement : revois l'étape 3.

## 3. DNS

Chez le gestionnaire du domaine `arnaudgay.fr`, crée un enregistrement :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `grosmots` | l'adresse IPv4 du VPS |
| `AAAA` (si le VPS a une IPv6) | `grosmots` | l'adresse IPv6 du VPS |

Si le DNS est chez Cloudflare : **nuage gris** (« DNS only »), pas de proxy.

Vérifie depuis le VPS (ça peut prendre quelques minutes) : `getent hosts grosmots.arnaudgay.fr` doit afficher l'adresse du VPS.

## 4. Pare-feu

Seuls SSH, HTTP et HTTPS doivent être ouverts :

```sh
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

(Le port 443 en UDP sert à HTTP/3, c'est facultatif.)

## 5. Installation (option A)

```sh
git clone https://github.com/ArnaudGay/compteur-de-gros-mots.git gros-mots
cd gros-mots
docker compose up -d --build
```

Si le dépôt est privé, `git clone` demande un identifiant : utilise ton nom d'utilisateur GitHub et un [jeton d'accès](https://github.com/settings/personal-access-tokens) en lecture seule sur ce dépôt (droit « Contents : Read »).

Pour une autre adresse que `grosmots.arnaudgay.fr` : copie `deploy/env.example` en `.env` et change `DOMAIN`.

Vérifie :

```sh
docker compose ps            # « healthy » pour app au bout de quelques secondes
docker compose logs caddy    # le certificat HTTPS doit être obtenu
curl https://grosmots.arnaudgay.fr/api/health
```

## 6. Premier lien : celui d'Arnaud

Au premier démarrage, l'app crée les 4 joueurs. Ensuite, tant qu'Arnaud n'a pas choisi son code, **chaque démarrage affiche un nouveau lien d'invitation** dans les journaux (seul le dernier marche) :

- **Option A** : `docker compose logs app | grep -A1 invitation` (prends le dernier lien affiché).
- **Option B (Dokploy)** : onglet **Logs** de l'application, ligne « Lien d'invitation d'Arnaud ». Tu ne la vois pas ? Redéploie : le nouveau démarrage en affiche un nouveau.

Tu peux aussi créer un lien à tout moment, pour n'importe quel joueur (`arnaud`, `alexis`, `alexandre`, `gatho`) :

```sh
# Option A
docker compose exec app node dist/server/cli.js invite arnaud
# Option B, dans le terminal de l'application sur Dokploy
node dist/server/cli.js invite arnaud
# Option B, en SSH sur le VPS (NOM : le nom technique de l'application, visible avec docker ps)
docker exec $(docker ps -q --filter name=NOM | head -n 1) node dist/server/cli.js invite arnaud
```

Sur l'iPhone :

1. Ouvre le lien **dans Safari** (si tu l'ouvres depuis WhatsApp ou Messenger, choisis « Ouvrir dans Safari »).
2. Choisis ton code à 6 chiffres (deux fois).
3. Installe l'app : bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
4. Ouvre **Gros mots** depuis l'écran d'accueil : pas besoin de te reconnecter.
5. **Plus → Mon compte** : active **Face ID** et les **notifications**.

## 7. Inviter les autres

Dans l'app : **Plus → Administration → Joueurs → Inviter**. La feuille de partage d'iOS s'ouvre : envoie le lien à chacun par message. Chaque lien est personnel, valable 7 jours, et ne sert qu'une fois. Créer un nouveau lien pour la même personne annule le précédent (pratique si un lien est parti dans la mauvaise conversation).

## 8. Tester puis lancer le défi

Tant que le défi n'est pas lancé, c'est la **phase de test** : comptez, annulez, testez la VAR à quatre. Quand tout le monde est prêt : **Administration → Lancer le défi officiellement**. Les points de test ne comptent plus, la saison 1 démarre.

Pense aussi à régler dans l'administration : le prix d'un gros mot (cagnotte), le gage, et les règles (ce qui compte, ce qui ne compte pas).

---

## Mises à jour

```sh
cd gros-mots
git pull
docker compose up -d --build
```

L'app est coupée 2 ou 3 secondes. Les téléphones se reconnectent seuls, et les taps faits pendant la coupure sont renvoyés automatiquement. La nouvelle version s'installe sur l'iPhone au prochain retour dans l'app.

## Sauvegardes

- **Automatiques** : chaque nuit vers 4 h, une copie de la base dans le volume (`/data/backups`), 30 jours gardés. Une sauvegarde faite à la main s'ajoute à celle de la nuit sans la remplacer.
- **À la demande** : `docker compose exec app node dist/server/cli.js backup`, ou depuis l'app (**Administration → Sauvegarder maintenant**, puis téléchargement).
- **Hors du VPS** (conseillé : si le VPS disparaît, les sauvegardes aussi) : copie régulière vers un autre endroit. Par exemple, depuis ton ordinateur :

```sh
ssh ton-vps "cd gros-mots && docker compose cp app:/data/backups -" | tar -x -C ~/Sauvegardes/gros-mots
```

ou, sur le VPS, une tâche quotidienne (`crontab -e`) vers un stockage configuré avec [rclone](https://rclone.org/) (Backblaze B2, Cloudflare R2, Google Drive…) :

```
30 5 * * * mkdir -p /root/gros-mots-backups && cd /root/gros-mots && docker compose cp app:/data/backups/. /root/gros-mots-backups/ && rclone copy /root/gros-mots-backups distant:gros-mots
```

- **Export lisible** : **Administration → Export CSV / JSON**.

## Restauration

```sh
cd gros-mots
docker compose exec app ls /data/backups                 # choisir une sauvegarde
docker compose stop app
docker compose cp app:/data/backups/grosmots-AAAA-MM-JJTHH-MM.sqlite ./restauration.sqlite
docker compose run --rm --no-deps -v "$PWD/restauration.sqlite:/restauration.sqlite:ro" --entrypoint sh app \
  -c 'rm -f /data/grosmots.sqlite-wal /data/grosmots.sqlite-shm && cp /restauration.sqlite /data/grosmots.sqlite'
docker compose start app
```

## Surveillance

Crée une sonde gratuite (par exemple [UptimeRobot](https://uptimerobot.com/)) sur `https://grosmots.arnaudgay.fr/api/health` : tu reçois un e-mail si l'app ne répond plus.

Journaux : `docker compose logs -f app` et `docker compose logs -f caddy`.

## Variables d'environnement

| Variable | Rôle | Par défaut |
|---|---|---|
| `DOMAIN` | Adresse du site (pour Caddy et l'app) | `grosmots.arnaudgay.fr` |
| `PUBLIC_ORIGIN` | Adresse complète vue par les téléphones | `https://$DOMAIN` |
| `TRUST_PROXY` | Lire l'adresse IP réelle derrière Caddy | `1` |
| `DATA_DIR` | Dossier de la base et des sauvegardes | `/data` |
| `BACKUP_KEEP` | Nombre de jours de sauvegardes gardés | `30` |
| `PLAYERS` | Joueurs créés au premier démarrage | les 4 joueurs du défi |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Clés des notifications (sinon générées et gardées dans la base) | — |

## Dépannage

| Problème | Piste |
|---|---|
| Pas de certificat HTTPS | Le DNS pointe-t-il vers le VPS ? Les ports 80 et 443 sont-ils libres et ouverts ? Proxy Cloudflare désactivé ? `docker compose logs caddy` |
| « Requête refusée : origine inconnue » | `PUBLIC_ORIGIN` ne correspond pas exactement à l'adresse tapée (http/https, faute de frappe dans `DOMAIN`) |
| Les notifications n'arrivent pas | L'app doit être installée sur l'écran d'accueil (iOS 16.4 ou plus), et les notifications autorisées dans **Plus → Mon compte** puis dans les réglages de l'iPhone |
| Face ID ne marche plus après un changement d'adresse | Les passkeys sont liées au domaine : réactive Face ID dans **Mon compte** |
| L'app ne se met pas à jour sur l'iPhone | Ferme-la complètement et rouvre-la : la nouvelle version s'applique au retour |
| Code oublié | Face ID si activé, sinon l'admin envoie un nouveau lien (**Administration → Nouveau code**). Le nouveau code déconnecte les autres appareils de ce joueur, et Face ID est à réactiver |
| « reconnexion… » permanent | `docker compose ps` : l'app tourne-t-elle ? Un proxy entre Caddy et l'app qui mettrait les réponses en tampon ? |
