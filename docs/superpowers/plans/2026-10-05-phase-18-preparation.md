# Phase 18 — Préparation et mobile magasinier : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lancer la préparation des tournées (Web), préparer et charger (Web et mobile magasinier), et donner au magasinier son application mobile.

**Architecture:** Module `apps/api/src/preparation/` (tournées, préparation, chargement de tournée) au-dessus du registre de stock de la phase 17 et de `priceCart`. Pages Web dans l'espace `/app`. Écrans mobiles `app/warehouse/*` qui appellent les routes REST avec `request()`.

**Tech Stack:** NestJS 11, Prisma 7, Zod 4, Vitest ; Next.js + Tailwind ; Expo Router (React Native).

**Spec:** `docs/superpowers/specs/2026-10-05-phase-18-preparation-design.md`

## Global Constraints

- Toute variation de stock passe par `StockLedger.apply` (phase 17).
- Quantités préparées dans l'unité de la ligne ; stockées en base dans `OrderLine.preparedQty`.
- Statuts : commandes `LOCKED → PREPARING → READY` ; tournée `PREPARING → READY → LOADED`.
- Erreurs : `rule()` 422, `invalidState()` 409, Zod 400.
- Web : checklist UI de la phase 17 (`PageTitle`, `Card`, listes `rounded-xl border`, `Alert` + `errorMessage`, `StockTabs`). Mobile : composants de `src/ui.tsx`, styles `StyleSheet` et couleurs de `@sellwasl/config` comme les écrans `seller`.
- Tests d'intégration : dates réservées à la suite (`2027-02-*`), journées clôturées en fin de suite, aucune donnée qui change « le dépôt » des autres suites.

## Review Focus

1. Deux préparations simultanées de la même tournée : une seule s'applique (verrou sur la tournée) — test tâche 5.
2. Ligne préparée au-delà du réservé alors que le dépôt n'a plus de disponible : refus clair, rien d'écrit — test tâche 5.
3. Bonus recalculé supérieur à ce qui a été préparé pour lui : plafonné — test tâche 5.
4. Commande dont toutes les lignes sont préparées à 0 : commande `READY` à 0 DA, rien chargé pour elle — test tâche 6.
5. Livreur sans camion au lancement : bloqué `NO_TRUCK` — test tâche 4.

---

### Task 1: Règles pures de la préparation
**Files:** Create `packages/business-rules/src/preparation.ts`, `preparation.test.ts` ; export depuis `index.ts`.
**Produces:** `type LaunchBlocker = 'WORKDAY_IN_PROGRESS' | 'PENDING_SYNC' | 'PENDING_LINES' | 'NO_DRIVER' | 'NO_TRUCK'` ; `launchBlockers(x)`, `defaultPrepared(reservedQty, unitBaseQty)`, `capBonus(recomputed, prepared)`.
- [ ] Tests : ordre des bloquants ; aucun bloquant → `[]` ; `defaultPrepared(45, 20) = 2` ; `capBonus(3, 1) = 1`.
- [ ] RED, implémentation, GREEN, build, commit.

### Task 2: Schémas et DTO
**Files:** Create `packages/validation/src/preparation.ts` ; export.
**Produces:** `routesQuerySchema { date }`, `launchRouteSchema { date, driverId: uuid }`, `prepareRouteSchema { lines: [{ lineId: uuid, preparedQty: int ≥ 0 }] 1..2000 }` ; `RouteCandidateDto`, `RouteSummaryDto`, `RoutePreparationDto`, `LAUNCH_BLOCKER_LABELS`.
- [ ] Écrire, build, typecheck, commit.

### Task 3: Droit de préparer sur le Web
**Files:** migration `<ts>_preparation_phase18` (INSERT `preparation.do` pour `COMPANY_ADMIN`, `SUPERVISEUR`), `permissions.ts` (`preparation.do` dans `ADMIN_AND_SUPERVISOR_SHARED`), `docs/rbac.md` (✓ʷ).
- [ ] Test `preparation.test.ts` : `A-SUP` a `preparation.do` (RED), migration, GREEN, commit.

