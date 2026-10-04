# Phase 16 — Commandes : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le pré-vendeur prend, modifie et annule ses commandes depuis la visite (prix, paliers, bonus, quotas, réservation du stock), et le superviseur gère sur le Web quotas, lignes en attente, objectifs, historique et journées.

**Architecture:** nouvelles opérations `order.confirm` / `order.update` / `order.cancel` dans le registre `SyncHandlers` (phase 15), traitées par un `OrderService` qui recalcule le panier avec `priceCart` et `PricingService.pricingCatalog`, scinde au quota et réserve au dépôt ; lectures `/me/visit-catalog` et `/me/orders` ; un module `supervision` pour les endpoints Web ; écrans Expo (panier, commandes du jour) et Next.js (5 pages).

**Tech Stack:** NestJS 11 + Prisma, Zod, Vitest ; Expo SDK 57 / Expo Router ; Next.js (apps/web, Tailwind, composants `@/components/ui`).

**Spec:** `docs/superpowers/specs/2026-10-04-phase-16-commandes-design.md`

## Global Constraints

- Erreurs `{ error: { code, message } }` en français ; codes `INVALID_STATE` (409), `BUSINESS_RULE` (422), `DUPLICATE` (409), `VALIDATION_ERROR` (400), `NOT_FOUND`.
- Client Prisma filtré `TENANT_PRISMA` ; `uuidv7()` ; audit de chaque écriture ; montants entiers en DA.
- Quantités de quota et de stock en **unité de base** ; lignes de commande dans l'unité saisie.
- Paquets partagés recompilés après modification (`pnpm --filter @sellwasl/<pkg> build`).
- Pas de changement du schéma Prisma.
- Tests d'API : un téléphone par vendeur pour tout le fichier ; dates propres à chaque test, données partagées remises en état (leçon de la phase 15).
- Mobile : composants `src/ui.tsx`, checklist ui-consistency de la phase 15 ; Web : composants `@/components/ui`, `api('company', …)`, `errorMessage`.

## Review Focus

- Deux confirmations de la même visite (double appui, renvoi) → une seule commande ; la seconde refusée sans réserver de stock (Task 3).
- Quota baissé ou épuisé entre le chargement du catalogue et la confirmation → l'excédent part en attente, jamais refusé (Task 3).
- Modifier une commande vers une quantité plus petite → le stock réservé de trop est rendu (Task 4).
- Rouvrir une journée puis la clôturer de nouveau → commandes `LOCKED` puis `CONFIRMED` puis `LOCKED`, sans doublon de visites manquées (Task 7).
- Accepter une ligne en attente quand le stock manque → ligne normale avec rupture, total recalculé (Task 6).

---

### Task 1: Règles partagées des commandes

**Files:** Create `packages/business-rules/src/orders.ts`, `orders.test.ts` ; Modify `index.ts`, `planning.ts` (si `nextWorkingDay` y trouve mieux sa place).

**Interfaces — Produces:**
- `type OrderStatusCode = 'DRAFT'|'CONFIRMED'|'LOCKED'|'PREPARING'|'READY'|'OUT_FOR_DELIVERY'|'DELIVERED'|'PARTIALLY_DELIVERED'|'FAILED'|'CANCELLED'`
- `canTransition(from: OrderStatusCode, to: OrderStatusCode): boolean`
- `splitByQuota(qty: number, unitBaseQty: number, remainingBase: number | null): { normal: number; pending: number }`
- `nextWorkingDay(date: string, calendar: { workingDays: readonly WeekdayCode[]; holidays: readonly string[] }): string`

- [ ] **Step 1: tests**

