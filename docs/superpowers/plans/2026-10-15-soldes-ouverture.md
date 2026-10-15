# Soldes d'ouverture des dettes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'admin et au comptable d'inscrire, à la mise en service, la dette que chaque client avait dans l'ancien système (fiche client et import CSV), modifiable jusqu'à la première opération de dette du client.

**Architecture:** Nouveau type d'écriture `OPENING_BALANCE` dans le registre des dettes (ajout seul) ; un service `OpeningDebtService` qui saisit par montant cible sous verrou du client ; l'import réutilise le mécanisme existant (`ImportsService`) avec un type `OPENING_DEBTS`, exposé par des routes dédiées sous la permission `debts.opening`.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Zod 4, Next.js (App Router), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-soldes-ouverture-design.md`

## Global Constraints

- Montants : entiers en DA, `0 ≤ montant ≤ 1 000 000 000`.
- Permission : `debts.opening`, par défaut à `COMPANY_ADMIN` et `COMPTABLE`.
- Registre des dettes en ajout seul : une correction est une nouvelle écriture (BR-PAY-04).
- Solde figé dès qu'une écriture de dette d'un autre type que `OPENING_BALANCE` existe (BR-PAY-09).
- Textes de l'interface et messages en français, dans le style des écrans existants.
- `pnpm format:check` (sans `--end-of-line auto`), `pnpm lint` (aucun avertissement), `pnpm typecheck` verts.

## Review Focus

1. Vente à crédit synchronisée pendant la saisie d'un solde : le verrou du client doit sérialiser ; le solde ne doit jamais être modifié après une autre écriture (test : solde figé après une écriture `CREDIT_SALE`, Task 2).
2. Codes clients dont la casse diffère (`c-001` dans le fichier, `C-001` en base) : la ligne doit être reconnue (test Task 3).
3. Montant écrit avec espaces ou décimales (`12 000`, `12000,50`) : `12 000` accepté, `12000,50` refusé (test Task 3).
4. Client figé entre l'aperçu et la confirmation de l'import : la ligne passe en erreur, les autres sont importées (test Task 3).
5. Accès croisé : `/imports/:id` ne doit pas ouvrir un import de soldes, ni `/opening-debts/imports/:id` un import de clients (test Task 3).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/api/prisma/schema.prisma` | Valeurs d'enum `OPENING_BALANCE`, `OPENING_DEBTS` |
| `apps/api/prisma/migrations/20261015120000_soldes_ouverture/migration.sql` | Enums, permission, rôles existants |
| `packages/business-rules/src/permissions.ts` (+ test) | Permission et rôles par défaut |
| `packages/validation/src/customers.ts` | `openingDebtSchema`, `OpeningDebtState`, `ImportPreview.kind` |
| `packages/validation/src/audit.ts` | Actions `debt.opening`, `import.opening_debts` |
| `apps/api/src/customers/opening-debt.service.ts` | Saisie par montant cible, état, verrou, audit |
| `apps/api/src/customers/opening-debts.controller.ts` | Routes fiche client et import des soldes |
| `apps/api/src/imports/opening-debt-import.service.ts` | Vérification des lignes du fichier de soldes |
| `apps/api/src/imports/imports.service.ts` | Type `OPENING_DEBTS`, cloisonnement des types |
| `apps/api/src/imports/imports.controller.ts` | Restreint aux types clients et produits |
| `apps/api/src/customers/customers.module.ts` | Enregistrement |
| `apps/api/test/opening-debts.test.ts` | Tests d'intégration |
| `apps/web/src/components/import-panel.tsx` | Accepte le type `OPENING_DEBTS` |
| `apps/web/src/app/app/(espace)/soldes-ouverture/page.tsx` | Onglet Comptabilité |
| `apps/web/src/components/accounting-tabs.tsx`, `apps/web/src/lib/navigation.ts` | Onglet et menu |
| `apps/web/src/components/opening-debt.tsx` (+ test) | Ligne et formulaire de la fiche client |
| `apps/web/src/app/app/(espace)/clients/page.tsx` | Utilise le composant |
| Docs | BR-PAY-09, rbac, api, audit, database, deployment, plan |

---

### Task 1: Données, permission, contrats partagés

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enums `DebtEntryKind`, `ImportKind`)
- Create: `apps/api/prisma/migrations/20261015120000_soldes_ouverture/migration.sql`
- Modify: `packages/business-rules/src/permissions.ts`, `packages/business-rules/src/permissions.test.ts`
- Modify: `packages/validation/src/customers.ts`, `packages/validation/src/audit.ts`

