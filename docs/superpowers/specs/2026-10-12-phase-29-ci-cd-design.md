# Phase 29 — CI/CD : conception

> Rédigé le 2026-10-12, validé en conversation (« Oui, réalisez la phase 29 »). Choix : ESLint ;
> images Docker publiées sur GitHub Container Registry ; parcours Playwright à chaque pull
> request ; compilation mobile EAS sur demande. Le déploiement réel vient en phase 30.

## 1. Existant (vérifié)

- `.github/workflows/ci.yml` : un seul job sur chaque pull request et chaque push sur `main` —
  format, compilation (sans le mobile), types, tests avec PostgreSQL.
- `pnpm lint` existe (turbo) mais aucun paquet n'a de script `lint` : aucun linter.
- Aucune image Docker ; `docker-compose.yml` ne sert qu'à la base de développement.
- Parcours Playwright (`pnpm test:e2e`) en local seulement. Profils EAS `development`,
  `preview`, `production`, compilations lancées à la main.

## 2. Lint

- Paquet `@sellwasl/eslint-config` (`packages/eslint-config`) : configurations partagées
  (base TypeScript, React, Next.js, Expo), selon le guide ESLint de turbo ; chaque application et
  paquet a son `eslint.config.mjs` et un script `lint` (`eslint . --max-warnings 0`).
- Règles : `typescript-eslint` recommandées partout ; hooks React au Web et au mobile ;
  `@next/eslint-plugin-next` au Web ; `eslint-config-expo` au mobile.
- Le premier passage est corrigé dans le code ; une règle n'est désactivée que pour une raison
  écrite dans la configuration.

## 3. Pipeline (`.github/workflows/ci.yml`)

Déclencheurs : pull request vers `develop` ou `main`, push sur `develop` ou `main`, lancement à la
main. Une pull request mise à jour annule sa CI en cours.

| Job | Contenu |
|---|---|
| `qualite` | format, lint, types |
| `tests` | `pnpm test` avec PostgreSQL (seuils de couverture) |
| `build` | `pnpm build` sans le mobile |
| `e2e` | Playwright sur une base `sellwasl_e2e` ; rapport et traces conservés en cas d'échec |
| `images` | images API et Web compilées, démarrage d'essai (base + API + Web) ; publication sur push seulement |

## 4. Images Docker

- `apps/api/Dockerfile` : monorepo réduit par `turbo prune`, compilation, dépendances de
  production seules ; applique `prisma migrate deploy` puis démarre ; utilisateur sans droits ;
  santé sur `/api/v1/health` ; fichiers importés dans le volume `/data/storage`.
- `apps/web/Dockerfile` : Next.js `standalone` (activé par `NEXT_OUTPUT=standalone`, pour que
  `next start` reste inchangé en local) ; utilisateur sans droits.
- Figé à la compilation (arguments) : `API_URL` (défaut `http://api:3001`),
  `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`, `NEXT_PUBLIC_SENTRY_DSN`.
  Lu au démarrage : `TRUST_PROXY`, `PLATFORM_ALLOWED_IPS`, `SENTRY_DSN` — vérifié sur l'image.
- `docker/compose.yml` : base, API et Web à partir des images ; sert au démarrage d'essai de la
  CI et à la phase 30.
- Publication sur `ghcr.io/<propriétaire>/sellwasl-api` et `sellwasl-web` : push sur `develop` →
  étiquette `staging`, push sur `main` → `production` ; toujours aussi `sha-<commit>`. Les
  variables `NEXT_PUBLIC_*` viennent de l'environnement GitHub correspondant.

## 5. Branches et environnements

| Branche | Rôle | Environnement |
|---|---|---|
| `feature/*`, `fix/*` | travail, pull request vers `develop` | — |
| `develop` | intégration | staging |
| `main` | version livrée (pull request `develop` → `main`) | production |
| poste | — | development (`.env`) |

- Correctif urgent : `fix/*` depuis `main`, pull request vers `main`, puis `main` refusionnée dans
  `develop`.
- Protection de `main` et `develop` (pull request obligatoire, jobs verts exigés, pas de poussée
  forcée, aucune relecture exigée : développeur seul) et environnements GitHub `staging` /
  `production` : script `scripts/github-setup.sh` (`gh`) lancé par le propriétaire, marche à suivre
  dans `docs/ci-cd.md`.

## 6. Mobile

`.github/workflows/mobile.yml`, lancé à la main (« Run workflow ») : profil `preview` (APK,
staging) ou `production` (AAB) ; secret `EXPO_TOKEN` ; `eas build --non-interactive --no-wait`.
Types et tests du mobile restent dans chaque CI. Adresses de l'API par profil : phase 30.

## 7. Livrable

`docs/ci-cd.md` (pipeline, branches, environnements, variables et secrets, procédure de
livraison), README, plan_VF phase 29 cochée.
