# Phase 23 — Offline-first et synchronisation : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le pré-vendeur, le vendeur cash van et le livreur travaillent sans réseau ; leurs actions
partent en file et se synchronisent une seule fois au retour du réseau.

**Architecture:** le serveur ajoute un curseur fiable (`change_xid`) et `GET /sync/pull` (registre
de « sortes » de données construites avec les services existants). Un nouveau paquet pur
`packages/offline` porte le moteur (file, cycle push/pull, nouveaux essais), les effets locaux des
opérations et les écrans recalculés. Le téléphone fournit le stockage SQLite, le réseau (NetInfo)
et lit ses écrans du terrain en local.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 16 ; TypeScript pur + vitest (`packages/offline`) ;
Expo SDK 57 (`expo-sqlite`, `@react-native-community/netinfo`) ; Next.js 16 (page Web).

**Spec:** `docs/superpowers/specs/2026-10-06-phase-23-offline-sync-design.md`

## Global Constraints

- Rôles hors connexion : `PRE_VENDEUR`, `VENDEUR_CASH_VAN`, `LIVREUR` ; le magasinier reste en ligne.
- Démarrage sans réseau permis seulement si `lastFullSyncDate` = date du téléphone ; sinon « Réseau nécessaire pour démarrer : aucune synchronisation aujourd'hui ».
- Vente cash van reçue avec `offline: true` au-delà du quota ou du stock du camion : appliquée, `APPLIED_WITH_CHANGES` (`QUOTA_EXCEEDED`, `TRUCK_STOCK_SHORT`) ; le stock ne devient jamais négatif ; le manque devient un `Discrepancy` `STOCK`.
- États d'une opération sur le téléphone : `PENDING`, `SYNCING`, `SYNCED`, `FAILED`, `CONFLICT`.
- Nouveaux essais : 5 s, 15 s, 60 s, puis 5 min.
- Lots d'envoi : 100 opérations au plus ; pages de réception : 500 lignes au plus.
- Données gardées : 7 jours d'historique (journées, visites, commandes, encaissements), quotas d'hier à J+7, planning du jour et du lendemain.
- Textes de l'interface en français, ton et longueur des écrans existants ; montants en DA entiers.
- Fusion locale dans `main`, **sans push** ; jamais de force push.
- CI locale verte avant la fusion : `npx prettier --check --end-of-line auto .`, `pnpm build --filter=!@sellwasl/mobile`, `pnpm typecheck`, `pnpm test`.
- Mobile : installer les modules natifs avec `npx expo install` ; lire la doc Expo v57 avant d'utiliser une API Expo (apps/mobile/AGENTS.md).

## Review Focus

1. Opération mise en file pendant un cycle en cours : elle doit partir au cycle suivant, sans être perdue ni envoyée deux fois (test dans la tâche 6).
2. Réponse de `/sync/push` perdue (réseau coupé après application) : renvoi du même `opId`, résultat identique, l'effet local ne s'applique pas deux fois (tâche 6 + tâche 13).
3. Changement de secteur pendant que des opérations attendent : les opérations partent d'abord, puis les données sont relues (tâche 6).
4. Jour qui change pendant que l'application est ouverte (minuit) : la première synchronisation du nouveau jour est complète et le planning suit (tâche 6).
5. Effet local d'une opération refusée (`CONFLICT`) : il disparaît de l'affichage (stock, dette, quota), l'opération reste visible avec son motif (tâche 7).

---

## Structure des fichiers

Serveur (`apps/api`) :
- `prisma/migrations/20261007090000_sync_change_xid/migration.sql` — colonne, index, trigger.
- `prisma/schema.prisma` — `changeXid BigInt @default(0) @map("change_xid")` sur chaque modèle synchronisé.
- `src/sync/sync-kinds.ts` — registre des sortes (`SyncKinds`).
- `src/sync/sync-pull.service.ts` — lecture différentielle, pagination, périmètre.
- `src/sync/kinds/*.kinds.ts` — sortes par domaine (référentiel, terrain, cash van, livreur), inscrites au démarrage.
- `src/sync/sync-log.service.ts` + route `GET /sync/operations`.
- `src/sync/sync.controller.ts` — `GET /sync/pull`, `GET /sync/operations`.
- `src/field/order.service.ts`, `src/delivery/sale.service.ts`, `src/field/workday.service.ts` — changements, hors connexion.
- `src/preparation/order-repricer.service.ts` — délègue à `repriceOrder` (business-rules).
- `test/sync-pull.test.ts`, `test/offline-e2e.test.ts`.

Partagé :
- `packages/validation/src/sync.ts` — `expected`, `offline`, `SyncChange`, types de `/sync/pull` et des sortes.
- `packages/business-rules/src/reprice.ts` — `repriceOrder` pur.
- `packages/offline/` — nouveau paquet : `src/types.ts`, `src/memory-store.ts`, `src/engine.ts`, `src/status.ts`, `src/effects.ts`, `src/views/*.ts`, `src/index.ts`, tests.

Téléphone (`apps/mobile`) :
- `src/offline/sqlite-store.ts`, `src/offline/transport.ts`, `src/offline/SyncProvider.tsx`, `src/offline/useLocal.ts`, `src/offline/SyncBar.tsx`, `app/sync.tsx`.
- `src/sync/operations.ts` — mise en file.
- Écrans du vendeur, du cash van, du livreur : lecture locale.

Web (`apps/web`) :
- `src/app/app/(espace)/synchronisation/page.tsx`, entrée de menu, badges dans `journees`.

---

### Task 1: Curseur fiable `change_xid`