**Interfaces:**
- Produces: permission `debts.opening` ; `openingDebtSchema` (`{ amount: number }`) ; `interface OpeningDebtState { openingDebtAmount: number; openingDebtEditable: boolean; debtAmount: number }` ; `ImportPreview['kind']` inclut `'OPENING_DEBTS'` ; actions d'audit `debt.opening`, `import.opening_debts`.

- [ ] **Step 1: test des rôles par défaut** — dans `permissions.test.ts`, bloc « matrice des permissions » :

```ts
  it('donne les soldes d’ouverture à l’admin et au comptable seulement (BR-PAY-09)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.COMPANY_ADMIN).toContain('debts.opening');
    expect(DEFAULT_ROLE_PERMISSIONS.COMPTABLE).toContain('debts.opening');
    for (const role of ['SUPERVISEUR', 'PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('debts.opening');
  });
```

- [ ] **Step 2:** `pnpm --filter @sellwasl/business-rules test` → FAIL.
- [ ] **Step 3: catalogue** — après `settlements.create` : `company('debts.opening', "Inscrire les soldes d'ouverture des dettes"),` ; ajouter `'debts.opening'` à `COMPANY_ADMIN` (après `settlements.create`) et à `COMPTABLE` (après `settlements.create`).
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: Prisma** — `DebtEntryKind` : ajouter `OPENING_BALANCE` ; `ImportKind` : ajouter `OPENING_DEBTS`. Migration :

```sql
-- Soldes d'ouverture des dettes (BR-PAY-09)
ALTER TYPE "DebtEntryKind" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "ImportKind" ADD VALUE 'OPENING_DEBTS';

INSERT INTO "permission" ("code", "description", "scope") VALUES
  ('debts.opening', 'Inscrire les soldes d''ouverture des dettes', 'COMPANY')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_code")
SELECT r.id, 'debts.opening' FROM "role" r WHERE r.code IN ('COMPANY_ADMIN', 'COMPTABLE')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 6: validation** — dans `customers.ts` :

```ts
/** Solde d'ouverture d'un client, en DA (BR-PAY-09). */
export const openingDebtSchema = z.object({
  amount: z.number().int('Montant entier en DA').min(0).max(1_000_000_000),
});
export type OpeningDebtInput = z.input<typeof openingDebtSchema>;

