# CI/CD — SellWasl

> **Phase 29 — rédigé le 2026-10-12.** Pipeline, branches, environnements, images Docker et compilation mobile. Tests : [testing.md](testing.md). Sécurité : [security.md](security.md). Le déploiement sur les serveurs vient en phase 30.

## 1. Pipeline

```text
pull request / push → qualité ┐
                      tests    ├─→ images Docker (essai) ─→ publication (develop, main) ─→ déploiement (phase 30)
                      compilation
                      parcours ┘
```

`.github/workflows/ci.yml`, lancé sur chaque pull request vers `develop` ou `main`, sur chaque push sur ces deux branches, ou à la main (onglet Actions → CI → Run workflow). Une pull request mise à jour annule sa CI en cours.

| Job | Contenu | Commande locale équivalente |
|---|---|---|
| Qualité (format, lint, types) | Prettier, ESLint (aucun avertissement admis), TypeScript | `pnpm format:check && pnpm lint && pnpm typecheck` |
| Tests | Tous les tests sauf les parcours, avec seuils de couverture, sur PostgreSQL | `pnpm test` |
| Compilation | API, Web, paquets | `pnpm build --filter=!@sellwasl/mobile` |
| Parcours de bout en bout | Playwright sur la base `sellwasl_e2e` ; en cas d'échec, rapport et traces dans l'artefact `playwright` (7 jours) | `pnpm test:e2e` |
| Images Docker | Après les quatre autres : images de l'API et du Web, démarrage d'essai, publication sur push | `bash docker/smoke-test.sh` (après compilation des images, §4) |

Une étape rouge bloque la fusion (§2). Pour reproduire en local, lancer la commande de la colonne de droite.

## 2. Branches

| Branche | Rôle | Environnement | Images publiées |
|---|---|---|---|
| `feature/<sujet>`, `fix/<sujet>` | Travail en cours, pull request vers `develop` | — | — |
| `develop` | Intégration : tout ce qui est prêt | staging | `staging`, `sha-<commit>` |
| `main` | Version livrée | production | `production`, `sha-<commit>` |

Déroulé habituel :

1. `git switch develop && git pull`, puis `git switch -c feature/mon-sujet`.
2. Commits, push de la branche, pull request vers `develop` ; fusion quand la CI est verte.
3. Livraison : pull request `develop` → `main` ; fusion quand la CI est verte.

Correctif urgent : `fix/<sujet>` depuis `main`, pull request vers `main`, puis `main` fusionnée dans `develop` pour ne pas perdre le correctif.

Protection de `main` et `develop` : pull request obligatoire, les cinq jobs verts et la branche à jour, ni poussée forcée ni suppression. Aucune relecture exigée tant que le projet a un seul développeur (à relever à 1 avec un deuxième développeur).

## 3. Environnements

| | development | staging | production |
|---|---|---|---|
| Où | Poste du développeur | Serveur de recette (phase 30) | Serveurs de production (phase 30) |
| Code | Branche courante | `develop` | `main` |
| Base | Docker local (`pnpm db:up`), données de démonstration | Dédiée, données d'essai | Dédiée, sauvegardée (`scripts/backup-db.sh`) |
| `NODE_ENV` de l'API | `development` | `staging` | `production` |
| Configuration | Fichiers `.env` (modèles `.env.example`) | Environnement GitHub `staging`, puis serveur | Environnement GitHub `production`, puis serveur |

En staging et en production, l'API refuse de démarrer sans `JWT_ACCESS_SECRET` et `DATA_ENCRYPTION_KEY` propres au serveur, et l'espace plateforme est fermé sans `PLATFORM_ALLOWED_IPS` ([security.md](security.md)).

### Variables et secrets