```ts
it('suit la machine à états des commandes (BR-CMD-02)', () => {
  expect(canTransition('CONFIRMED', 'LOCKED')).toBe(true);
  expect(canTransition('LOCKED', 'CONFIRMED')).toBe(true);
  expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
  expect(canTransition('LOCKED', 'CANCELLED')).toBe(false);
  expect(canTransition('DELIVERED', 'CONFIRMED')).toBe(false);
});
it('scinde au quota dans l’unité saisie (BR-QUO-03)', () => {
  expect(splitByQuota(10, 24, null)).toEqual({ normal: 10, pending: 0 });
  expect(splitByQuota(10, 24, 240)).toEqual({ normal: 10, pending: 0 });
  expect(splitByQuota(10, 24, 100)).toEqual({ normal: 4, pending: 6 }); // 100 ÷ 24 = 4 cartons
  expect(splitByQuota(10, 24, 0)).toEqual({ normal: 0, pending: 10 });
  expect(splitByQuota(3, 1, -5)).toEqual({ normal: 0, pending: 3 });
});
it('livre le jour ouvré suivant (BR-CMD-05)', () => {
  const cal = { workingDays: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] as const, holidays: ['2026-10-05'] };
  expect(nextWorkingDay('2026-10-08', cal)).toBe('2026-10-10'); // jeudi → samedi
  expect(nextWorkingDay('2026-10-04', cal)).toBe('2026-10-06'); // dimanche → mardi (lundi férié)
});
```
- [ ] **Step 2:** `pnpm --filter @sellwasl/business-rules test` → FAIL. **Step 3:** implémenter (`nextWorkingDay` réutilise `addDaysTo` et le code jour de `planning.ts`). **Step 4:** PASS + build. **Step 5:** commit « Règles des commandes : états, scission au quota, jour de livraison ».

### Task 2: Schémas partagés des commandes et de la supervision

**Files:** Modify `packages/validation/src/sync.ts` ; Create `packages/validation/src/orders.ts` ; Modify `index.ts`.

**Interfaces — Produces:**
- `OPERATION_TYPES` + `'order.confirm' | 'order.update' | 'order.cancel'`
- `orderLineInput = { variantId: uuid, unitId: uuid, qty: int ≥ 1 }` ; `orderConfirmPayload { orderId, number, visitId, lines (1..200), freeVariantChoices?: Record<uuid, uuid> }` ; `orderUpdatePayload { orderId, lines, freeVariantChoices? }` ; `orderCancelPayload { orderId }`
- `VisitCatalog`, `OrderDto { id, number, status, source, orderDate, deliveryDate, totalAmount, customer: { id, name }, seller: { id, code, name }, lines: OrderLineDto[] }`, `OrderLineDto { id, kind, pendingStatus, productName, variantName, unitName, enteredQty, orderedQty, reservedQty, unitPrice, lineAmount, isStockout }`
- `TodayResponse.counters` + `ordersCount`, `ordersAmount`
- Web : `quotasQuerySchema { date }`, `putQuotasSchema { date, entries: [{ userId, productVariantId, unitId, qty ≥ 0 }] }`, `QuotaDto`, `pendingLinesQuerySchema`, `decidePendingSchema { lineIds: uuid[] (1..200), decision: 'ACCEPT'|'REFUSE' }`, `PendingLineDto`, `objectivesQuerySchema { month }`, `putObjectivesSchema { month, entries: [{ userId, rangeId, targetAmount, bonusAmount, capPercent }] }`, `ObjectiveDto` (= `MyObjective` + `user`), `ordersQuerySchema { date?, sellerId?, status? }`, `workdaysQuerySchema { date }`, `WorkdayDto`, `workdayReasonSchema { reason: string 3..200 }`

- [ ] **Step 1:** écrire les schémas ; **Step 2:** build + typecheck ; **Step 3:** commit « Schémas des commandes et de la supervision ».

### Task 3: `order.confirm` et `/me/visit-catalog`

**Files:** Create `apps/api/src/field/order.service.ts`, `apps/api/src/field/visit-catalog.service.ts` ; Modify `field.module.ts` (importer `CatalogModule`), `me.controller.ts` ; Test `apps/api/test/orders.test.ts` (nouveau fichier, mêmes aides que `field.test.ts` : à extraire dans `test/phone.ts`).

**Interfaces:**
- Consumes: `SyncHandlers.register`, `WorkdayService.openWorkday`, `VisitService.sectorCustomer`, `PricingService.pricingCatalog`, `priceCart`, `splitByQuota`, `nextWorkingDay`.
- Produces: `OrderService.price(tx, actor, { customer, workday, lines, freeVariantChoices, excludeOrderId? })` → lignes prêtes à créer + totaux ; `OrderService.reserve(tx, lines)` / `release(tx, orderId)` ; `OrderService.lockWorkdayOrders(tx, workdayId)` ; `OrderService.depot(tx)`.