export interface OpeningDebtState {
  openingDebtAmount: number;
  /** Faux dès que le client a une autre écriture de dette (BR-PAY-09). */
  openingDebtEditable: boolean;
  debtAmount: number;
}
```

`ImportPreview.kind` : `'CUSTOMERS' | 'PRODUCTS' | 'OPENING_DEBTS'`. Dans `audit.ts`, après `'import.products'` : `'import.opening_debts': "Import des soldes d'ouverture",` ; après `'payment.debt'` : `'debt.opening': "Solde d'ouverture inscrit",`.

- [ ] **Step 7:** `pnpm db:migrate` n'est pas lancé (il créerait une migration) : `pnpm --filter @sellwasl/api exec prisma migrate deploy && pnpm db:generate && pnpm build:packages && pnpm typecheck` → vert.
- [ ] **Step 8: Commit** `feat: type d'écriture et permission des soldes d'ouverture`.

---

### Task 2: Service et routes de la fiche client

**Files:**
- Create: `apps/api/src/customers/opening-debt.service.ts`, `apps/api/src/customers/opening-debts.controller.ts`
- Modify: `apps/api/src/customers/customers.module.ts`
- Test: `apps/api/test/opening-debts.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `OpeningDebtService.get(customerId): Promise<OpeningDebtState>` ; `update(actor, customerId, amount): Promise<OpeningDebtState>` ; `set(tx: Prisma.TransactionClient, actor: AuthUser, customerId: string, target: number): Promise<{ state: OpeningDebtState; changed: boolean; before: number }>` (sans audit) ; `editableByCustomer(customerIds: string[]): Promise<Map<string, { opening: number; editable: boolean }>>` (pour l'import) ; `FROZEN_MESSAGE`.

- [ ] **Step 1: tests** — `apps/api/test/opening-debts.test.ts` :

```ts
import type { OpeningDebtState } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Soldes d'ouverture des dettes (BR-PAY-09). */
describe('soldes d’ouverture', () => {
  let t: TestApp;
  let prisma: PrismaService;
  let admin: string;
  let compta: string;
  let sup: string;
  let companyId: string;
  let detailTypeId: string;

  async function newCustomer(code: string): Promise<string> {
    const r = await call<{ id: string }>(t.url, 'POST', '/customers', {
      token: admin,
      body: { code, name: `Client ${code}`, customerTypeId: detailTypeId },
    });
    expect(r.status).toBe(201);
    return r.body.id;
  }
  const setOpening = (token: string, id: string, amount: number) =>
    call<OpeningDebtState>(t.url, 'PUT', `/customers/${id}/opening-debt`, {
      token,
      body: { amount },
    });

  beforeAll(async () => {
    t = await startApp();
    prisma = t.app.get(PrismaService);
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    compta = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    companyId = company.id;
    detailTypeId = (
      await prisma.customerType.findFirstOrThrow({ where: { companyId, code: 'DETAIL' } })
    ).id;
  });
  afterAll(() => t.close());

  it('saisit, corrige, remet à zéro, sans écriture si le montant ne change pas', async () => {
    const id = await newCustomer('OUV-1');
    const first = await setOpening(compta, id, 12000);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ openingDebtAmount: 12000, openingDebtEditable: true, debtAmount: 12000 });
    expect((await setOpening(admin, id, 10000)).body.debtAmount).toBe(10000);
    expect((await setOpening(admin, id, 10000)).body.debtAmount).toBe(10000);
    const entries = await prisma.customerDebtEntry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => [e.kind, Number(e.amount)])).toEqual([
      ['OPENING_BALANCE', 12000],
      ['OPENING_BALANCE', -2000],
    ]);
    expect((await setOpening(admin, id, 0)).body).toMatchObject({ openingDebtAmount: 0, debtAmount: 0 });
    const audit = await prisma.auditLog.findMany({ where: { entityId: id, action: 'debt.opening' } });
    expect(audit).toHaveLength(3);
    const state = await call<OpeningDebtState>(t.url, 'GET', `/customers/${id}/opening-debt`, { token: compta });
    expect(state.body).toEqual({ openingDebtAmount: 0, openingDebtEditable: true, debtAmount: 0 });
  });

  it('fige le solde dès la première autre écriture de dette', async () => {
    const id = await newCustomer('OUV-2');
    await setOpening(admin, id, 5000);
    await prisma.customerDebtEntry.create({
      data: { id: uuidv7(), companyId, customerId: id, kind: 'CREDIT_SALE', amount: 3000n, occurredAt: new Date() },
    });
    await prisma.customer.update({ where: { id }, data: { debtAmount: { increment: 3000n } } });
    const refused = await setOpening(admin, id, 6000);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.message).toContain('Solde figé');
    const state = await call<OpeningDebtState>(t.url, 'GET', `/customers/${id}/opening-debt`, { token: admin });
    expect(state.body).toEqual({ openingDebtAmount: 5000, openingDebtEditable: false, debtAmount: 8000 });
  });

  it('refuse sans le droit, un montant invalide, un client d’une autre entreprise', async () => {
    const id = await newCustomer('OUV-3');
    expect((await setOpening(sup, id, 1000)).status).toBe(403);
    expect((await setOpening(admin, id, -1)).status).toBe(400);
    expect((await setOpening(admin, id, 10.5)).status).toBe(400);
    const other = await prisma.customer.findFirstOrThrow({
      where: { company: { code: 'CASHVAN-EST' } },
    });
    expect((await setOpening(admin, other.id, 1000)).status).toBe(404);
  });
});
```

(Vérifier le nom du modèle d'audit dans `schema.prisma` — `AuditLog` — et adapter `prisma.auditLog` si besoin. Vérifier le statut des erreurs de validation Zod dans `ZodValidationPipe` : 400 attendu.)

- [ ] **Step 2:** `pnpm --filter @sellwasl/api test -- opening-debts` → FAIL (route absente).
- [ ] **Step 3: service** — `opening-debt.service.ts` :

```ts
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OpeningDebtState } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

export const FROZEN_MESSAGE =
  'Solde figé : le client a déjà des opérations de dette dans SellWasl.';

/** Solde d'ouverture des dettes (BR-PAY-09) : saisie par montant cible, en ajout seul. */
@Injectable()
export class OpeningDebtService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /** Solde d'ouverture et possibilité de le modifier, pour chaque client demandé. */
  async editableByCustomer(
    customerIds: string[],
    client: Pick<Tx, 'customerDebtEntry'> = this.db as unknown as Tx,
  ): Promise<Map<string, { opening: number; editable: boolean }>> {
    const groups = await client.customerDebtEntry.groupBy({
      by: ['customerId', 'kind'],
      where: { customerId: { in: customerIds } },
      _sum: { amount: true },
    });
    const result = new Map(customerIds.map((id) => [id, { opening: 0, editable: true }]));
    for (const g of groups) {
      const state = result.get(g.customerId)!;
      if (g.kind === 'OPENING_BALANCE') state.opening = Number(g._sum.amount ?? 0n);
      else state.editable = false;
    }
    return result;
  }

  async get(customerId: string): Promise<OpeningDebtState> {
    const customer = await this.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw notFound('Client introuvable.');
    const state = (await this.editableByCustomer([customerId])).get(customerId)!;
    return {
      openingDebtAmount: state.opening,
      openingDebtEditable: state.editable,
      debtAmount: Number(customer.debtAmount),
    };
  }

  /** Inscrit le solde `target` dans `tx`, sans audit (l'appelant audite). */
  async set(tx: Tx, actor: AuthUser, customerId: string, target: number) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw notFound('Client introuvable.');
    // Une vente à crédit synchronisée en même temps attend la fin de cette transaction
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${customerId}::uuid FOR UPDATE`;
    const state = (await this.editableByCustomer([customerId], tx)).get(customerId)!;
    if (!state.editable)
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', FROZEN_MESSAGE, {
        rule: 'BR-PAY-09',
      });
    const delta = target - state.opening;
    let debt = customer.debtAmount;
    if (delta !== 0) {
      await tx.customerDebtEntry.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          customerId,
          kind: 'OPENING_BALANCE',
          amount: BigInt(delta),
          occurredAt: new Date(),
        },
      });
      debt = (
        await tx.customer.update({
          where: { id: customerId },
          data: { debtAmount: { increment: BigInt(delta) }, version: { increment: 1 } },
        })
      ).debtAmount;
    }
    return {
      before: state.opening,
      changed: delta !== 0,
      state: { openingDebtAmount: target, openingDebtEditable: true, debtAmount: Number(debt) },
    };
  }

  /** Saisie sur la fiche client, auditée. */
  async update(actor: AuthUser, customerId: string, amount: number): Promise<OpeningDebtState> {
    return this.db.$transaction(async (tx) => {
      const result = await this.set(tx as unknown as Tx, actor, customerId, amount);
      if (result.changed) {
        await this.audit.write(
          {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: 'debt.opening',
            entity: 'Customer',
            entityId: customerId,
            before: { openingDebtAmount: result.before },
            after: { openingDebtAmount: amount },
          },
          tx,
        );
      }
      return result.state;
    });
  }
}
```

Le test « sans écriture si le montant ne change pas » attend 3 lignes d'audit (12 000, 10 000, 0) : l'appel identique n'en écrit pas. Vérifier que `AuditService.write` accepte `before` (sinon passer `after: { before, openingDebtAmount }`).

- [ ] **Step 4: contrôleur** — `opening-debts.controller.ts` (routes fiche ; l'import vient en Task 3) :

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { openingDebtSchema, type OpeningDebtState } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OpeningDebtService } from './opening-debt.service';

/** Soldes d'ouverture des dettes (BR-PAY-09, docs/api.md). */
@Controller()
export class OpeningDebtsController {
  constructor(private readonly openingDebts: OpeningDebtService) {}

  @RequirePermission('debts.opening')
  @Get('customers/:id/opening-debt')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OpeningDebtState> {
    return this.openingDebts.get(id);
  }

  @RequirePermission('debts.opening')
  @Put('customers/:id/opening-debt')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(openingDebtSchema)) body: z.output<typeof openingDebtSchema>,
  ): Promise<OpeningDebtState> {
    return this.openingDebts.update(user, id, body.amount);
  }
}
```

