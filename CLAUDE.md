# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

```bash
# Lancer le serveur localement
npm start

# Construire l'image Docker
docker build -t webhook .

# Lancer via Docker Compose
docker-compose up -d

# Voir les logs
docker-compose logs -f

# Construire et publier l'image sur GHCR (nécessite GHCR_TOKEN)
GHCR_TOKEN=<token> npm run deploy
```

Pas de linter, de tests automatisés, ni de build — le projet utilise uniquement des modules Node.js natifs.

## Architecture

Service webhook Node.js minimaliste (fichier unique `server.js`) qui déploie automatiquement des applications Docker Compose à chaque push GitHub. Écoute sur le port `9000`.

**Flux de données :**
1. GitHub envoie `POST /deploy/:slug` (slug : `[a-z0-9_-]+`) avec un payload signé HMAC-SHA256
2. La signature est vérifiée avec `GITHUB_WEBHOOK_SECRET`
3. Seul l'événement `package` avec `action: published` est traité (les autres sont ignorés)
4. Le fichier `docker-compose.yml` (ou `compose.yml`) est récupéré depuis GitHub via l'API raw
5. Il est écrit dans le répertoire du projet cible
6. Les commandes Docker sont exécutées : `pull` → `up -d` → `image prune -f`
7. Un verrou par `slug` empêche les déploiements simultanés

**Résolution du répertoire cible :**
- Si `PATHS_CONFIG` est défini, il charge un fichier JSON `{ "slug": "/chemin/absolu" }`
- Sinon, il utilise `APPS_DIR/slug`

## Variables d'environnement

| Variable | Rôle |
|----------|------|
| `GITHUB_WEBHOOK_SECRET` | Secret HMAC pour valider les signatures GitHub |
| `APPS_DIR` | Répertoire de base des applications déployées |
| `GITHUB_TOKEN` | Token d'accès pour les dépôts privés (optionnel) |
| `PATHS_CONFIG_FILE` | Chemin hôte vers un JSON de mapping slug → répertoire (optionnel) ; monté dans le conteneur en `/config/paths.json` et exposé à `server.js` via `PATHS_CONFIG` |
| `DOCKER_CONFIG_DIR` | Répertoire de config Docker de l'hôte pour l'auth aux registries privés (optionnel, défaut : `/root/.docker`) |
| `PONTIS_ROOT` | Répertoire racine monté dans le conteneur pour accéder aux répertoires des applications |

## Déploiement Docker

Le conteneur monte :
- Le socket Docker (`/var/run/docker.sock`) pour exécuter des commandes Docker
- `PONTIS_ROOT` en lecture/écriture pour accéder aux répertoires des applications
- Un réseau externe `pontis_network` (doit exister avant `docker-compose up`)
- Un reverse proxy Traefik exposant le service sur `hooks.pontis.ongoua.pro`

Créer le réseau si nécessaire : `docker network create pontis_network`
