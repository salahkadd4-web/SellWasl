# SellWasl

> **One Platform. Every Flow.** Plateforme SaaS de prévente, cash van, stock et livraison.

- Spécification : [README_vf.md](README_vf.md) · Plan : [plan_VF.md](plan_VF.md)
- Documentation : [docs/](docs/) — cahier des charges, règles métier, architecture, base de données, API, RBAC, modules

## Structure

```text
apps/api       API NestJS + Prisma (PostgreSQL)      http://localhost:3001/api/v1
apps/web       Web Next.js : /admin et /app          http://localhost:3000
apps/mobile    Application Android Expo (terrain)
packages/      config (TS, thème) · business-rules · validation (Zod)
```

## Démarrer en local

Prérequis : Node.js 22, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
pnpm db:up                                   # PostgreSQL (Docker)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm db:migrate                              # applique les migrations
pnpm db:seed                                 # données de démonstration
pnpm dev                                     # API, Web et paquets partagés en mode watch
```

Vérifier : `curl http://localhost:3001/api/v1/health` → `{"status":"ok","database":"ok",…}`.

## Données de démonstration

`pnpm db:seed` crée deux entreprises isolées (docs/database.md §18). Mot de passe de tous les comptes : `SellWasl@2026`.

| Entreprise | Mode | Comptes (code) |
|---|---|---|
| Distri Oran | Prévente | `A-ADM` admin · `A-SUP` superviseur · `A-CPT` comptable · `V07`, `V08` pré-vendeurs · `L01` livreur · `M01` magasinier |
| Cash Van Est | Cash van | `B-ADM` admin · `B-SUP` superviseur · `B-CPT` comptable · `C01`, `C02` vendeurs cash van · `M01` magasinier |

Les comptes Web ont aussi un email : `admin@distri-oran.test`, `superviseur@cashvan-est.test`…
Pour parcourir les données : `pnpm db:studio`. Pour tout effacer et recommencer : `pnpm db:reset`.

## Mobile (Android)

L'application utilise des modules natifs (Bluetooth, carte) : elle tourne dans une **version de développement compilée**, pas dans Expo Go.

```bash
cd apps/mobile
npx eas build --profile development --platform android   # APK de développement (compte Expo requis)
cd ../..
pnpm dev:mobile                                          # serveur Metro
```

Ou, avec Android Studio installé : `pnpm android`.
L'écran **Tester l'imprimante** imprime un ticket de test sur une imprimante thermique Bluetooth appairée (58 ou 80 mm).

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | API, Web et paquets partagés en mode développement |
| `pnpm dev:mobile` | Serveur Metro de l'application mobile |
| `pnpm build` | Compile tous les paquets et applications |
| `pnpm typecheck` | Vérifie les types partout |
| `pnpm format` | Formate le code avec Prettier |
| `pnpm db:migrate` | Crée et applique une migration Prisma |
| `pnpm db:seed` | Charge les données de démonstration |
| `pnpm db:reset` | Efface la base, rejoue les migrations et le seed |
| `pnpm db:studio` | Ouvre Prisma Studio pour parcourir les données |