Module : ajouter `OpeningDebtsController` aux contrôleurs, `OpeningDebtService` aux fournisseurs.

- [ ] **Step 5:** test → PASS ; `pnpm --filter @sellwasl/api test -- routes rbac-matrix` → PASS.
- [ ] **Step 6: Commit** `feat(api): solde d'ouverture sur la fiche client`.

---

### Task 3: Import des soldes

**Files:**
- Create: `apps/api/src/imports/opening-debt-import.service.ts`
- Modify: `apps/api/src/imports/imports.service.ts`, `apps/api/src/imports/imports.controller.ts`, `apps/api/src/customers/opening-debts.controller.ts`, `apps/api/src/customers/customers.module.ts`
- Test: `apps/api/test/opening-debts.test.ts`

**Interfaces:**
- Consumes: `OpeningDebtService.editableByCustomer`, `set`, `FROZEN_MESSAGE` (Task 2).
- Produces: `OPENING_DEBT_TEMPLATE` ; `ImportsService.get(id, kinds)`, `confirm(actor, id, kinds)` avec `kinds: readonly ImportKindValue[]` ; `ImportKindValue = 'CUSTOMERS' | 'PRODUCTS' | 'OPENING_DEBTS'`.

- [ ] **Step 1: tests** — ajouter au fichier :