| Nom | Où le régler | Usage |
|---|---|---|
| `NEXT_PUBLIC_MAPTILER_KEY` | Secret de l'environnement GitHub | Clé MapTiler du fond de carte du Web, figée dans l'image ([maptiler.md](maptiler.md)) |
| `NEXT_PUBLIC_SENTRY_DSN` | Variable de l'environnement GitHub | Erreurs du navigateur, figé dans l'image |
| `EXPO_TOKEN` | Secret du dépôt | Compilation mobile (§5) |
| `GITHUB_TOKEN` | Fourni par GitHub | Publication des images |
| `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `SENTRY_DSN`, `CLOUDINARY_URL`, `EXPO_ACCESS_TOKEN`, `PLATFORM_ALLOWED_IPS` | Serveur (phase 30) — jamais dans le dépôt ni dans les images | Démarrage de l'API et du Web |

## 4. Images Docker

| Image | Fichier | Contenu |
|---|---|---|
| `ghcr.io/<propriétaire>/sellwasl-api` | `apps/api/Dockerfile` | API compilée et dépendances de production ; au démarrage, `prisma migrate deploy` puis l'API sur le port 3001 ; santé `/api/v1/health` ; fichiers dans le volume `/data/storage` |
| `ghcr.io/<propriétaire>/sellwasl-web` | `apps/web/Dockerfile` | Serveur Next.js autonome sur le port 3000 ; `/api/*` transmis à l'API |

- Les deux images tournent sans droits administrateur (utilisateur `node`) et sont construites à partir du monorepo réduit par `turbo prune` : une modification du mobile ne les recompile pas.
- **Figé à la compilation du Web** : `API_URL` (par défaut `http://api:3001`, le nom du service dans Docker) et les `NEXT_PUBLIC_*` (dont la clé MapTiler) — d'où une image par environnement.
- **Lu au démarrage** : `TRUST_PROXY`, `PLATFORM_ALLOWED_IPS`, `SENTRY_DSN` (Web et API) et toute la configuration de l'API — vérifié par le démarrage d'essai.

Compiler et essayer en local (Docker Desktop lancé) :

```bash
docker build -f apps/api/Dockerfile -t sellwasl-api:local .
docker build -f apps/web/Dockerfile -t sellwasl-web:local .
bash docker/smoke-test.sh
```

`docker/compose.yml` démarre la base, l'API et le Web à partir des images (Web sur le port `WEB_PORT`, 3000 par défaut). Le démarrage d'essai lui donne des secrets jetables, vérifie l'API à travers le Web, la page de connexion et l'espace plateforme (404, puis 200 depuis l'adresse autorisée), puis supprime tout. Le développement quotidien reste sur `docker-compose.yml` (base seule).

## 5. Mobile

Les types et les tests du mobile tournent dans chaque CI. La compilation Android se lance à la main : onglet Actions → « Mobile (EAS) » → Run workflow, profil :

- `preview` : APK de test, à installer directement (staging) ;
- `production` : Android App Bundle pour le Play Store.

Le workflow confie la compilation à EAS (`--no-wait`) ; le lien de suivi et l'APK sont sur expo.dev. Prérequis : secret `EXPO_TOKEN` (expo.dev → Account settings → Access tokens). Les adresses de l'API par profil seront réglées en phase 30.

## 6. Mise en place (une fois, par le propriétaire du dépôt)

1. Pousser `main`, puis la branche `develop` : `git push -u origin develop`.
2. Installer [GitHub CLI](https://cli.github.com), puis `gh auth login`.
3. `bash scripts/github-setup.sh` : environnements `staging` (branche `develop`) et `production` (branche `main`), protection des deux branches.
4. Facultatif : secret `NEXT_PUBLIC_MAPTILER_KEY` et variable `NEXT_PUBLIC_SENTRY_DSN` dans Settings → Environments (staging, production) ; secret `EXPO_TOKEN` dans Settings → Secrets and variables → Actions.
5. Après la première publication : Packages du profil GitHub → `sellwasl-api` et `sellwasl-web` → laisser en privé (par défaut) ; le serveur s'y connectera avec un jeton en lecture (phase 30).

Les noms des jobs exigés par la protection sont ceux du §1 : un job renommé dans `ci.yml` doit l'être aussi dans `scripts/github-setup.sh`.
