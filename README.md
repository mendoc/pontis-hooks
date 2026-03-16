# pontis-hooks

Serveur webhook GitHub qui déploie automatiquement des applications Docker Compose à chaque push sur la branche par défaut.

## Fonctionnement

1. GitHub envoie `POST /deploy/:slug` à chaque push
2. La signature HMAC-SHA256 est vérifiée
3. Le fichier `docker-compose.yml` (ou `compose.yml`) est récupéré depuis le dépôt
4. Il est écrit dans le répertoire du projet cible
5. Les commandes `docker compose pull`, `up -d` et `image prune -f` sont exécutées

Un seul déploiement à la fois est autorisé par slug.

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | Oui | Secret HMAC configuré dans GitHub |
| `APPS_DIR` | Oui | Répertoire de base des applications |
| `GITHUB_TOKEN` | Non | Token d'accès pour les dépôts privés |
| `PATHS_CONFIG_FILE` | Non | Chemin vers un fichier JSON de mapping slug → répertoire |

### Format de `PATHS_CONFIG_FILE`

```json
{
  "mon-app": "/chemin/absolu/vers/mon-app",
  "autre-app": "/opt/apps/autre-app"
}
```

Sans ce fichier, le répertoire utilisé est `APPS_DIR/slug`.

## Démarrage

```bash
# Local
npm start

# Docker Compose
docker-compose up -d
```

## Configuration d'un webhook GitHub

Dans les paramètres du dépôt → **Webhooks** → **Add webhook** :

- **Payload URL** : `https://hooks.pontis.ongoua.pro/deploy/<slug>`
- **Content type** : `application/json`
- **Secret** : valeur de `GITHUB_WEBHOOK_SECRET`
- **Events** : `Just the push event`

## Déploiement de l'image

```bash
npm run deploy
```

Nécessite `GHCR_TOKEN` dans l'environnement ou dans `.env`. Publie sur `ghcr.io/mendoc/pontis-hooks`.