```ts
  async function uploadOpening(token: string, csv: string) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'soldes.csv');
    const r = await fetch(`${t.url}/opening-debts/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: r.status, body: (await r.json()) as ImportPreview };
  }

  it('importe les soldes : aperçu, erreurs, revérification, audit unique', async () => {
    const a = await newCustomer('IMPO-A');
    const b = await newCustomer('IMPO-B');
    await newCustomer('IMPO-C');
    const template = await fetch(`${t.url}/opening-debts/template`, {
      headers: { Authorization: `Bearer ${compta}` },
    });
    expect(await template.text()).toContain('code;nom;dette');

    const csv = [
      'code;nom;dette',
      'impo-a;Client A;12 000',
      'IMPO-B;;3500',
      'IMPO-C;;12000,50',
      'INCONNU;;100',
      'IMPO-A;;1',
    ].join('\r\n');
    const { status, body: preview } = await uploadOpening(compta, csv);
    expect(status).toBe(201);
    expect(preview).toMatchObject({ kind: 'OPENING_DEBTS', totalRows: 5, validRows: 2 });
    expect(preview.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(preview.columns).toEqual(['Code', 'Client', 'Solde actuel', 'Nouveau solde']);
    expect(preview.sample[0]!.values).toEqual(['IMPO-A', 'Client IMPO-A', '0 DA', '12 000 DA']);

    // B est figé entre l'aperçu et la confirmation
    await prisma.customerDebtEntry.create({
      data: { id: uuidv7(), companyId, customerId: b, kind: 'CREDIT_SALE', amount: 100n, occurredAt: new Date() },
    });
    const confirmed = await call<ImportPreview>(t.url, 'POST', `/opening-debts/imports/${preview.id}/confirm`, { token: compta });
    expect(confirmed.body).toMatchObject({ status: 'IMPORTED', importedRows: 1 });
    expect(confirmed.body.errors.some((e) => e.message.includes('figé'))).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a } })).debtAmount).toBe(12000n);
    const audit = await prisma.auditLog.findMany({ where: { entityId: preview.id } });
    expect(audit.map((x) => x.action)).toEqual(['import.opening_debts']);
  });

  it('cloisonne les imports : soldes et clients ne se croisent pas', async () => {
    const { body: opening } = await uploadOpening(admin, 'code;dette\r\nIMPO-A;5\r\n');
    expect((await call(t.url, 'GET', `/imports/${opening.id}`, { token: admin })).status).toBe(404);
    expect((await call(t.url, 'POST', `/imports/${opening.id}/confirm`, { token: admin })).status).toBe(404);
    expect((await uploadOpening(sup, 'code;dette\r\n')).status).toBe(403);
    const form = new FormData();
    form.append('kind', 'OPENING_DEBTS');
    form.append('file', new Blob(['code;dette\r\n'], { type: 'text/csv' }), 'x.csv');
    const viaImports = await fetch(`${t.url}/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    });
    expect(viaImports.status).toBe(400);
    expect((await call(t.url, 'GET', `/opening-debts/imports/${opening.id}`, { token: compta })).status).toBe(200);
  });
```

(Importer `ImportPreview` depuis `@sellwasl/validation`. Le format `12 000 DA` vient de `formatDA` côté serveur : utiliser `Intl.NumberFormat('fr-FR')` avec espace insécable fine — comparer par `toMatch(/^12\s000 DA$/)` si l'espace diffère.)

- [ ] **Step 2:** test → FAIL.
- [ ] **Step 3: vérification des lignes** — `opening-debt-import.service.ts` :

```ts
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { FROZEN_MESSAGE, OpeningDebtService } from '../customers/opening-debt.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { decodeCsv, parseCsv } from './csv';
import { type CheckedImport, type ImportError, MAX_ROWS, SAMPLE_SIZE } from './import-types';

export const OPENING_DEBT_TEMPLATE =
  '﻿' + ['code;nom;dette', 'C-001;Alimentation Benali;12000', 'C-002;Supérette El Bahia;0'].join('\r\n') + '\r\n';

const MAX_AMOUNT = 1_000_000_000;
const da = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} DA`;

/** Import CSV des soldes d'ouverture (BR-PAY-09) : une ligne par client, repéré par son code. */
@Injectable()
export class OpeningDebtImportService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly openingDebts: OpeningDebtService,
  ) {}

  async check(content: Buffer): Promise<CheckedImport> {
    const { headers, rows } = parseCsv(decodeCsv(content));
    const missing = ['code', 'dette'].filter((c) => !headers.includes(c));
    if (missing.length > 0)
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'IMPORT_INVALID',
        `Colonnes obligatoires absentes : ${missing.join(', ')}. Partez du modèle de fichier.`);
    if (rows.length > MAX_ROWS)
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'IMPORT_INVALID', `Le fichier dépasse ${MAX_ROWS} lignes.`);

    const customers = await this.db.customer.findMany({
      where: { deletedAt: null, code: { not: null } },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map(customers.map((c) => [c.code!.toLowerCase(), c]));
    const states = await this.openingDebts.editableByCustomer(customers.map((c) => c.id));

    const errors: ImportError[] = [];
    const valid: { line: number; customerId: string; code: string; name: string; before: number; amount: number }[] = [];
    const seen = new Set<string>();
    for (const { line, values: v } of rows) {
      const code = (v.code ?? '').trim();
      const customer = byCode.get(code.toLowerCase());
      const amount = Number((v.dette ?? '').replace(/\s/g, ''));
      const problems: string[] = [];
      if (!code) problems.push('code manquant');
      else if (!customer) problems.push(`client ${code} inconnu`);
      else if (seen.has(customer.id)) problems.push(`client ${code} présent deux fois`);
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT || !(v.dette ?? '').trim())
        problems.push('dette invalide (montant entier en DA)');
      if (customer && problems.length === 0 && !states.get(customer.id)!.editable)
        problems.push(FROZEN_MESSAGE);
      if (customer) seen.add(customer.id);
      if (problems.length > 0 || !customer) {
        errors.push({ line, message: problems.join(' ; ') });
        continue;
      }
      valid.push({ line, customerId: customer.id, code: customer.code!, name: customer.name,
        before: states.get(customer.id)!.opening, amount });
    }

    return {
      totalRows: rows.length,
      validRows: valid.length,
      errors,
      columns: ['Code', 'Client', 'Solde actuel', 'Nouveau solde'],
      sample: valid.slice(0, SAMPLE_SIZE).map((r) => ({
        line: r.line,
        values: [r.code, r.name, da(r.before), da(r.amount)],
      })),
      apply: async (tx, actor) => {
        let changed = 0;
        for (const r of valid) {
          if ((await this.openingDebts.set(tx, actor, r.customerId, r.amount)).changed) changed += 1;
        }
        return changed;
      },
    };
  }
}
```

Le « figé » à la confirmation : `check` est relancé par `confirm` (les états sont relus), donc la ligne B passe en erreur avant `apply`. `set` refuse encore si une écriture arrive entre la vérification et le verrou (l'import échoue alors en entier : message clair, l'utilisateur relance).

- [ ] **Step 4: `ImportsService`** :
  - `export type ImportKindValue = 'CUSTOMERS' | 'PRODUCTS' | 'OPENING_DEBTS';`
  - constructeur : `private readonly openingDebts: OpeningDebtImportService` ;
  - `checkFile` : `if (kind === 'OPENING_DEBTS') return this.openingDebts.check(content);` ;
  - `findJob(id, kinds: readonly ImportKindValue[])` : `where: { id, kind: { in: [...kinds] } }` ;
  - `get(id, kinds)` et `confirm(actor, id, kinds)` passent `kinds` ;
  - action d'audit : `{ CUSTOMERS: 'import.customers', PRODUCTS: 'import.products', OPENING_DEBTS: 'import.opening_debts' }[job.kind]`.
- [ ] **Step 5: `ImportsController`** — `const CATALOG_IMPORTS = ['CUSTOMERS', 'PRODUCTS'] as const;` ; `get` → `this.imports.get(id, CATALOG_IMPORTS)` ; `confirm` → `this.imports.confirm(user, id, CATALOG_IMPORTS)` (le schéma `kind` reste `CUSTOMERS | PRODUCTS` : `OPENING_DEBTS` donne 400).
- [ ] **Step 6: routes d'import** dans `OpeningDebtsController` (injecter `ImportsService`) :

```ts
  @RequirePermission('debts.opening')
  @Get('opening-debts/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modele-soldes.csv"')
  template(): string {
    return OPENING_DEBT_TEMPLATE;
  }

  @RequirePermission('debts.opening')
  @Post('opening-debts/imports')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedCsv | undefined): Promise<ImportPreview> {
    return this.imports.preview(user, 'OPENING_DEBTS', file);
  }

  @RequirePermission('debts.opening')
  @Get('opening-debts/imports/:id')
  getImport(@Param('id', ParseUUIDPipe) id: string): Promise<ImportPreview> {
    return this.imports.get(id, ['OPENING_DEBTS']);
  }

  @RequirePermission('debts.opening')
  @Post('opening-debts/imports/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ImportPreview> {
    return this.imports.confirm(user, id, ['OPENING_DEBTS']);
  }
