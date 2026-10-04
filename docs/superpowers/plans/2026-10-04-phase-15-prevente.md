# Phase 15 — Mobile pré-vendeur et visites : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le pré-vendeur fait sa journée sur le téléphone : démarrer, voir ses clients du jour (liste et carte), visiter (sur place ou par téléphone), clore sans commande, créer un client, encaisser une dette, consulter objectifs et catalogue, clôturer.

**Architecture:** les écritures du téléphone sont des **opérations** idempotentes envoyées tout de suite à `POST /sync/push` (module `sync` de l'API, un traitement par type) ; les lectures passent par des endpoints en ligne (`/me/today`, `/me/objectives`, et les endpoints clients, motifs, catalogue existants). Les règles pures (distance, compteurs, objectifs, numéros) vont dans `packages/business-rules`, partagées avec le téléphone.

**Tech Stack:** NestJS 11 + Prisma (PostgreSQL), Zod (`packages/validation`), Vitest ; Expo SDK 57, Expo Router, React Native 0.86, `expo-location`, `@maplibre/maplibre-react-native` 11, `expo-crypto`.

**Spec:** `docs/superpowers/specs/2026-10-04-phase-15-prevente-design.md`

## Global Constraints

- Messages d'erreur en français, au format `{ error: { code, message, details } }` (`docs/api.md` §2) ; codes : `INVALID_STATE` (409), `BUSINESS_RULE` (422), `DUPLICATE` (409), `NOT_FOUND`, `FORBIDDEN`.
- Toute requête Prisma passe par le client filtré `TENANT_PRISMA` ; identifiants `uuidv7()` ; écritures auditées (`AuditService.write(entry, tx)`).
- Montants en DA, entiers (`BigInt` en base, `number` dans les DTO).
- Les paquets `packages/*` sont consommés compilés : après modification, `pnpm --filter @sellwasl/business-rules build` et `pnpm --filter @sellwasl/validation build`.
- Mobile : couleurs par `colors` de `@sellwasl/config`, composants de `src/ui.tsx`, `StyleSheet.create` en bas de fichier, imports `@/…`, commentaires JSDoc courts en français.
- Pas de changement du schéma Prisma.
- Pas de suivi de position en arrière-plan (BR-JOU-09).

## Review Focus

- Une opération renvoyée deux fois (coupure réseau après envoi) ne crée rien de plus et renvoie le même résultat → test d'idempotence (Task 3).
- Clôturer avec une visite encore en cours → refus `INVALID_STATE`, aucune visite `MISSED` créée (Task 4).
- Encaisser plus que la dette, ou un montant nul ou négatif → refus, la dette ne bouge pas (Task 6).
- Faire une action (visite, encaissement) sans journée démarrée ou après la clôture → refus `INVALID_STATE` (Tasks 5, 6).
- Téléphone sans position (GPS refusé) → la liste reste utilisable, triée par nom ; la visite sur place est acceptée et marquée hors zone (Tasks 5, 9).

---

## File Structure

**Règles partagées**
- `packages/business-rules/src/geo.ts` — ajouter `distanceMeters`.
- `packages/business-rules/src/field.ts` (nouveau) — `visitCounters`, `objectiveProgress`, `paymentNumber`.
- `packages/business-rules/src/field.test.ts`, `geo` testé dans `territories.test.ts` ou `field.test.ts`.

**Validation**
- `packages/validation/src/sync.ts` (nouveau) — enveloppe `syncPushSchema`, schémas de payload par type, `SyncPushResponse`, `TodayResponse`, `MyObjective`.

**API**
- `apps/api/src/sync/sync.module.ts`, `sync.controller.ts`, `sync.service.ts` — `POST /sync/push`, registre des traitements.
- `apps/api/src/field/field.module.ts` — module de la journée de travail :
  - `workday.service.ts` — `workday.start`, `workday.close`, `today()` ;
  - `visit.service.ts` — `visit.start`, `visit.close_no_order` ;
  - `debt.service.ts` — `payment.debt` ;
  - `objectives.service.ts` — `GET /me/objectives` ;
  - `me.controller.ts` — `GET /me/today`, `GET /me/objectives`.
- `apps/api/src/planning/planning.module.ts` — exporter `PlanningService`.
- `apps/api/src/customers/customers.module.ts` — exporter `CustomersService` ; `customers.service.ts` — `create` accepte un `id` fourni.
- `apps/api/test/field.test.ts` (nouveau).

**Mobile**
- `src/sync/operations.ts` — `sendOperation`.
- `src/today/TodayContext.tsx` — `TodayProvider`, `useToday`.
- `src/location/useLocation.ts` — `useCurrentPosition`.
- `src/device/heartbeat.ts` — position pendant la journée.
- `app/_layout.tsx` — écrans du vendeur, routage par rôle.
- `app/seller/*.tsx` — écrans (tableau de bord, clients, carte, fiche, ajout, visite, encaissement, objectifs, catalogue, profil, clôture).
- `src/seller/*.tsx` — morceaux d'écran partagés (carte des clients, ligne client, bouton d'action gardé par la journée).