- [ ] **Step 1: tests** (`orders.test.ts`) :
  - confirmation simple : prix du type du client, total, `deliveryDate` jour ouvré suivant, source `PRE_SALES`, visite `COMPLETED` / `ORDER`, stock réservé (`GET /orders/:id` superviseur après la Task 6 ; ici via `GET /me/orders`) ;
  - palier et bonus (produit et règle du seed) : ligne `BONUS` à 0 ;
  - quota du seed (V07, THON-TOM, 200 unités de base le 2026-10-03) : 12 cartons demandés → 8 normaux (si carton = 24) et 4 en attente ; résultat `pendingLines` ;
  - rupture : quantité supérieure au stock du dépôt → `stockouts`, `isStockout` ;
  - visite par téléphone → source `PHONE` ;
  - refus : sans visite en cours (`INVALID_STATE`), visite déjà commandée (`INVALID_STATE`), article sans prix (`BUSINESS_RULE`), même article deux fois (`VALIDATION_ERROR`), numéro pris (`DUPLICATE`) ;
  - deux confirmations de la même visite envoyées à la suite → une seule commande (Review Focus) ;
  - `/me/visit-catalog` : n'inclut pas un article sans prix pour le type ni un article à stock nul (mettre un stock à 0 via un article dédié du seed ou une commande qui réserve tout), donne `quotaRemaining`.
- [ ] **Step 2:** FAIL. **Step 3:** implémenter (spec §3, §4). **Step 4:** PASS. **Step 5:** commit « Commande depuis la visite : prix figés, quotas, réservation ».

### Task 4: `order.update`, `order.cancel`, clôture → `LOCKED`, `/me/orders`, compteurs

**Files:** Modify `order.service.ts`, `workday.service.ts` (clôture appelle `lockWorkdayOrders` ; `today()` ajoute `ordersCount`, `ordersAmount`), `me.controller.ts` ; Test `orders.test.ts`.

- [ ] **Step 1: tests** : modifier vers moins → réservation rendue, total recalculé ; modifier en gardant le quota (ses propres lignes exclues) ; annuler → `CANCELLED`, réservation libérée ; modifier ou annuler une commande d'une journée clôturée → `INVALID_STATE` ; clôture → commandes `LOCKED` ; `/me/today` → `ordersCount`, `ordersAmount` (annulées exclues).
- [ ] **Step 2–4:** FAIL → implémenter → PASS. **Step 5:** commit « Modifier, annuler et figer les commandes ».

### Task 5: Quotas et objectifs (API superviseur)

**Files:** Create `apps/api/src/supervision/supervision.module.ts`, `quotas.service.ts`, `objectives-admin.service.ts`, `supervision.controller.ts` ; Modify `app.module.ts`, `field/objectives.service.ts` (exporter le calcul pour un vendeur donné) ; Test `apps/api/test/supervision.test.ts`.

- [ ] **Step 1: tests** : `PUT /quotas` (saisie en cartons → `qty` en unité de base, `enteredQty`, `enteredUnitId`), `GET /quotas?date=` ; `qty = 0` supprime ; date passée refusée ; quota visible dans `/me/visit-catalog` (`quotaRemaining`) ; `PUT /objectives` puis `GET /objectives?month=` (réalisé, prime due) ; vendeur ou comptable sans droit → 403.
- [ ] **Step 2–4.** **Step 5:** commit « Quotas du jour et objectifs du mois (superviseur) ».

### Task 6: Lignes en attente et historique des commandes

**Files:** Create `apps/api/src/supervision/pending-lines.service.ts`, `orders-admin.service.ts` ; Modify `supervision.controller.ts` ; Test `supervision.test.ts`.

- [ ] **Step 1: tests** : commande avec ligne en attente (quota) ; `GET /pending-lines?date=` la liste ; `ACCEPT` → quantité ajoutée à la ligne normale, réservation, total recalculé, ligne `ACCEPTED` ; `ACCEPT` avec stock insuffisant → rupture (Review Focus) ; `REFUSE` → `REFUSED` + vente perdue ; ligne déjà traitée → `INVALID_STATE` ; `GET /orders?date=&sellerId=` et `GET /orders/:id`.
- [ ] **Step 2–4.** **Step 5:** commit « Lignes en attente et historique des commandes ».

### Task 7: Journées — liste, réouverture, clôture d'office