```

Module : ajouter `OpeningDebtImportService` aux fournisseurs.

- [ ] **Step 7:** `pnpm --filter @sellwasl/api test -- opening-debts customers routes rbac-matrix api-contract` → PASS.
- [ ] **Step 8: Commit** `feat(api): import des soldes d'ouverture`.

---

### Task 4: Écrans Web

**Files:**
- Modify: `apps/web/src/components/import-panel.tsx`, `apps/web/src/components/accounting-tabs.tsx`, `apps/web/src/lib/navigation.ts`, `apps/web/src/app/app/(espace)/clients/page.tsx`
- Create: `apps/web/src/app/app/(espace)/soldes-ouverture/page.tsx`, `apps/web/src/components/opening-debt.tsx`, `apps/web/src/components/opening-debt.test.tsx`

**Interfaces:**
- Consumes: routes des Tasks 2 et 3, `OpeningDebtState`.
- Produces: `<OpeningDebt customerId onSaved />`.

- [ ] **Step 1: test du composant** — `opening-debt.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { OpeningDebt } from './opening-debt';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

describe('OpeningDebt', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('modifiable : saisit le montant et prévient la fiche', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ openingDebtAmount: 0, openingDebtEditable: true, debtAmount: 0 })
      .mockResolvedValueOnce({ openingDebtAmount: 12000, openingDebtEditable: true, debtAmount: 12000 });
    const onSaved = vi.fn();
    render(<OpeningDebt customerId="c1" onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    await userEvent.type(screen.getByLabelText('Solde d’ouverture (DA)'), '12000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(api).toHaveBeenLastCalledWith('company', '/customers/c1/opening-debt', {
      method: 'PUT',
      body: JSON.stringify({ amount: 12000 }),
    });
    expect(onSaved).toHaveBeenCalledWith(12000);
  });

  it('figé : pas de bouton, mention du gel', async () => {
    vi.mocked(api).mockResolvedValueOnce({ openingDebtAmount: 5000, openingDebtEditable: false, debtAmount: 8000 });
    render(<OpeningDebt customerId="c1" onSaved={vi.fn()} />);
    expect(await screen.findByText(/figé/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
  });
});
```

