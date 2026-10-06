# Phase 21 — Dashboard, rapports et analyse des retours : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard, suivi du jour, rapports et exports pour l'entreprise, et analyse des retours fondée sur une table de faits écrite par la livraison et le déchargement.

**Architecture:** Les données manquantes (fournisseurs, lots, état constaté, motif de refus, revente, contestation) sont ajoutées au schéma ; `delivery.confirm`, `delivery.fail` et la validation du déchargement écrivent des `ReturnFact` dans leur transaction. Deux modules Nest : `reports` (calcul à la demande) et `returns` (lecture des faits, contestation). Les taux sont des fonctions pures de `business-rules`.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Zod 4, Next.js (Web, Leaflet), Expo (mobile), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-phase-21-analytics-design.md`

## Global Constraints

- Tout texte visible en français ; montants entiers en DA (BigInt en base, `number` dans les DTO).
- Isolation par entreprise automatique (modèles avec `companyId`) ; nouvelles tables [S] avec le déclencheur `sync_row_change` et les colonnes standard (`deleted_at`, `version`, `change_seq`, `created_by_*`, `created_at`, `updated_at`).
- Erreurs au format `{ error: { code, message, details } }` (`rule()`, `notFound()`, `invalidState()`).
- Exports CSV : `;`, BOM UTF-8, formules neutralisées (même fonction `cell` que `/payments/export`), 100 000 lignes au plus.
- Tests d'intégration : base `_test` partagée ; chaque suite remet en état ce qu'elle change ; jours réservés propres à la suite.
- Module `RETURNS_ANALYSIS` : désactivé par défaut ; `returns.*` et le bloc retours du dashboard n'existent que s'il est actif.
- Sur Windows : pas de heredoc bash avec apostrophes françaises (outils Write/Edit).

## Review Focus

- Livraison partielle sans motif de refus, ou échec « refus » sans motif : refusée avec `BR-RET-01`, rien n'est écrit.
- Répartition au déchargement dont la somme ≠ compté, ou défectueux sans photo : refusée ; sans répartition, tout est « remis en stock » (appels existants inchangés).
- Taux sur un petit volume : `null` + `insufficient`, jamais une division par zéro.
- Vue croisée avec deux fois le même axe ou un axe inconnu : `400`.
- Seconde décision sur une contestation déjà tranchée : `409`.

---

### Task 1: Schéma, migration, règles pures, schémas de validation

**Files:**
- Modify: `apps/api/prisma/schema.prisma` ; Create: `apps/api/prisma/migrations/20261006120000_returns_analytics/migration.sql`
- Modify: `packages/business-rules/src/{stock.ts,modules.ts,permissions.ts,index.ts}` ; Create: `packages/business-rules/src/returns.ts`, `returns.test.ts`
- Modify: `packages/validation/src/{settings.ts,stock.ts,delivery.ts,sync.ts,index.ts}` ; Create: `packages/validation/src/reports.ts`
- Modify: `apps/api/src/companies/defaults.ts`, seed des tests

**Produces:**
- Prisma : `Supplier`, `Lot`, `UnloadLineCondition`, `ReturnFact`, enums `ReturnCondition`, `ReturnFactKind`, `ContestStatus`, `StockMovementType.WRITE_OFF`, `ReasonKind.REFUSAL`, `ModuleCode.RETURNS_ANALYSIS`, `Product.supplierId`, `StockReceipt.supplierId`, `StockReceiptLine.lotNumber/expiresAt/lotId`, `Delivery.refusalReasonId/contest*`, `OrderLine.addedQty`.
- `business-rules/returns.ts` : `rate(numerator, denominator, minVolume): { rate: number | null; volume: number; insufficient: boolean }` ; `netReturnCost(returned, resold)` ; `weightedUnitPrice(lines: { qty: number; amount: number }[]): number | null`.
- `StockMoveType` gagne `'WRITE_OFF'` (effet = `OUT`).
- Validation : `refusalReasonId` facultatif sur `deliveryConfirmPayload` et `deliveryFailPayload` ; `conditions` facultatif sur `createUnloadSchema` ; `supplierId`, `lines[].lotNumber`, `lines[].expiresAt` sur `createReceiptSchema` ; `refusalContestPayload` ; `OPERATION_TYPES` + `'refusal.contest'` ; `companySettingsSchema.returnsMinVolume` (défaut 20) ; DTO des rapports dans `reports.ts`.
- Motifs `REFUSAL` par défaut (nouvelles entreprises et migration pour les existantes) ; droits `returns.read`, `returns.contest`, `returns.decide`.

- [ ] Tests unitaires de `returns.ts` (taux, volume insuffisant, dénominateur 0, coût net, prix pondéré) → rouge, puis implémentation → vert.
- [ ] Schéma + migration SQL (contraintes `qty > 0`, déclencheurs), `prisma generate`, typecheck API.
- [ ] Commit.

### Task 2: Fournisseurs et lots

**Files:** Create `apps/api/src/catalog/suppliers.{service,controller}.ts` ; Modify `apps/api/src/stock/receipts.service.ts`, `catalog.service.ts` (fournisseur habituel) ; Test `apps/api/test/returns.test.ts` (nouvelle suite de la phase).

- [ ] Tests : CRUD fournisseurs (nom unique → 409), entrée avec `supplierId`, `lotNumber`, `expiresAt` → lot créé, puis reçu de nouveau → `receivedQty` cumulée ; `GET /lots?variantId`.
- [ ] Implémentation → vert ; commit.

### Task 3: Livraison — motif de refus, revente, faits REFUSAL et RESALE

**Files:** Create `apps/api/src/returns/return-facts.ts` (écriture des faits) ; Modify `apps/api/src/delivery/delivery.service.ts`.

**Produces:** `refusalFacts(tx, {...})`, `resaleFacts(tx, {...})`, `returnFacts(tx, {...})` dans `return-facts.ts`.

- [ ] Tests : partielle sans motif → 422 `BR-RET-01` ; partielle avec motif → un `REFUSAL` par ligne réduite (qty base, valeur au prix de la ligne, axes) ; ajout à une ligne et ligne nouvelle → `addedQty` et `RESALE` ; échec `REFUSED` sans motif → 422, avec motif → `REFUSAL` pour toutes les lignes ; échec « client absent » → aucun fait.
- [ ] Implémentation → vert ; suites `delivery` et `cashvan` toujours vertes ; commit.

### Task 4: Déchargement — état constaté, perte, faits RETURN et GAP

**Files:** Modify `apps/api/src/stock/unloads.service.ts`, `unloads.controller.ts` (`POST /unloads/photos`, multipart, `unloads.validate`).

- [ ] Tests : sans `conditions` → comportement actuel + un `RETURN` `RESTOCK` par ligne comptée ; avec répartition → somme vérifiée, photo exigée pour `DEFECTIVE`, `WRITE_OFF` pour le non-`RESTOCK`, seul `RESTOCK` transféré au dépôt ; lot d'un autre article refusé ; `GAP` pour chaque écart ; valeur au prix moyen pondéré du jour.
- [ ] Implémentation → vert ; suite `stock` verte ; commit.

### Task 5: Analyse des retours et contestation

**Files:** Create `apps/api/src/returns/{returns.module,returns.controller,returns.service,refusals.service}.ts` ; Modify `app.module.ts`.

- [ ] Tests : `/returns/axis/{axis}` pour chaque axe (taux, `insufficient`) ; `/returns/cross` (et 400) ; `/returns/facts` ; module inactif → 403 ; `refusal.contest` (règles) ; `/refusals/contested` ; décision → `UPHELD`/`REJECTED`, seconde décision → 409 ; refus `UPHELD` exclus des taux par client.
- [ ] Implémentation → vert ; commit.

### Task 6: Rapports, tableau du jour, carte, fiche

**Files:** Create `apps/api/src/reports/{reports.module,reports.controller,dashboard.service,live.service,reports.service}.ts`.

- [ ] Tests sur des données créées par la suite : `/reports/dashboard` (CA, commandes, visites, conversion, bloc retours présent seulement si module actif), `/reports/today` (une ligne par utilisateur de terrain, `online`), `/reports/map`, `/reports/users/{id}`, `/reports/commercial|presales|delivery|lost-sales`, période > 366 jours → 400.
- [ ] Implémentation → vert ; commit.

### Task 7: Exports CSV

**Files:** Create `apps/api/src/reports/exports.service.ts` ; partage de `cell()` avec la comptabilité (`apps/api/src/common/csv.ts`).

- [ ] Tests : chaque type rend un CSV avec en-tête ; types retours sans module → 403 ; injection de formule neutralisée ; `/payments/export` inchangé.
- [ ] Implémentation → vert ; commit.

### Task 8: Web

**Files:** `apps/web/src/app/app/(espace)/page.tsx` (dashboard), `suivi/page.tsx`, `rapports/page.tsx`, `retours/page.tsx`, `produits/fournisseurs/page.tsx`, entrée en stock et déchargement, fiches produit et client, menu.

- [ ] Pages selon les conventions existantes (`Card`, `PageTitle`, `Field`, `Select`, `Badge`, `api()`) ; typecheck Web ; commit.

### Task 9: Mobile

**Files:** `apps/mobile/app/driver/delivery/[orderId].tsx` (motif de refus), `apps/mobile/app/warehouse/unload/[workdayId].tsx` (répartition, lot, photo), `apps/mobile/app/seller/refusals.tsx` + bouton du tableau de bord.

- [ ] Écrans ; typecheck mobile ; commit.

### Task 10: Documentation, CI, fusion locale

- [ ] `docs/api.md` (routes et opérations de la phase 21) ; `plan_VF.md` phase 21 cochée.
- [ ] CI locale : `prettier --check --end-of-line auto .`, build sans mobile, typecheck, tests.
- [ ] Fusion dans `main` en local sans pousser ; suppression de la branche et du registre.