---

### Task 1: Règles partagées du terrain

**Files:**
- Modify: `packages/business-rules/src/geo.ts`
- Create: `packages/business-rules/src/field.ts`, `packages/business-rules/src/field.test.ts`
- Modify: `packages/business-rules/src/index.ts`

**Interfaces:**
- Produces:
  - `distanceMeters(a: LatLng, b: LatLng): number` (mètres, arrondi à l'entier)
  - `visitCounters(dayCustomerIds: readonly string[], visits: readonly { customerId: string; status: string }[]): { visited: number; planned: number; outOfProgram: number }`
  - `objectiveProgress(o: { targetAmount: number; realizedAmount: number; bonusAmount: number; capPercent: number }): { rate: number; estimatedBonus: number }` (`rate` en %, une décimale)
  - `paymentNumber(userCode: string, series: string, sequence: number): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { distanceMeters } from './geo';
import { objectiveProgress, paymentNumber, visitCounters } from './field';

describe('terrain', () => {
  it('mesure la distance entre deux points (haversine)', () => {
    const oran = { latitude: 35.6971, longitude: -0.6308 };
    expect(distanceMeters(oran, oran)).toBe(0);
    // 0,001° de latitude ≈ 111 m
    expect(distanceMeters(oran, { latitude: 35.6981, longitude: -0.6308 })).toBe(111);
  });

  it('compte x/N et les visites hors programme, une fois par client (BR-VIS-06 à 08)', () => {
    const day = ['A', 'B', 'C'];
    const visits = [
      { customerId: 'A', status: 'COMPLETED' },
      { customerId: 'A', status: 'COMPLETED' },
      { customerId: 'B', status: 'IN_PROGRESS' },
      { customerId: 'X', status: 'COMPLETED' },
      { customerId: 'C', status: 'MISSED' },
    ];
    expect(visitCounters(day, visits)).toEqual({ visited: 1, planned: 3, outOfProgram: 1 });
  });

  it('calcule le taux et la prime plafonnée (BR-OBJ-03)', () => {
    expect(
      objectiveProgress({ targetAmount: 3_200_000, realizedAmount: 1_984_000, bonusAmount: 12_000, capPercent: 120 }),
    ).toEqual({ rate: 62, estimatedBonus: 7440 });
    expect(
      objectiveProgress({ targetAmount: 1000, realizedAmount: 2000, bonusAmount: 10_000, capPercent: 120 }),
    ).toEqual({ rate: 200, estimatedBonus: 12_000 });
    expect(
      objectiveProgress({ targetAmount: 0, realizedAmount: 0, bonusAmount: 10_000, capPercent: 120 }),
    ).toEqual({ rate: 0, estimatedBonus: 0 });
  });

  it('numérote les reçus : code + série + séquence (ARC-11)', () => {
    expect(paymentNumber('V07', 'B', 42)).toBe('V07-B0042');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @sellwasl/business-rules test` → fonctions absentes.
- [ ] **Step 3: Implement** — `distanceMeters` (rayon 6 371 000 m), les trois fonctions de `field.ts`, export dans `index.ts`.
- [ ] **Step 4: Run, verify PASS**, puis `pnpm --filter @sellwasl/business-rules build`.
- [ ] **Step 5: Commit** — « Règles du terrain : distance, compteurs de visites, objectifs, numéros ».

### Task 2: Schémas partagés de la synchronisation et du terrain

**Files:**
- Create: `packages/validation/src/sync.ts`; Modify: `packages/validation/src/index.ts`

**Interfaces:**
- Produces:
  - `syncOperationSchema` (`{ opId: uuid, deviceSeq: int ≥ 1, type: string, occurredAt: ISO, workdayId?: uuid|null, settingsVersion?: int|null, payload: unknown }`), `syncPushSchema` (`{ deviceId: uuid, operations: syncOperation[] (1..100) }`)
  - `OPERATION_TYPES = ['workday.start','workday.close','visit.start','visit.close_no_order','customer.create','payment.debt'] as const`
  - payloads : `workdayStartPayload { workdayId, date }`, `workdayClosePayload { workdayId }`, `visitStartPayload { visitId, customerId, mode: 'ON_SITE'|'PHONE', latitude?: number|null, longitude?: number|null }`, `visitCloseNoOrderPayload { visitId, reasonId }`, `customerCreatePayload { customerId, name, phone?, address?, customerTypeId, latitude, longitude, frequency }`, `paymentDebtPayload { paymentId, number, customerId, amount: int > 0 }`
  - `SyncResult = { opId; status: 'APPLIED'|'APPLIED_WITH_CHANGES'|'REJECTED'|'GAP'; result?: Record<string, unknown>; error?: { code; message } }`, `SyncPushResponse = { results: SyncResult[]; serverTime: string }`
  - `TodayResponse` (spec §2.3), `MyObjective`, `myTodayQuerySchema { date?: date }`, `myObjectivesQuerySchema { month?: 'AAAA-MM' }`

- [ ] **Step 1:** écrire `sync.ts` avec ces schémas (Zod 4, `z.uuid()`, `z.iso.datetime()`) et types ; réutiliser `frequencySchema` de `customers.ts` s'il existe.
- [ ] **Step 2:** `pnpm --filter @sellwasl/validation build` puis `pnpm --filter @sellwasl/validation typecheck` → OK.
- [ ] **Step 3: Commit** — « Schémas de la synchronisation et des écrans du vendeur ».

### Task 3: `POST /sync/push` — enveloppe, idempotence, ordre

**Files:**
- Create: `apps/api/src/sync/sync.module.ts`, `sync.controller.ts`, `sync.service.ts`, `sync.handlers.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/field.test.ts`

**Interfaces:**
- Produces:
  - `interface OperationContext { actor: AuthUser; op: SyncOperationInput; tx: TenantTx }`
  - `type OperationHandler = (ctx: OperationContext) => Promise<Record<string, unknown>>` — lève `ApiError` pour refuser.
  - `SyncHandlers` (injectable) : `register(type: OperationType, permission: string, handler: OperationHandler)`.
  - `SyncService.push(actor, input): Promise<SyncPushResponse>`.
- Comportement : route `@AnyAuthenticated()`, refuse hors téléphone (`FORBIDDEN`) et `deviceId` ≠ appareil de la session (`FORBIDDEN`). Pour chaque opération : `opId` connu → résultat stocké ; `deviceSeq` ≠ dernier+1 → `GAP` pour elle et les suivantes (sauf `deviceSeq` ≤ dernier avec `opId` inconnu → `REJECTED DUPLICATE`) ; type inconnu ou permission absente → `REJECTED` ; sinon traitement dans `db.$transaction`, puis `SyncOperation` créée (dans la même transaction pour `APPLIED`, à part pour `REJECTED`).

- [ ] **Step 1: Write the failing test** (dans `field.test.ts`, avec l'aide `sellerToken` copiée de `customers.test.ts` qui renvoie `{ token, deviceId, series }`) :

```ts
it('applique une opération une seule fois, même renvoyée (BR-SYN-02)', async () => {
  const s = await seller('V07');
  const op = { opId: uuid(), deviceSeq: 1, type: 'workday.start', occurredAt: new Date().toISOString(),
    payload: { workdayId: uuid(), date: '2026-10-03' } };
  const first = await push(s, [op]);
  expect(first.body.results[0]).toMatchObject({ status: 'APPLIED' });
  const again = await push(s, [op]);
  expect(again.body.results[0]).toEqual(first.body.results[0]);
});

it('signale un trou dans la numérotation de l’appareil (GAP)', async () => {
  const s = await seller('V08');
  const reply = await push(s, [{ ...startOp('2026-10-03'), deviceSeq: 5 }]);
  expect(reply.body.results[0]!.status).toBe('GAP');
});

it('refuse un type inconnu sans bloquer les opérations suivantes', async () => {
  const s = await seller('V08');
  const reply = await push(s, [
    { ...startOp('2026-10-04'), deviceSeq: 1, type: 'unknown.type' },
    { ...startOp('2026-10-04'), deviceSeq: 2 },
  ]);
  expect(reply.body.results.map((r) => r.status)).toEqual(['REJECTED', 'APPLIED']);
});
```

- [ ] **Step 2: Run** `pnpm --filter @sellwasl/api test -- field` → FAIL (404).
- [ ] **Step 3: Implement** le module, le contrôleur (`@Post('sync/push') @HttpCode(200)`, `ZodValidationPipe(syncPushSchema)`), le service et le registre ; `workday.start` minimal enregistré par la Task 4 — pour ce test, la Task 4 est faite dans la foulée (les deux tasks se commitent ensemble si besoin).
- [ ] **Step 4: Run, verify PASS** (avec la Task 4).
- [ ] **Step 5: Commit** — « Synchronisation : réception des opérations du téléphone ».

### Task 4: Journée de travail — `workday.start`, `workday.close`, `GET /me/today`

**Files:**
- Create: `apps/api/src/field/field.module.ts`, `workday.service.ts`, `me.controller.ts`
- Modify: `apps/api/src/planning/planning.module.ts` (exports), `apps/api/src/app.module.ts`
- Test: `apps/api/test/field.test.ts`

**Interfaces:**
- Consumes: `SyncHandlers.register`, `PlanningService.day(userId, date)`, `visitCounters`, `missedCustomers`.
- Produces: `WorkdayService.today(actor, date): Promise<TodayResponse>` ; `WorkdayService.openWorkday(tx, actor): Promise<Workday>` (journée `IN_PROGRESS` de l'utilisateur, sinon `INVALID_STATE` « Démarrez votre journée d'abord. ») utilisé par les Tasks 5 et 6.

- [ ] **Step 1: Write the failing tests**

```ts
it('démarre la journée une fois par jour et la montre dans /me/today (BR-JOU-01)', async () => {
  const s = await seller('V07');
  expect((await today(s, '2026-10-05')).body.workday).toBeNull();
  const start = startOp('2026-10-05');
  expect((await push(s, [start])).body.results[0]!.status).toBe('APPLIED');
  const t1 = await today(s, '2026-10-05');
  expect(t1.body.workday).toMatchObject({ status: 'IN_PROGRESS' });
  expect(t1.body.counters).toMatchObject({ visited: 0, outOfProgram: 0 });
  const again = await push(s, [{ ...startOp('2026-10-05'), deviceSeq: start.deviceSeq + 1 }]);
  expect(again.body.results[0]).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });
});

it('refuse un jour non travaillé quand l’entreprise l’interdit (P-01)', async () => { /* passe P01 à false via PUT /settings (admin), démarre le vendredi 2026-10-09 → REJECTED BUSINESS_RULE ; remet P01 à true */ });

it('clôture : refusée avec une visite en cours, puis crée les visites manquées (BR-JOU-06, BR-PLA-06)', async () => {
  // démarre le 2026-10-03 (V07 : partie 1 de 3101), commence une visite sur un client du jour,
  // clôture → REJECTED INVALID_STATE ; clôt la visite sans commande ; clôture → APPLIED ;
  // GET /customers/:id/history d'un autre client du jour → une visite MISSED datée du 2026-10-03.
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** :
  - `workday.start` : rôle terrain (`workdays.own`) ; `dayStatus` via `PlanningService.day` ; P-01 lu dans `companySettingsSchema` ; `workday.create({ id: payload.workdayId, date, status: 'IN_PROGRESS', startedAt: occurredAt, settingsVersion, userId, deviceId, occurredAt })` ; doublon (même utilisateur et date) → `INVALID_STATE` « Votre journée du … est déjà démarrée. » ; écart d'horloge > 1 h → audit `workday.clock_skew` ; audit `workday.start`.
  - `workday.close` : journée à soi, `IN_PROGRESS`, sinon `INVALID_STATE` ; visite `IN_PROGRESS` → `INVALID_STATE` « Terminez d'abord la visite en cours. » ; clients du jour (`PlanningService.day`) moins ceux avec une visite `COMPLETED` → `visit.createMany` en `MISSED` (`isScheduled: true`) ; `status: 'CLOSED', closedAt` ; audit.
  - `today()` : `PlanningService.day(actor.userId, date)`, journée de la date, visites du jour, `visitCounters`, encaissé du jour (somme `cashAmount` des paiements de la journée), visite en cours, règles, `seller: { code, series }`.
  - `GET /me/today` : `@RequirePermission('workdays.own')`.
- [ ] **Step 4: Run, verify PASS**.
- [ ] **Step 5: Commit** — « Journée de travail : démarrer, clôturer, clients du jour ».

### Task 5: Visites — `visit.start`, `visit.close_no_order`

**Files:**
- Create: `apps/api/src/field/visit.service.ts`; Modify: `field.module.ts`
- Test: `apps/api/test/field.test.ts`

**Interfaces:**
- Consumes: `WorkdayService.openWorkday`, `distanceMeters`, `PlanningService.day`.

- [ ] **Step 1: Write the failing tests**

```ts
it('visite sur place : distance, hors zone et position inconnue, jamais bloquée (BR-VIS-02)', async () => {
  // journée du 2026-10-03 (V07) ; client du jour C avec position :
  // visit.start ON_SITE à la position du client → APPLIED, isOutOfZone false, distanceM 0 ;
  // close_no_order (motif CUSTOMER_ABSENT) ; nouvelle visite ON_SITE à ~1 km → isOutOfZone true ;
  // close ; visite ON_SITE sans position du téléphone → isOutOfZone true.
});

it('une seule visite en cours ; hors programme comptée à part (BR-VIS-07, BR-VIS-08)', async () => {
  // deux visit.start de suite → le second REJECTED INVALID_STATE ;
  // visite d'un client du secteur hors du jour → isScheduled false ; /me/today → outOfProgram 1.
});

it('motif « fermé définitivement » : client à revoir (BR-VIS-05)', async () => {
  // close_no_order avec le motif CLOSED_PERMANENTLY → GET /customers/:id (superviseur) : isClosedPermanently true.
});

it('refuse une visite sans journée en cours, et le mode téléphone en cash van (BR-JOU-05, BR-VIS-03)', async () => {
  // V08 sans journée → REJECTED INVALID_STATE ; C01 (CASHVAN-EST) journée démarrée, mode PHONE → REJECTED BUSINESS_RULE.
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** selon la spec §2.2 (client du secteur via `territory.sellerUserId = actor.userId`, `status: 'ACTIVE'` ; `isScheduled` = client dans `PlanningService.day(...).customers` ; P-02 ; `outOfZoneDistanceM` des paramètres ; audit `visit.start` / `visit.close`). Résultat `{ visitId, distanceM, isOutOfZone, isScheduled }`.
- [ ] **Step 4: Run, verify PASS**. **Step 5: Commit** — « Visites : sur place ou par téléphone, clôture sans commande ».

### Task 6: Création de client et encaissement de dette par opération

**Files:**
- Create: `apps/api/src/field/debt.service.ts`; Modify: `field.module.ts`, `apps/api/src/customers/customers.service.ts` (`create(actor, input, id?)`), `customers.module.ts` (export `CustomersService`)
- Test: `apps/api/test/field.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('crée un client par opération, avec l’identifiant du téléphone (BR-CLI-02)', async () => {
  // customer.create avec customerId, type DETAIL, position dans 3101 partie 2 → APPLIED, result.partName 'Partie 2' ;
  // GET /customers/:customerId (vendeur) → isNew true ; renvoyer la même opération → même résultat.
});

it('encaisse une dette, au plus égale à la dette (BR-PAY-04, BR-PAY-05)', async () => {
  // client endetté du seed (42 000 DA) dans le secteur du vendeur, journée démarrée ;
  // payment.debt 50 000 → REJECTED BUSINESS_RULE ; 0 → REJECTED (validation) ;
  // 12 000 avec numéro V07-B0001 → APPLIED ; dette = 30 000 ; même numéro sur une autre opération → REJECTED DUPLICATE ;
  // /me/today → counters.collectedAmount 12 000.
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (spec §2.2 ; écriture `customerDebtEntry` `kind: 'DEBT_PAYMENT', amount: -amount` ; `customer.update({ debtAmount: { decrement } })` ; audit). **Step 4: PASS**. **Step 5: Commit** — « Création de client et encaissement de dette depuis le téléphone ».

### Task 7: Objectifs du vendeur — `GET /me/objectives`

**Files:**
- Create: `apps/api/src/field/objectives.service.ts`; Modify: `me.controller.ts`, `field.module.ts`
- Test: `apps/api/test/field.test.ts`

- [ ] **Step 1: Test** : V07, `month=2026-10` → deux objectifs (BIMO 3 200 000 / prime 12 000, THON 5 000 000 / 15 000), `realizedAmount` 0, `rate` 0, `estimatedBonus` 0 ; `month=2026-11` → `[]`.
- [ ] **Step 2: FAIL. Step 3: Implement** : objectifs du mois ; réalisé = somme `deliveredQty × unitPrice` des lignes `kind <> 'BONUS'` des commandes du vendeur au statut `DELIVERED` ou `PARTIALLY_DELIVERED`, `deliveryDate` dans le mois, produits de la gamme (`product.rangeId`) ; `objectiveProgress`. **Step 4: PASS. Step 5: Commit** — « Objectifs du vendeur sur le téléphone ».

### Task 8: Socle mobile — opérations, journée, position, routage

**Files:**
- Create: `apps/mobile/src/sync/operations.ts`, `src/today/TodayContext.tsx`, `src/location/useLocation.ts`
- Modify: `src/device/heartbeat.ts`, `app/_layout.tsx`, `src/auth/storage.ts` (compteurs `deviceSeq` et séquence des reçus)

**Interfaces:**
- Produces:
  - `sendOperation<T = Record<string, unknown>>(type: OperationType, payload: object, workdayId?: string | null): Promise<T>` — lève `ApiClientError` (`NETWORK` → message « Réseau nécessaire pour cette action. », `REJECTED` → code et message du serveur).
  - `newId(): string` (UUID v7 à partir de `expo-crypto.getRandomBytes`).
  - `nextReceiptNumber(userCode, series): Promise<string>`.
  - `useToday(): { today: TodayResponse | null; loading: boolean; error: string | null; refresh(): Promise<void>; date: string; inProgress: boolean }`.
  - `useCurrentPosition(): { position: LatLng | null; status: 'loading' | 'granted' | 'denied'; refresh(): Promise<LatLng | null> }`.
- Routage : `SCREENS_BY_STATUS.loggedIn` accepte `seller` ; l'écran par défaut est `seller` pour `PRE_VENDEUR` et `VENDEUR_CASH_VAN`, `home` sinon.

- [ ] **Step 1:** écrire les trois modules et les brancher ; heartbeat : `position` = dernière position connue quand `today.workday.status === 'IN_PROGRESS'`.
- [ ] **Step 2:** `pnpm --filter @sellwasl/mobile typecheck` → OK.
- [ ] **Step 3: Commit** — « Mobile : opérations, journée du vendeur et position ».

### Task 9: Écrans du vendeur

**Files:** `apps/mobile/app/seller/_layout.tsx` (Stack), `index.tsx` (tableau de bord), `close.tsx`, `customers.tsx` (liste + bascules + carte), `customer/[id].tsx` (fiche), `customer-new.tsx`, `visit/[customerId].tsx`, `debt/[customerId].tsx`, `objectives.tsx`, `catalog.tsx`, `profile.tsx` ; `src/seller/CustomerMap.tsx`, `src/seller/CustomerRow.tsx`, `src/seller/WorkdayGuard.tsx`.

- [ ] **Step 0 (UI):** checklist ui-consistency (finding-patterns) sur les écrans existants (`home.tsx`, `login.tsx`, `src/ui.tsx`) avant le premier écran.
- [ ] **Step 1:** tableau de bord + clôture (UC-02, UC-05).
- [ ] **Step 2:** clients : liste triée par `distanceMeters` (nom sans position), bascules jour / secteur et liste / carte ; carte MapLibre (style raster OpenStreetMap, `ShapeSource` en `cluster`, couleurs `colors.status.toVisit` / `colors.status.visited`), appui → itinéraire (`google.navigation:q=lat,lng`, repli `https://www.google.com/maps/dir/?api=1&destination=lat,lng`), fiche, commencer la visite.
- [ ] **Step 3:** fiche client (UC-11) avec historique, appeler (`tel:`), itinéraire, actions gardées par `WorkdayGuard`.
- [ ] **Step 4:** ajout de client (UC-12) : types servis (`GET /customer-types` filtrés par `territory.customerTypes` de `today.day.territory` — via `GET /territories` si besoin), bouton GPS, fréquence, avertissement hors partie.
- [ ] **Step 5:** visite (UC-13, UC-16) : mode, résultat de `visit.start` (distance, hors zone), « Prendre une commande » désactivé (« Disponible avec les commandes »), motifs `GET /reasons?kind=NO_ORDER`.
- [ ] **Step 6:** encaissement (UC-19), objectifs (UC-20), catalogue sans prix (UC-21, photos de `src/catalog/photos.ts`), profil.
- [ ] **Step 7:** `pnpm --filter @sellwasl/mobile typecheck` ; vérification ui-consistency par un agent séparé ; corrections.
- [ ] **Step 8: Commit** — « Mobile : écrans du pré-vendeur ».

### Task 10: Fin de phase

- [ ] `pnpm typecheck`, `pnpm test` (toutes les suites) ; `npx prettier --check` sur les fichiers modifiés.
- [ ] `plan_VF.md` : cocher les lignes réalisées de la phase 15 (et la ligne de la phase 11 sur l'écran mobile de création, la ligne de la phase 14 sur les visites manquées) ; noter ce qui reste pour les phases 16 et 23.
- [ ] `docs/api.md` : ajouter `GET /me/today`, `GET /me/objectives`.
- [ ] Commit — « Phase 15 : mobile pré-vendeur et visites » ; recompiler l'APK si une dépendance native a changé.