- [ ] **Step 2:** `pnpm --filter @sellwasl/web test -- opening-debt` → FAIL.
- [ ] **Step 3: composant** — `opening-debt.tsx` :

```tsx
'use client';

import type { OpeningDebtState } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA } from '@/lib/labels';

/** Solde d'ouverture de la fiche client (BR-PAY-09), pour qui a `debts.opening`. */
export function OpeningDebt({
  customerId,
  onSaved,
}: {
  customerId: string;
  /** Nouvelle dette du client, pour mettre la fiche à jour. */
  onSaved: (debtAmount: number) => void;
}) {
  const [state, setState] = useState<OpeningDebtState | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<OpeningDebtState>('company', `/customers/${customerId}/opening-debt`)
      .then(setState)
      .catch((err) => setError(errorMessage(err)));
  }, [customerId]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const next = await api<OpeningDebtState>('company', `/customers/${customerId}/opening-debt`, {
        method: 'PUT',
        body: JSON.stringify({ amount: Number(amount.replace(/\s/g, '')) }),
      });
      setState(next);
      setEditing(false);
      onSaved(next.debtAmount);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return error ? <Alert>{error}</Alert> : null;
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted">Solde d’ouverture : </span>
          <span className="text-text-dark">{formatDA(state.openingDebtAmount)}</span>
          {!state.openingDebtEditable && (
            <span className="text-muted"> · figé, le client a des opérations de dette</span>
          )}
        </p>
        {state.openingDebtEditable && !editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setAmount(String(state.openingDebtAmount));
              setEditing(true);
            }}
          >
            Modifier
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {editing && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field
            label="Solde d’ouverture (DA)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint="Dette du client dans l’ancien système, le jour du passage à SellWasl."
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
```

Dans le test, le champ part vide : `setAmount(String(0))` met « 0 » ; utiliser `userEvent.clear` avant `type` dans le test (`await userEvent.clear(screen.getByLabelText(...))`).

- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: fiche client** — dans `CustomerDetail`, après le `<dl>` : `{can('debts.opening') && <OpeningDebt customerId={c.id} onSaved={(debtAmount) => onChanged({ ...c, debtAmount })} />}`.
- [ ] **Step 6: import** — `ImportPanel` : `kind: 'CUSTOMERS' | 'PRODUCTS' | 'OPENING_DEBTS'` ; chemins :

```ts
const PATHS = {
  CUSTOMERS: { base: '/imports', template: '/imports/templates/customers' },
  PRODUCTS: { base: '/imports', template: '/imports/templates/products' },
  OPENING_DEBTS: { base: '/opening-debts/imports', template: '/opening-debts/template' },
} as const;
```

`upload` : `form.append('kind', kind)` seulement si `PATHS[kind].base === '/imports'` ; POST sur `PATHS[kind].base` ; confirmation sur `${PATHS[kind].base}/${preview.id}/confirm` ; modèle sur `/api/v1${PATHS[kind].template}`.

Page `soldes-ouverture/page.tsx` :

```tsx
'use client';

import { AccountingTabs } from '@/components/accounting-tabs';
import { ImportPanel } from '@/components/import-panel';

const Col = ({ children }: { children: string }) => <span className="font-mono">{children}</span>;

/** Soldes d'ouverture des dettes, le soir de la bascule (BR-PAY-09). */
export default function OpeningDebtsPage() {
  return (
    <div className="flex flex-col gap-4">
      <AccountingTabs />
      <ImportPanel
        kind="OPENING_DEBTS"
        title="Soldes d'ouverture"
        backHref="/app/paiements"
        backLabel="Dettes et paiements"
        templateName="modele-soldes.csv"
        unit="solde(s)"
        help={
          <p>
            Dette de chaque client dans l'ancien système, à importer le soir du passage à SellWasl.
            Colonnes : <Col>code</Col> (code du client) et <Col>dette</Col> (DA, entier),{' '}
            <Col>nom</Col> facultatif. Un solde reste modifiable tant que le client n'a ni vente à
            crédit ni encaissement ; les clients absents du fichier ne changent pas.
          </p>
        }
      />
    </div>
  );
}
```

`AccountingTabs` : après « Dettes et paiements », `{ href: '/app/soldes-ouverture', label: "Soldes d'ouverture", permission: 'debts.opening' }`. `navigation.ts` : ajouter `'/app/soldes-ouverture'` à `also` de « Comptabilité ».

- [ ] **Step 7:** `pnpm --filter @sellwasl/web test && pnpm --filter @sellwasl/web typecheck && pnpm --filter @sellwasl/web lint` → vert.
- [ ] **Step 8: Commit** `feat(web): soldes d'ouverture sur la fiche client et dans la comptabilité`.

---

### Task 5: Documentation

**Files:** `docs/business-rules.md`, `docs/rbac.md`, `docs/api.md`, `docs/audit.md`, `docs/database.md`, `docs/deployment.md`, `plan_VF.md`, spec.

- [ ] **Step 1:** `business-rules.md` : BR-PAY-09 (texte du §3 de la spec) après BR-PAY-08 ; BR-PAY-04 : formule avec le solde d'ouverture.
- [ ] **Step 2:** `rbac.md` : ligne de catalogue `debts.opening` (Argent) et ligne de matrice `| \`debts.opening\` | ✓ | — | ✓ | — | — | — | — |`.
- [ ] **Step 3:** `api.md` : les six routes ; `audit.md` : `debt.opening`, `import.opening_debts` ; `database.md` : `OPENING_BALANCE` dans `CustomerDebtEntry.kind`, `OPENING_DEBTS` dans `ImportKind`.
- [ ] **Step 4:** `deployment.md` §8 : point 5 « Le soir de la bascule : inventaire du dépôt, puis Comptabilité → Soldes d'ouverture (import ou fiche client), avant la première journée. »
- [ ] **Step 5:** `plan_VF.md` : tâche cochée « Soldes d'ouverture des dettes (BR-PAY-09) » dans la phase 30 ; tâches « (après le MVP) » : import Excel, correspondance des colonnes, pack de migration, import KML des secteurs.
- [ ] **Step 6:** spec : `GET /customers/:id/opening-debt` remplace les deux champs du détail ; rôles par défaut dans `packages/business-rules/src/permissions.ts`.
- [ ] **Step 7:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` → vert.
- [ ] **Step 8: Commit** `docs: soldes d'ouverture des dettes (BR-PAY-09)`.