### Task 4: Tournées : regroupement, bloquants, lancement
**Files:** Create `apps/api/src/preparation/routes.service.ts`, `preparation.controller.ts`, `preparation.module.ts` ; register in `app.module.ts`.
- [ ] Tests (DISTRI-ORAN, livraison `2027-02-07`) : commandes `LOCKED` de V07 (journée démarrée, commande, journée clôturée) → un groupe pour le livreur L01 ; journée en cours d'un vendeur du secteur → `WORKDAY_IN_PROGRESS` ; ligne en attente → `PENDING_LINES` et lancement 422 ; secteur sans livreur → groupe `NO_DRIVER` ; livreur sans camion → `NO_TRUCK` ; lancement → tournée `PREPARING`, commandes `PREPARING` + `routeId` ; pré-vendeur → 403.
- [ ] Implémenter, GREEN, commit.

### Task 5: Préparation
**Files:** Create `apps/api/src/preparation/preparation.service.ts` ; routes dans le contrôleur.
- [ ] Tests : vue de préparation (articles, commandes, `defaultPrepared`) ; préparation avec une rupture sur une ligne au palier → ligne réduite, prix du palier perdu (P-04), bonus plafonné, `RELEASE` de la réservation non utilisée, total recalculé, commandes et tournée `READY` ; P-04 faux → prix conservés ; préparé > réservé avec disponible → `RESERVATION` ; sans disponible → 422 rien écrit ; deuxième préparation → 409 ; ligne manquante → 422.
- [ ] Implémenter, GREEN, commit.

### Task 6: Chargement d'une tournée
**Files:** Create `apps/api/src/preparation/route-load.service.ts` ; route `POST /routes/:id/load`.
- [ ] Tests : tournée `READY` → `Load ROUTE` avec `routeId`, `RELEASE` + `TRANSFER`, camion approvisionné du préparé, réservations des lignes à 0, tournée `LOADED` ; tournée `PREPARING` → 409.
- [ ] Implémenter, GREEN, suite API complète, commit.

### Task 7: Web — Tournées
**Files:** Create `apps/web/src/app/app/(espace)/tournees/page.tsx` ; NAV `Tournées` (`preparation.launch`) ; `lib/labels.ts` (`ROUTE_STATUS`, `LAUNCH_BLOCKER`).
- [ ] Page : date, cartes par livreur, livreur modifiable par secteur (`PATCH /territories/:id`), bloquants, lancement ; typecheck + build ; commit.

### Task 8: Web — Préparations et chargement de tournée
**Files:** Create `.../stock/preparations/page.tsx` ; modify `stock-tabs.tsx` (onglet `preparation.do`), `.../stock/chargements/page.tsx` (section tournées prêtes).
- [ ] Préparation : liste des tournées, liste par article, détail par commande avec saisie, validation ; chargement : « Charger le camion » ; typecheck + build ; commit.

### Task 9: Mobile — socle du magasinier
**Files:** Modify `apps/mobile/app/_layout.tsx` (rôle `MAGASINIER` → `warehouse`) ; create `app/warehouse/_layout.tsx`, `index.tsx` (tableau de bord), `sync.tsx`, `profile.tsx` ; `src/warehouse/api.ts` (appels typés).
- [ ] Typecheck mobile ; commit.

### Task 10: Mobile — préparations et chargements
**Files:** Create `app/warehouse/preparations.tsx`, `preparation/[id].tsx`, `loads.tsx`.
- [ ] Typecheck ; commit.

### Task 11: Mobile — entrées, déchargements, inventaire, stock
**Files:** Create `app/warehouse/receipt.tsx`, `unloads.tsx`, `unload/[workdayId].tsx`, `inventory.tsx`, `stock.tsx` ; `src/warehouse/LinesEditor.tsx`.
- [ ] Typecheck ; commit.

### Task 12: Documentation, vérification, fusion
- [ ] `docs/api.md`, `plan_VF.md` (phase 18 cochée) ; `pnpm format:check`, build, typecheck, tests ; vérification UI ; fusion dans `main` et push.