**Files:** Create `apps/api/src/supervision/workdays-admin.service.ts` ; Modify `supervision.controller.ts`, `field/workday.service.ts` (extraire `closeEffects(tx, actor, workday)` réutilisé par la clôture d'office) ; Test `supervision.test.ts`.

- [ ] **Step 1: tests** : `GET /workdays?date=` (état, visites x/N, commandes, CA) ; `reopen` sans motif → 400 ; `reopen` → `IN_PROGRESS`, commandes `CONFIRMED`, `reopenCount` 1 ; clôture de nouveau → `LOCKED`, pas de visite manquée en double (Review Focus) ; `force-close` d'une journée en cours → `CLOSED`, `isForceClosed`, visites manquées, `LOCKED` ; réouverture refusée si une commande est `PREPARING` (mise à jour directe en base dans le test, faute de phase 18).
- [ ] **Step 2–4.** **Step 5:** commit « Réouverture et clôture d'office des journées ».

### Task 8: Mobile — panier et confirmation

**Files:** Create `apps/mobile/app/seller/order/[visitId].tsx`, `src/seller/cart.ts` (état du panier + `priceCart`), `src/seller/ProductPicker.tsx` ; Modify `app/seller/_layout.tsx`, `app/seller/visit/[customerId].tsx` (bouton activé), `src/sync/operations.ts` (`nextOrderNumber`), `src/auth/storage.ts` (`orderSeq`).

**Interfaces — Produces:** `useCart(catalog: VisitCatalog)` → `{ lines, add(productId, unitId, qtyByVariant), remove(variantId), priced: PricedCart, freeChoices, setFreeChoice }` ; `nextOrderNumber(userCode, series)`.

- [ ] **Step 0:** checklist ui-consistency de la phase 15 (même famille d'écrans) — pas de nouvelle recherche sauf ligne douteuse.
- [ ] **Step 1:** écran : catalogue par gamme + recherche ; feuille produit (unité, quantité par parfum) ; panier (lignes, gratuits, total, en attente estimé) ; confirmer → `order.confirm` (ou `order.update` avec `?orderId=`), retry sur `DUPLICATE` du numéro comme les reçus ; résultat (en attente, ruptures) puis `router.dismissTo('/seller')`.
- [ ] **Step 2:** typecheck ; export Metro. **Step 3:** commit « Mobile : prise de commande ».

### Task 9: Mobile — commandes du jour, modification, annulation, tableau de bord

**Files:** Create `app/seller/orders.tsx`, `app/seller/orders/[id].tsx` ; Modify `app/seller/index.tsx`, `_layout.tsx`.

- [ ] **Step 1:** liste (`/me/orders?date=`), détail (lignes, en attente, ruptures, total) ; « Modifier » → panier pré-rempli ; « Annuler » → confirmation → `order.cancel` ; actions masquées avec raison hors `CONFIRMED` ou hors journée ; tableau de bord : « Commandes du jour : n · CA ».
- [ ] **Step 2:** typecheck, export Metro, vérification ui-consistency (agent séparé, calibré une fois pour le mobile) ; corrections. **Step 3:** commit « Mobile : commandes du jour ».

### Task 10: Web — quotas, lignes en attente, objectifs, commandes, journées

**Files:** Create `apps/web/src/app/app/(espace)/quotas/page.tsx`, `attente/page.tsx`, `objectifs/page.tsx`, `commandes/page.tsx`, `journees/page.tsx` ; Modify `(espace)/layout.tsx` (NAV avec permissions `quotas.read`, `pending_lines.process`, `objectives.read`, `orders.read`, `workdays.read`), `src/lib/labels.ts` (libellés des statuts).

- [ ] **Step 0:** ui-consistency finding-patterns sur les pages Web (référence : `planning/page.tsx`), checklist dans le scratchpad.
- [ ] **Step 1–5:** une page par étape, avec ses états de chargement, d'erreur (`Alert`) et vide ; confirmations par `Modal`.
- [ ] **Step 6:** `pnpm --filter @sellwasl/web typecheck` et `build` ; vérification ui-consistency (agent séparé, calibré pour le Web) ; corrections. **Step 7:** commit « Web : quotas, lignes en attente, objectifs, commandes et journées ».

### Task 11: Fin de phase

- [ ] `pnpm typecheck`, `pnpm test`.
- [ ] `plan_VF.md` (phase 16 cochée, report de ce qui reste) ; `docs/api.md` (nouveaux endpoints et opérations).
- [ ] Commit « Phase 16 : commandes ». Aucune nouvelle dépendance native : pas de recompilation de l'APK.