**Files:**
- Create: `apps/api/prisma/migrations/20261007090000_sync_change_xid/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (chaque modèle qui a `changeSeq`)
- Test: `apps/api/test/sync-pull.test.ts` (créé ici, complété en tâche 2)

**Interfaces:**
- Produces: colonne `change_xid` (BIGINT, `pg_current_xact_id()`), champ Prisma `changeXid: bigint` ; fonction SQL utilisée par la tâche 2 : `pg_snapshot_xmin(pg_current_snapshot())::text::bigint`.

- [ ] **Step 1: Test qui échoue** — dans `test/sync-pull.test.ts`, avec `PrismaService` brut :

```ts
it('enregistre la transaction de chaque écriture (change_xid)', async () => {
  const [{ xid }] = await raw.$queryRaw<{ xid: bigint }[]>`
    UPDATE reason SET label = label WHERE id = (SELECT id FROM reason LIMIT 1)
    RETURNING change_xid AS xid`;
  const [{ xmin }] = await raw.$queryRaw<{ xmin: bigint }[]>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS xmin`;
  expect(xid).toBeGreaterThan(0n);
  expect(xmin).toBeGreaterThan(xid);
});
```

- [ ] **Step 2:** `pnpm --filter @sellwasl/api exec vitest run test/sync-pull.test.ts` → FAIL (colonne inconnue).
- [ ] **Step 3: Migration** :

```sql
-- Curseur de synchronisation fiable (phase 23, spec §3.1) : la transaction de chaque écriture.
CREATE OR REPLACE FUNCTION sync_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.change_seq := nextval('sync_change_seq');
  NEW.change_xid := pg_current_xact_id()::text::bigint;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND column_name = 'change_seq'
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN change_xid BIGINT NOT NULL DEFAULT 0', t);
    EXECUTE format('CREATE INDEX %I ON %I (company_id, change_xid)', t || '_company_id_change_xid_idx', t);
  END LOOP;
END $$;
```

  Puis, dans `schema.prisma`, ajouter sous chaque `changeSeq … @map("change_seq")` la ligne
  `changeXid BigInt @default(0) @map("change_xid")` et `@@index([companyId, changeXid])` à côté de
  `@@index([companyId, changeSeq])` (script node sur le fichier, vérifié par `prisma migrate diff`
  qui doit être vide après `prisma migrate dev`).
- [ ] **Step 4:** `pnpm --filter @sellwasl/api prisma:migrate` puis le test → PASS ; `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` → aucune différence.
- [ ] **Step 5: Commit** `feat(api): curseur de synchronisation fiable (change_xid)`.

### Task 2: `GET /sync/pull` et registre des sortes

**Files:**
- Create: `apps/api/src/sync/sync-kinds.ts`, `apps/api/src/sync/sync-pull.service.ts`, `apps/api/src/sync/kinds/reference.kinds.ts`, `apps/api/src/sync/kinds/field.kinds.ts`, `apps/api/src/sync/kinds/truck.kinds.ts`, `apps/api/src/sync/kinds/driver.kinds.ts`
- Modify: `apps/api/src/sync/sync.controller.ts`, `apps/api/src/sync/sync.module.ts`, `packages/validation/src/sync.ts`, `apps/api/test/routes.test.ts` (liste des fichiers qui utilisent `PrismaService` si besoin)
- Test: `apps/api/test/sync-pull.test.ts`

**Interfaces:**
- Produces (validation) :

```ts
export const OFFLINE_KINDS = ['settings','reason','product','pricing','territory','planningDay',
  'customer','quota','objective','workday','visit','order','payment','driverDay','truckStock',
  'truckCheck','depotStock'] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];
export interface PulledRow { kind: OfflineKind; id: string; data: unknown; deleted: boolean }
export interface SyncPullResponse {
  rows: PulledRow[];
  /** Sortes à vider avant d'écrire les lignes (réception complète ou sorte « ensemble »). */
  replace: OfflineKind[];
  cursor: string; hasMore: boolean; page: string | null;
  scope: string; reset: boolean; serverTime: string;
}
export const syncPullQuery = z.object({
  cursor: z.string().regex(/^\d+$/).default('0'),
  scope: z.string().max(200).optional(),
  page: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // date du téléphone (planning, quotas)
});
```

  Données de chaque sorte (types exportés depuis `validation`) :
  `settings` → `OfflineSettings { settingsVersion; rules: { outOfZoneDistanceM; P01_workOnNonWorkingDays; P02_outOfProgramVisits; P03_bonusConsumesQuota; P04_recalculateOnDecrease }; ticket: TicketSettingsDto; me: { userId; code; name; series: string | null; roleCode } }` (id `company`) ;
  `reason` → `ReasonRow` ; `product` → `ProductDto` ; `pricing` → `{ customerTypeId; catalog: VisitPricingCatalog }` (id = customerTypeId) ;
  `territory` → `TerritoryDto` ; `planningDay` → `PlanningDay` (id = date, jour et lendemain) ;
  `customer` → `CustomerDto` ; `quota` → `{ id; date; variantId; qty }` ; `objective` → `MyObjective` (id = `rangeId:month`) ;
  `workday` → `OfflineWorkday { id; date; status; startedAt; closedAt }` ;
  `visit` → `TodayVisit & { date: string }` ; `order` → `OrderDto & { workdayId: string | null; customerTypeId: string }` ;
  `payment` → `OfflinePayment { id; number; kind: 'DELIVERY_PAYMENT'|'DEBT_PAYMENT'; at; workdayId; customerId; orderId: string | null; dueAmount; cashAmount; creditAmount }` ;
  `driverDay` → `DriverRouteDto` (id = date) ; `truckStock` → `TruckStockDto` (id = variantId) ;
  `truckCheck` → `{ lines: TruckCheckLine[] }` (id `current`) ; `depotStock` → `{ variantId; available }` (id = variantId).
- Produces (API) : `SyncKinds.register(def: KindDef)` avec

```ts
interface KindContext { actor: AuthUser; tx: Prisma.TransactionClient; cursor: bigint; date: string; scope: Scope }
interface KindDef {
  kind: OfflineKind;
  roles: readonly RoleCode[];
  /** 'rows' : lignes changées depuis le curseur, avec suppressions ; 'set' : l'ensemble, renvoyé
   *  quand une table source a changé (ou curseur 0), et remplacé sur le téléphone. */
  mode: 'rows' | 'set';
  sources: readonly string[];            // tables SQL lues pour détecter un changement
  load(ctx: KindContext): Promise<{ id: string; data: unknown; deleted?: boolean }[]>;
}
```

  `SyncPullService.pull(actor, query): Promise<SyncPullResponse>`.

- [ ] **Step 1: Tests qui échouent** (`test/sync-pull.test.ts`, jour réservé `2027-06-05`, entreprises du seed) :
  - pré-vendeur `V01` (DISTRI-ORAN), `cursor=0` : toutes les sortes du pré-vendeur, `replace` = ces sortes, aucune sorte du livreur ; les clients sont ceux de son secteur seulement ; `planningDay` pour la date et le lendemain ;
  - deuxième lecture avec le curseur rendu, sans changement : `rows` vide, `replace` vide ;
  - le superviseur modifie un client du secteur (PATCH `/customers/:id`) → la lecture suivante renvoie ce client seul (`mode rows`) ;
  - le superviseur déplace un client hors du secteur → il revient avec `deleted: true` ;
  - un prix modifié → la sorte `pricing` revient en entier et figure dans `replace` ;
  - **transaction lente** : une transaction brute ouverte (`raw.$transaction` interactif) modifie un client, la lecture a lieu pendant qu'elle est ouverte, la transaction est validée ensuite → la lecture suivante renvoie le client ;
  - pagination : `limit` de test à 5 lignes par variable d'environnement `SYNC_PULL_PAGE_SIZE`, lecture page par page jusqu'à `hasMore: false`, toutes les lignes reçues une fois, curseur rendu seulement à la dernière page ;
  - clé de périmètre différente → `reset: true`, `rows` vide ;
  - cash van `C01` (CASHVAN-EST) : `truckStock` et `truckCheck` présents ; livreur `L01` : `driverDay`, pas de `pricing` ni de `quota` ;
  - Web → 403 ; magasinier mobile → 403 `OFFLINE_NOT_AVAILABLE`.
- [ ] **Step 2:** lancer le fichier → FAIL (404 sur `/sync/pull`).
- [ ] **Step 3: Implémentation**
  - `SyncPullService.pull` : vérifie canal mobile et rôle ; calcule la clé `role:t=<territoryId>:w=<truckId>` ; si `query.scope` fourni et différent → `{ reset: true, rows: [], replace: [], cursor: '0' … }` ;
  - transaction `REPEATABLE READ` (`db.$transaction(fn, { isolationLevel: 'RepeatableRead' })`), curseur suivant = `pg_snapshot_xmin(pg_current_snapshot())` lu en premier ; le jeton de page porte `{ k: indexSorte, id: dernierId, x: curseurSuivant }` en base64url ;
  - pour chaque sorte du rôle, dans l'ordre d'`OFFLINE_KINDS` : `set` → incluse si `cursor = 0` ou s'il existe une ligne de l'entreprise avec `change_xid >= cursor` dans une des `sources` (`SELECT EXISTS (… LIMIT 1)` par table, noms validés contre une liste fixe) ; `rows` → `load` reçoit le curseur et filtre lui-même ;
  - lignes d'une sorte triées par `id`, découpées par pages de `SYNC_PULL_PAGE_SIZE` (500) ;
  - sortes « rows » : la requête porte sur les lignes de l'entreprise changées depuis le curseur (`changeXid: { gte: cursor }`) ; une ligne hors périmètre ou supprimée part avec `deleted: true` ; données construites par les services existants (`CustomersService` → `CustomerDto`, `OrderService.toDtos`, catalogue `ProductDto`, `TruckStockDto` de la route `/me/truck-stock`) ;
  - sortes « set » : `settings`, `pricing` (`PricingService.pricingCatalog` pour chaque type de client de l'entreprise), `territory`, `planningDay` (`PlanningService.day` pour `date` et `addDaysTo(date, 1)`), `quota` (dates `date-1` à `date+7`), `objective` (`ObjectivesService` du vendeur), `workday`, `visit`, `payment` (7 jours), `driverDay` (service de `/me/route` pour `date`), `truckCheck` (service de `/me/truck-check`), `depotStock` (prévente : `OrderService.availableStock`) ;
  - `GET /sync/pull` (`@AnyAuthenticated`, `ZodValidationPipe(syncPullQuery)`).
- [ ] **Step 4:** le fichier de test → PASS ; `pnpm --filter @sellwasl/api test` → tout vert.
- [ ] **Step 5: Commit** `feat(api): réception différentielle GET /sync/pull (sortes par rôle, périmètre, pages)`.

### Task 3: Changements à la réception et journée hors connexion

**Files:**
- Modify: `packages/validation/src/sync.ts` (`expected`, `offline`, `SyncChange`, `SyncResult.changes`), `apps/api/src/sync/sync.service.ts` (statut `APPLIED_WITH_CHANGES`), `apps/api/src/sync/sync.handlers.ts` (le traitement peut rendre `changes`), `apps/api/src/field/order.service.ts`, `apps/api/src/delivery/sale.service.ts`, `apps/api/src/field/workday.service.ts`, `apps/api/src/stock/stock-ledger.service.ts` (sortie plafonnée au stock présent)
- Test: `apps/api/test/sync-pull.test.ts` (bloc « changements à la réception »)

**Interfaces:**
- Produces :

```ts
export type SyncChange =
  | { kind: 'QUOTA_PENDING'; productVariantId: string; pendingQty: number }
  | { kind: 'STOCKOUT'; productVariantId: string; orderedQty: number; reservedQty: number }
  | { kind: 'QUOTA_EXCEEDED'; productVariantId: string; exceededQty: number }
  | { kind: 'TRUCK_STOCK_SHORT'; productVariantId: string; shortQty: number };
export interface SyncResult { opId; status; result?; error?; changes?: SyncChange[] }
const expectedLines = z.array(z.object({
  variantId: z.uuid(), pendingQty: z.number().int().min(0), stockoutQty: z.number().int().min(0),
})).max(500).optional();
// orderConfirmPayload, orderUpdatePayload : + expected ; saleConfirmPayload : + offline: z.boolean().optional()
// workdayStartPayload, workdayClosePayload : + offline: z.boolean().optional()
```

  Un traitement d'opération renvoie `Record<string, unknown>` ; s'il contient `changes` (tableau non
  vide), `SyncService` enregistre et renvoie `APPLIED_WITH_CHANGES` avec `changes` (gardé dans
  `SyncOperation.result`, renvoyé à l'identique si l'opération revient).

- [ ] **Step 1: Tests qui échouent** :
  - pré-vendeur hors connexion : quota de 10 cartons, le téléphone calcule une commande de 8 avec `expected` vide ; le superviseur baisse le quota à 5 avant l'envoi ; `order.confirm` → `APPLIED_WITH_CHANGES`, `changes` = `[{ kind: 'QUOTA_PENDING', pendingQty: 3 × baseQty }]`, la commande a une ligne `PENDING` ; renvoi du même `opId` → même résultat, une seule commande ;
  - même commande avec `expected` égal au découpage du serveur → `APPLIED` ;
  - sans `expected` → `APPLIED` (comportement en ligne inchangé) ;
  - cash van `offline: true` au-delà du quota → `APPLIED_WITH_CHANGES` `QUOTA_EXCEEDED`, vente entière ; sans `offline` → `REJECTED` (BR-QUO-04) ;
  - cash van `offline: true` au-delà du stock du camion (stock ajusté à 2, vente de 5 unités) → `APPLIED_WITH_CHANGES` `TRUCK_STOCK_SHORT` `shortQty: 3`, stock du camion à 0, un `Discrepancy` `STOCK` de −3 au nom du vendeur et de la journée ;
  - `workday.start` avec `offline: true` → `isStartedOffline` ; `workday.close` avec `offline: true` → `isClosedOffline`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implémentation**
  - `OrderService.confirm/update` : après `build`, si `payload.expected` est fourni, comparer article par article la quantité `PENDING` et la quantité en rupture (`orderedQty − reservedQty` des lignes normales) ; chaque différence → `SyncChange` ; ajouter `changes` au résultat ;
  - `SaleService` : si `payload.offline`, les lignes `PENDING` du découpage sont refondues dans la ligne normale (quota ignoré) avec `QUOTA_EXCEEDED` ; la disponibilité du camion passée à `build` est infinie (`Number.MAX_SAFE_INTEGER`) pour ne pas créer de rupture ; avant `ledger.apply`, la sortie de chaque article est plafonnée au stock du camion (`StockLedger.available`) et le manque produit `TRUCK_STOCK_SHORT` et un `Discrepancy` (`kind STOCK`, `qty −manque`, `unitValue` = prix unitaire de base, `amount = −manque × unitValue`, `cause` « Vente hors connexion au-delà du stock du camion », `validatedByUserId` = vendeur, `status VALIDATED`) ;
  - `WorkdayService.start/close` : `isStartedOffline` / `isClosedOffline` = `payload.offline === true`.
- [ ] **Step 4:** PASS ; suite API verte.
- [ ] **Step 5: Commit** `feat(api): changements à la réception (APPLIED_WITH_CHANGES), vente cash van hors connexion, journée hors connexion`.

### Task 4: Journal de synchronisation (API + Web) et badges de journée

**Files:**
- Create: `apps/api/src/sync/sync-log.service.ts`, `apps/web/src/app/app/(espace)/synchronisation/page.tsx`
- Modify: `apps/api/src/sync/sync.controller.ts`, `packages/validation/src/sync.ts` (`SyncOperationRowDto`, `syncOperationsQuery`), `apps/web/src/lib/navigation.ts` (entrée « Synchronisation », groupe Administration, icône `pulse`, permission `devices.read`), page `journees` et `WorkdayRowDto` (champs `isStartedOffline`, `isClosedOffline`)
- Test: `apps/api/test/sync-pull.test.ts` (bloc « journal »)

**Interfaces:**
- Produces : `GET /sync/operations?status=&userId=&from=&to=&cursor=` → `Page<SyncOperationRowDto>` avec `{ id; opId; type; typeLabel; status; errorCode; errorMessage; changes: SyncChange[]; occurredAt; receivedAt; user: { id; code; name }; deviceId }`, 50 par page, tri `receivedAt desc`.

- [ ] **Step 1: Test qui échoue** : après les opérations de la tâche 3, le superviseur lit `/sync/operations?status=APPLIED_WITH_CHANGES` → contient l'`order.confirm` avec ses changements ; `status=REJECTED` → la vente refusée avec son motif ; un pré-vendeur (sans `devices.read`) → 403.
- [ ] **Step 2:** FAIL. **Step 3:** service + route ; page Web : `PageTitle` « Synchronisation », filtres (statut, utilisateur), tableau (heure du téléphone, réception, utilisateur, action, statut en `Badge`, motif ou changements), pagination « Plus » comme les pages de liste existantes ; badges « hors connexion » dans `journees`.
- [ ] **Step 4:** PASS ; `pnpm --filter @sellwasl/web typecheck`.
- [ ] **Step 5: Commit** `feat: journal de synchronisation (API, page Web) et journées hors connexion`.

### Task 5: `repriceOrder` partagé

**Files:**
- Create: `packages/business-rules/src/reprice.ts`, `packages/business-rules/src/reprice.test.ts`
- Modify: `packages/business-rules/src/index.ts`, `apps/api/src/preparation/order-repricer.service.ts`

**Interfaces:**
- Produces : `repriceOrder(catalog: PricingCatalog, order: { customerTypeId: string; date: string }, normals: RepriceNormal[], bonuses: RepriceBonus[], added: RepriceAdded[], recalculate: boolean): RepriceResult` — mêmes types que `OrderRepricer` mais prix en `number` ; lève `RepriceError` (message français) pour « même unité » et « non proposable ». `OrderRepricer.reprice` devient : catalogue → `repriceOrder` → conversion `bigint`, `RepriceError` → `rule(message)`.

- [ ] **Step 1:** tests : sans recalcul et sans ajout → prix et bonus inchangés ; recalcul avec baisse sous un palier → nouveau prix ; bonus plafonné au préparé ; produit ajouté sur une ligne existante, puis sur une nouvelle ligne ; unité différente → erreur ; article sans prix → erreur.
- [ ] **Step 2:** FAIL. **Step 3:** déplacer la logique. **Step 4:** `pnpm --filter @sellwasl/business-rules test` et suite API (`delivery`, `preparation`) verts.
- [ ] **Step 5: Commit** `refactor: recalcul des prix d'une commande partagé (repriceOrder)`.

### Task 6: Paquet `offline` : stockage, file, cycle, indicateur

**Files:**
- Create: `packages/offline/package.json`, `tsconfig.build.json`, `vitest.config.mts`, `src/types.ts`, `src/memory-store.ts`, `src/engine.ts`, `src/status.ts`, `src/index.ts`, `src/engine.test.ts`, `src/status.test.ts`
- Modify: `pnpm-workspace.yaml` (si les paquets ne sont pas couverts par `packages/*`), `apps/mobile/package.json` (dépendance `@sellwasl/offline: workspace:*`), `apps/mobile/metro.config.js` si présent

**Interfaces:**
- Produces :

```ts
export type OpStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export interface OutboxOp {
  opId: string; deviceSeq: number; type: OperationType; payload: Record<string, unknown>;
  workdayId: string | null; occurredAt: string; status: OpStatus; attempts: number;
  nextAttemptAt: string | null; error: { code: string; message: string } | null;
  result: Record<string, unknown> | null; changes: SyncChange[]; seen: boolean;
}
export type MetaKey = 'cursor' | 'scope' | 'lastFullSyncDate' | 'deviceSeq' | 'lastSyncAt' | 'lastError';
export interface OfflineStore {
  applyPull(rows: PulledRow[], replace: OfflineKind[]): Promise<void>;   // une transaction
  rows(kind: OfflineKind): Promise<{ id: string; data: unknown }[]>;
  clearRows(): Promise<void>;
  enqueue(op: OutboxOp): Promise<void>;
  outbox(): Promise<OutboxOp[]>;
  updateOps(patches: { opId: string; patch: Partial<OutboxOp> }[]): Promise<void>;
  removeOps(opIds: string[]): Promise<void>;
  getMeta(key: MetaKey): Promise<string | null>;
  setMeta(key: MetaKey, value: string | null): Promise<void>;
}
export interface Transport {
  push(operations: SyncOperationInput[]): Promise<SyncPushResponse>;   // lève NetworkError ou HttpError
  pull(q: { cursor: string; scope?: string; page?: string; date: string }): Promise<SyncPullResponse>;
}
export class NetworkError extends Error {}
export class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string) }
export class MemoryStore implements OfflineStore { /* tests */ }
export class SyncEngine {
  constructor(deps: { store: OfflineStore; transport: Transport; now?: () => Date; today: () => string });
  enqueue(type: OperationType, payload: Record<string, unknown>, workdayId: string | null, opId?: string): Promise<OutboxOp>;
  sync(): Promise<SyncReport>;            // un cycle ; appelé pendant un cycle : relance à la fin
  onChange(listener: () => void): () => void;
}
export interface SyncReport { pushed: number; conflicts: number; changes: number; pulled: number; ok: boolean; error?: string }
export function syncStatus(ops: OutboxOp[], lastError: string | null, online: boolean): SyncIndicator;
export interface SyncIndicator { state: 'SYNCED' | 'PENDING' | 'ERROR'; pending: number; conflicts: number; unseenChanges: number }
export const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];
```

  Règles du cycle (spec §4.3) : envoi des `PENDING` et des `FAILED` échues par lots de 100 ; `APPLIED`/`APPLIED_WITH_CHANGES` → `SYNCED` (+ `changes`) ; `REJECTED` → `CONFLICT` ; `GAP` ou `DUPLICATE` avec `expectedDeviceSeq` → renumérotation des opérations non appliquées depuis le numéro attendu (`deviceSeq` en méta mis à jour) et un nouvel envoi dans le même cycle ; `NetworkError` ou `HttpError` ≥ 500 → `FAILED`, `attempts + 1`, `nextAttemptAt = now + RETRY_DELAYS_MS[min(attempts−1, 3)]`, fin du cycle ; réception : `cursor = 0` si `lastFullSyncDate ≠ today()` ; pages jusqu'à `hasMore: false` cumulées puis `applyPull` en une fois ; `reset` → `clearRows`, `scope` et `cursor` effacés, nouvelle réception complète ; à la fin : `removeOps` des `SYNCED` vues et sans changements, les `SYNCED` avec changements restent jusqu'à `seen` ; `lastSyncAt`, `lastError`.

- [ ] **Step 1: Tests qui échouent** (`engine.test.ts`, transport simulé en mémoire qui imite le serveur : `opId` connus, `deviceSeq` attendu, lignes à rendre) :
  1. une opération en file part et passe `SYNCED`, puis disparaît de la file après la réception ;
  2. réponse perdue (le faux serveur applique puis lève `NetworkError`) → `FAILED` ; cycle suivant après le délai → même `opId` renvoyé, une seule application côté faux serveur ;
  3. `GAP` (faux serveur attend 4, le téléphone envoie 6) → renumérotation 4, 5… et application dans le même cycle ;
  4. `REJECTED` → `CONFLICT`, gardée, les suivantes continuent ;
  5. délais : 5 s, 15 s, 60 s, 300 s, puis 300 s ;
  6. `enqueue` pendant un cycle → envoyée au cycle relancé, jamais deux fois (Review Focus 1) ;
  7. réception paginée : `applyPull` appelé une seule fois avec toutes les lignes et l'union des `replace` ;
  8. `reset` avec opérations en attente → l'envoi a lieu d'abord, puis effacement et réception complète (Review Focus 3) ;
  9. changement de jour : `lastFullSyncDate` d'hier → réception avec `cursor=0`, puis `lastFullSyncDate` = aujourd'hui (Review Focus 4) ;
  10. `syncStatus` : file vide → `SYNCED` ; 3 en attente → `PENDING 3` ; un `CONFLICT` non vu → `ERROR` ; `lastError` et en ligne → `ERROR` ; hors ligne avec opérations → `PENDING`.
- [ ] **Step 2:** `pnpm --filter @sellwasl/offline test` → FAIL.
- [ ] **Step 3:** implémentation.
- [ ] **Step 4:** PASS ; `pnpm --filter @sellwasl/offline typecheck`.
- [ ] **Step 5: Commit** `feat(offline): file d'envoi, cycle de synchronisation, indicateur`.

### Task 7: Effets locaux et écrans du pré-vendeur

**Files:**
- Create: `packages/offline/src/local-state.ts`, `src/effects.ts`, `src/views/today.ts`, `src/views/visit-catalog.ts`, `src/views/customers.ts`, `src/views/orders.ts`, tests associés
- Modify: `packages/offline/src/index.ts`

**Interfaces:**
- Produces :

```ts
/** Vue locale : lignes reçues + effets des opérations en file (spec §4.4). */
export interface LocalState {
  settings: OfflineSettings | null; products: ProductDto[]; pricing: Map<string, VisitPricingCatalog>;
  territories: TerritoryDto[]; planning: Map<string, PlanningDay>; customers: Map<string, CustomerDto>;
  quotas: OfflineQuota[]; objectives: MyObjective[]; workdays: OfflineWorkday[]; visits: OfflineVisit[];
  orders: Map<string, OfflineOrder>; payments: OfflinePayment[]; reasons: ReasonRow[];
  driverDays: Map<string, DriverRouteDto>; truckStock: Map<string, TruckStockDto>;
  truckCheck: TruckCheckLine[]; depotStock: Map<string, number>;
}
export function loadState(rows: Map<OfflineKind, { id: string; data: unknown }[]>): LocalState;
export function applyOps(state: LocalState, ops: OutboxOp[]): LocalState;   // ignore CONFLICT
export function todayView(s: LocalState, date: string): TodayResponse;
export function visitCatalogView(s: LocalState, customerId: string, date: string): VisitCatalog;
export function customersView(s: LocalState): CustomerDto[];
export function customerView(s: LocalState, id: string): CustomerDto | null;
export function ordersView(s: LocalState, date: string): OrderDto[];
export function objectivesView(s: LocalState): MyObjective[];
export function consumedQuota(s: LocalState, date: string, P03: boolean, excludeOrderId?: string): Map<string, number>;
export function expectedSplit(s: LocalState, input: { customerId: string; date: string; lines: CartLineInput[]; freeVariantChoices: Record<string, string>; orderId?: string }): { lines: OrderLineDto[]; expected: { variantId: string; pendingQty: number; stockoutQty: number }[]; totalAmount: number };
```

  Effets (`applyOps`) : `workday.start` (journée `IN_PROGRESS`), `workday.close` (`CLOSED`),
  `visit.start` (visite `IN_PROGRESS`, devient la visite en cours), `visit.close_no_order`
  (`COMPLETED`), `customer.create` (client ajouté), `order.confirm` / `order.update` (commande
  `CONFIRMED` avec les lignes d'`expectedSplit`, visite terminée), `order.cancel` (`CANCELLED`),
  `payment.debt` (encaissement, dette du client diminuée). `todayView` reproduit
  `WorkdayService.today` : journée du jour, journée restée ouverte d'un autre jour, `planning[date]`
  (dette prise dans `customers`), visites du jour, `visitCounters`, encaissé, commandes non
  annulées, visite en cours, règles, vendeur (`settings.me`). `visitCatalogView` reproduit
  `VisitCatalogService.forCustomer` : grille du type du client, produits proposables, quota restant
  = quota − `consumedQuota` (P-03), stock (camion pour le cash van, dépôt sinon).

- [ ] **Step 1: Tests qui échouent** (données construites dans un fichier `fixtures.ts` : 2 produits, 1 type de client, quota, planning) :
  - `todayView` sans opération = valeurs reçues ; après `workday.start` → `IN_PROGRESS` ; après `visit.start` → visite en cours ; après `order.confirm` → compteurs commandes et montant, visite terminée ;
  - `visitCatalogView` : quota restant diminue après une commande en file ; P-03 : bonus compté ou non ;
  - `expectedSplit` : au-delà du quota restant → ligne `PENDING` et `expected.pendingQty` ;
  - `payment.debt` → dette du client diminuée dans `customerView` et dans `todayView` ;
  - opération `CONFLICT` → aucun effet (quota, dette, commande) (Review Focus 5) ;
  - `SYNCED` encore en file + ligne reçue de même id → la ligne reçue l'emporte, pas de doublon.
- [ ] **Step 2:** FAIL. **Step 3:** implémentation. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(offline): effets locaux et écrans du pré-vendeur`.

### Task 8: Écrans et effets du cash van

**Files:**
- Create: `packages/offline/src/views/truck.ts`, `src/views/day-summary.ts`, `src/views/receipts.ts`, tests
- Modify: `packages/offline/src/effects.ts`

**Interfaces:**
- Produces : `truckStockView(s): TruckStockDto[]`, `truckCheckView(s): TruckCheckLine[]`, `daySummaryView(s, date): DaySummaryDto`, `receiptView(s, kind: 'SALE' | 'DEBT' | 'DELIVERY', id: string): ReceiptPrintDto | null`, `receiptsView(s, date): ReceiptPrintDto[]`. Effets ajoutés : `sale.confirm` (vente `DELIVERED`, encaissement, crédit, dette, sortie du stock du camion), `lost_demand.create` (aucun effet de stock), `truck.check` (stock du camion = compté, `truckCheck` vidé), `load.receive` (stock du camion + chargement).
- [ ] **Step 1:** tests : vente en file → stock du camion diminué, dette augmentée du crédit, résumé (ventes, espèces, crédit, attendu) ; reçu de vente construit (lignes, total, payé, crédit, dette après) ; pointage → stock = compté ; journée cash van complète en file (démarrage, pointage, 2 visites, 1 vente, 1 encaissement de dette, clôture) → `todayView` `CLOSED` et résumé cohérent.
- [ ] **Step 2–4:** FAIL → implémentation → PASS.
- [ ] **Step 5: Commit** `feat(offline): cash van hors connexion (stock du camion, résumé, bons)`.

### Task 9: Écrans et effets du livreur

**Files:**
- Create: `packages/offline/src/views/driver.ts`, test
- Modify: `packages/offline/src/effects.ts`

**Interfaces:**
- Consumes : `repriceOrder` (tâche 5).
- Produces : `driverRouteView(s, date): DriverRouteDto`, `deliveryPreviewView(s, input: { orderId; lines: { lineId; qty }[]; added: { variantId; unitId; qty }[] }): DeliveryPreviewDto` (P-04 et `minimumCash` comme `DeliveryService.compute`). Effets : `load.receive`, `truck.check`, `delivery.complete` (résultat `DELIVERED` ou `PARTIAL`, quantités livrées, encaissement, dette, stock du camion), `delivery.fail` (`FAILED`), `payment.debt`.
- [ ] **Step 1:** tests : livraison complète → progression, encaissé, stock ; livraison partielle avec P-04 → prix recalculés (palier perdu) ; minimum à encaisser selon le plafond de crédit ; échec → `failed + 1`.
- [ ] **Step 2–4:** FAIL → implémentation → PASS.
- [ ] **Step 5: Commit** `feat(offline): livreur hors connexion (tournée, aperçu de livraison)`.

### Task 10: Téléphone : SQLite, réseau, `SyncProvider`, barre d'état, écran Synchronisation

**Files:**
- Create: `apps/mobile/src/offline/sqlite-store.ts`, `transport.ts`, `SyncProvider.tsx`, `useLocal.ts`, `SyncBar.tsx`, `apps/mobile/app/sync.tsx`
- Modify: `apps/mobile/package.json` (`expo-sqlite`, `@react-native-community/netinfo` via `npx expo install`), `apps/mobile/app/_layout.tsx` (fournisseur), `apps/mobile/src/sync/operations.ts`, `apps/mobile/src/today/TodayContext.tsx`, `apps/mobile/src/auth/AuthContext.tsx` (déconnexion refusée avec opérations en attente, effacement au changement d'utilisateur)

**Interfaces:**
- Consumes : `SyncEngine`, `OfflineStore`, `Transport`, `loadState`, `applyOps`, `syncStatus`.
- Produces : `useSync(): { indicator: SyncIndicator; online: boolean; syncing: boolean; syncNow(): Promise<SyncReport>; ops: OutboxOp[]; markSeen(opIds: string[]): Promise<void>; lastSyncAt: string | null }` ; `useLocal<T>(view: (s: LocalState) => T): { data: T | null; ready: boolean }` (recalculé quand la base ou la file change) ; `sendOperation(type, payload, workdayId)` met en file (`engine.enqueue`), lance `syncNow()` sans l'attendre et rend `{ opId }` immédiatement.
- [ ] **Step 1:** lire la doc Expo v57 de `expo-sqlite` (API `openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync`, `withTransactionAsync`) et de NetInfo ; installer les deux modules (`npx expo install expo-sqlite @react-native-community/netinfo`).
- [ ] **Step 2:** `SqliteStore implements OfflineStore` (tables `records`, `outbox`, `meta`, création au premier lancement, JSON en texte) ; `HttpTransport` sur `request` (`ApiClientError` code `NETWORK` → `NetworkError`, statut ≥ 400 → `HttpError`) ; reprise de l'ancienne opération « en attente » (`secureStorage.getPendingOp`) dans la file au premier lancement ; `deviceSeq` repris de `secureStorage`.
- [ ] **Step 3:** `SyncProvider` : moteur unique, cycle au retour du réseau (NetInfo), au retour au premier plan (`AppState`), après chaque mise en file, sur le bouton ; état exposé ; aucune tâche de fond.
- [ ] **Step 4:** `SyncBar` (texte « Synchronisé » / « N en attente » / « Erreur », couleurs `synced` / `pending` / `error` du thème mobile, appui → `/sync`) ; écran `app/sync.tsx` : bouton « Synchroniser », dernière synchronisation, opérations en attente, refusées (motif), changements reçus (libellés : « Quantité passée en attente », « Rupture au dépôt », « Quota dépassé (vente acceptée) », « Stock du camion insuffisant (écart enregistré) »), bouton « J'ai vu ».
- [ ] **Step 5:** `pnpm --filter @sellwasl/mobile typecheck` → OK. Commit `feat(mobile): base locale, file d'envoi, synchronisation automatique et écran Synchronisation`.

### Task 11: Téléphone : écrans du pré-vendeur en local

**Files:**
- Modify: `apps/mobile/src/today/TodayContext.tsx` (`todayView`), `src/seller/customers.ts` (`customersView` + `planning`), `app/seller/index.tsx` (bandeau des changements non vus, `SyncBar`), `app/seller/customer/[id].tsx` (fiche locale ; historique : en ligne seulement, message hors ligne), `app/seller/visit/[customerId].tsx`, `app/seller/order/[visitId].tsx` (`visitCatalogView`, `expectedSplit` → `expected` dans le payload), `app/seller/orders.tsx`, `app/seller/orders/[id].tsx`, `app/seller/debt/[customerId].tsx`, `app/seller/customer-new.tsx` (`territories`), `app/seller/catalog.tsx`, `app/seller/objectives.tsx`, `app/seller/close.tsx` (clôture `offline`), démarrage de journée (règle du jour)
- [ ] **Step 1:** remplacer chaque `request` de lecture listé dans la spec §5 par `useLocal(view)` ; `act()` de `TodayContext` met en file et rafraîchit la vue locale ; démarrage : en ligne → `syncNow()` puis `workday.start` ; hors ligne → contrôle `lastFullSyncDate` (message exact des Global Constraints) puis `workday.start` avec `offline: true`.
- [ ] **Step 2:** `pnpm --filter @sellwasl/mobile typecheck`. Commit `feat(mobile): pré-vendeur hors connexion`.

### Task 12: Téléphone : cash van et livreur en local, impression locale

**Files:**
- Modify: `apps/mobile/src/truck/TruckCheck.tsx`, `src/truck/TruckStockList.tsx`, `src/printing/printer.ts` et `ReceiptsScreen.tsx` (`receiptView`, `receiptsView`, `daySummaryView`, `settings.ticket`), `app/seller/order/[visitId].tsx` (vente cash van : `offline: !online`), `app/driver/index.tsx`, `route.tsx`, `receive.tsx`, `receipts.tsx`, `delivery/[orderId].tsx` (`driverRouteView`, `deliveryPreviewView`, `truckStockView`, motifs locaux)
- [ ] **Step 1:** même remplacement ; impression après une vente ou une livraison avec le reçu local.
- [ ] **Step 2:** typage. Commit `feat(mobile): cash van et livreur hors connexion, bons imprimés en local`.

### Task 13: Critères de bout en bout, parité, documentation

**Files:**
- Create: `apps/api/test/offline-e2e.test.ts`, `docs/offline-sync.md`
- Modify: `docs/api.md` §6, `docs/architecture.md` §10, `docs/database.md` (§1.2 `change_xid`), `plan_VF.md` (phase 23 cochée), `apps/api/package.json` (devDependency `@sellwasl/offline: workspace:*`)

- [ ] **Step 1: Tests** (`offline-e2e.test.ts`, jour réservé `2027-06-12`), moteur `SyncEngine` + `MemoryStore` + transport HTTP vers l'API de test :
  - **critère 1** : commande mise en file hors ligne (transport qui lève `NetworkError`), puis réseau rétabli, cycle → une seule commande ; un transport qui perd la réponse une fois → toujours une seule commande ;
  - **critère 2** : réception complète, commande calculée en local dans le quota, quota baissé par le superviseur, cycle → `APPLIED_WITH_CHANGES` `QUOTA_PENDING`, ligne « en attente » sur le serveur, changement visible dans la file (`changes`) ;
  - **critère 3** : cash van : réception complète, puis transport hors ligne ; démarrage `offline: true`, pointage, visites, vente, encaissement de dette, clôture `offline: true`, tout en file ; réseau rétabli → un cycle, tout `SYNCED`, journée `CLOSED` et `isClosedOffline`, stock du camion et dette du serveur égaux à la vue locale ;
  - **parité** : après réception complète, `todayView` et `visitCatalogView` locaux égalent `/me/today` et `/me/visit-catalog` du serveur (même date, même client).
- [ ] **Step 2:** lancer, corriger jusqu'au vert.
- [ ] **Step 3:** documentation (`offline-sync.md` : principe, sortes, cycle, états, changements, règles de démarrage et de clôture, vérification manuelle en mode avion pour les trois rôles) ; plan_VF : tâches, livrable et critères cochés.
- [ ] **Step 4:** CI locale complète (Global Constraints).
- [ ] **Step 5: Commit** `test+docs: critères hors connexion de bout en bout, offline-sync.md, phase 23 cochée`.
