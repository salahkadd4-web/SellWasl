import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type createLoadSchema,
  type LoadDto,
  type planLoadSchema,
  type validateLoadSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, invalidState, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import {
  activeWarehouse,
  articleName,
  articleOf,
  fullName,
  toBaseLines,
  warehouseRef,
} from './stock-helpers';
import { type Move, StockLedger } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

const DETAIL = {
  truck: true,
  user: true,
  loadLines: { include: { productVariant: { include: { product: true } } } },
} as const;

/**
 * Chargement d'un camion (UC-42) : transfert du dépôt vers le camion, pris sur le disponible
 * seulement — le stock réservé par les commandes reste au dépôt jusqu'à la préparation (phase 18).
 */
@Injectable()
export class LoadsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthUser, input: z.output<typeof createLoadSchema>): Promise<LoadDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const truck = await activeWarehouse(tx, input.truckId, 'TRUCK');
      if (!truck.assignedUserId)
        throw rule("Ce camion n'a pas de conducteur : affectez-le dans les paramètres.");
      const driver = await tx.user.findFirstOrThrow({
        where: { id: truck.assignedUserId },
        include: { role: true },
      });
      const depot = input.fromWarehouseId
        ? await activeWarehouse(tx, input.fromWarehouseId, 'DEPOT')
        : await this.ledger.mainDepot(tx);
      const kind = await this.kind(tx, truck.id, input.date, driver.role.code);
      const lines = await toBaseLines(tx, input.lines);
      const balances = await this.ledger.balances(
        tx,
        actor.companyId,
        depot.id,
        lines.map((l) => l.variantId),
        [truck.id],
      );
      for (const l of lines) {
        const b = balances.get(l.variantId)!;
        if (l.qty > b.physical - b.reserved)
          throw rule(
            `Stock disponible insuffisant au dépôt : ${l.article} (disponible ${b.physical - b.reserved}).`,
            { variantId: l.variantId, available: b.physical - b.reserved },
          );
      }
      const now = new Date();
      await tx.load.create({
        data: {
          id,
          companyId: actor.companyId,
          kind,
          date: toDate(input.date),
          status: 'LOADED',
          loadedByUserId: actor.userId,
          loadedAt: now,
          occurredAt: now,
          truckId: truck.id,
          userId: driver.id,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          loadLines: {
            create: lines.map((l) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              productVariantId: l.variantId,
              plannedQty: l.qty,
              loadedQty: l.qty,
            })),
          },
        },
      });
      await this.ledger.apply(
        tx,
        actor,
        lines.map((l) => ({
          type: 'TRANSFER' as const,
          variantId: l.variantId,
          qty: l.qty,
          fromWarehouseId: depot.id,
          toWarehouseId: truck.id,
          source: { type: 'LOAD' as const, id },
        })),
        now,
      );
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'load.validate',
          entity: 'Load',
          entityId: id,
          after: { truckId: truck.id, kind, lines: lines.map((l) => [l.variantId, l.qty]) },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Type du chargement : cash van le matin, rechargement ensuite si P-07 le permet (BR-CV-01) ;
   * tournée pour un livreur.
   */
  private async kind(tx: Tx, truckId: string, date: string, roleCode: string) {
    if (roleCode !== 'VENDEUR_CASH_VAN') return 'ROUTE' as const;
    const earlier = await tx.load.findFirst({
      where: { truckId, date: toDate(date), deletedAt: null },
    });
    if (!earlier) return 'CASH_VAN' as const;
    const row = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
    if (!companySettingsSchema.parse(row?.data ?? {}).rules.P07_multipleCashVanLoads)
      throw rule('Un seul chargement par jour pour le cash van (paramètre P-07).');
    return 'RELOAD' as const;
  }

  /**
   * Chargement cash van préparé sur le Web (UC-62, BR-CV-01) : quantités prévues, sans mouvement
   * de stock ; le magasinier le valide ensuite avec les quantités réellement chargées.
   */
  async plan(actor: AuthUser, input: z.output<typeof planLoadSchema>): Promise<LoadDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const truck = await activeWarehouse(tx, input.truckId, 'TRUCK');
      if (!truck.assignedUserId)
        throw rule("Ce camion n'a pas de conducteur : affectez-le dans les paramètres.");
      const driver = await tx.user.findFirstOrThrow({
        where: { id: truck.assignedUserId },
        include: { role: true },
      });
      const kind = await this.kind(tx, truck.id, input.date, driver.role.code);
      const lines = await toBaseLines(tx, input.lines);
      await tx.load.create({
        data: {
          id,
          companyId: actor.companyId,
          kind,
          date: toDate(input.date),
          status: 'PLANNED',
          plannedByUserId: actor.userId,
          truckId: truck.id,
          userId: driver.id,
          createdByUserId: actor.userId,
          loadLines: {
            create: lines.map((l) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              productVariantId: l.variantId,
              plannedQty: l.qty,
            })),
          },
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'load.plan',
          entity: 'Load',
          entityId: id,
          after: { truckId: truck.id, kind, lines: lines.map((l) => [l.variantId, l.qty]) },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Validation d'un chargement préparé : transfert du réellement chargé vers le camion. */
  async validate(
    actor: AuthUser,
    id: string,
    input: z.output<typeof validateLoadSchema>,
  ): Promise<LoadDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.$queryRaw`SELECT id FROM "load" WHERE id = ${id}::uuid FOR UPDATE`;
      const load = await tx.load.findFirst({
        where: { id, deletedAt: null },
        include: { loadLines: { include: { productVariant: { include: { product: true } } } } },
      });
      if (!load) throw notFound('Chargement introuvable.');
      if (load.status !== 'PLANNED') throw invalidState('Ce chargement est déjà validé.');
      const loaded = new Map(input.lines.map((l) => [l.variantId, l.loadedQty]));
      if (input.lines.some((l) => !load.loadLines.some((x) => x.productVariantId === l.variantId)))
        throw rule('Un article ne fait pas partie de ce chargement.');
      const truck = await activeWarehouse(tx, load.truckId, 'TRUCK');
      const depot = await this.ledger.mainDepot(tx);
      const balances = await this.ledger.balances(
        tx,
        actor.companyId,
        depot.id,
        load.loadLines.map((l) => l.productVariantId),
        [truck.id],
      );
      const moves: Move[] = [];
      for (const line of load.loadLines) {
        const qty = loaded.get(line.productVariantId) ?? line.plannedQty;
        const b = balances.get(line.productVariantId)!;
        if (qty > b.physical - b.reserved)
          throw rule(
            `Stock disponible insuffisant au dépôt : ${articleName(line.productVariant)} (disponible ${b.physical - b.reserved}).`,
          );
        if (qty > 0)
          moves.push({
            type: 'TRANSFER',
            variantId: line.productVariantId,
            qty,
            fromWarehouseId: depot.id,
            toWarehouseId: truck.id,
            source: { type: 'LOAD', id },
          });
        await tx.loadLine.update({
          where: { id: line.id },
          data: { loadedQty: qty, version: { increment: 1 } },
        });
      }
      const now = new Date();
      await this.ledger.apply(tx, actor, moves, now);
      await tx.load.update({
        where: { id },
        data: {
          status: 'LOADED',
          loadedByUserId: actor.userId,
          loadedAt: now,
          occurredAt: now,
          version: { increment: 1 },
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'load.validate',
          entity: 'Load',
          entityId: id,
          after: { lines: moves.map((m) => [m.variantId, m.qty]) },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Chargements préparés, à valider par le magasinier. */
  async planned(): Promise<LoadDto[]> {
    const rows = await this.db.load.findMany({
      where: { status: 'PLANNED', deletedAt: null },
      include: DETAIL,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** Dernier chargement d'un camion. */
  async last(truckId: string): Promise<LoadDto | null> {
    const row = await this.db.load.findFirst({
      where: { truckId, deletedAt: null },
      include: DETAIL,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return row ? toDto(row) : null;
  }

  async list(date?: string): Promise<LoadDto[]> {
    const day = date ?? localDate(new Date(), (await this.db.company.findFirstOrThrow()).timezone);
    const rows = await this.db.load.findMany({
      where: { date: toDate(day), deletedAt: null },
      include: DETAIL,
      orderBy: { loadedAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<LoadDto> {
    const row = await this.db.load.findFirst({ where: { id, deletedAt: null }, include: DETAIL });
    if (!row) throw notFound('Chargement introuvable.');
    return toDto(row);
  }
}

function toDto(row: Prisma.LoadGetPayload<{ include: typeof DETAIL }>): LoadDto {
  return {
    id: row.id,
    kind: row.kind,
    date: dateOnly(row.date),
    status: row.status,
    truck: warehouseRef(row.truck),
    user: { id: row.user.id, code: row.user.code, name: fullName(row.user) },
    loadedAt: row.loadedAt?.toISOString() ?? null,
    lines: row.loadLines.map((l) => ({
      variantId: l.productVariantId,
      ...articleOf(l.productVariant),
      qty: l.loadedQty ?? l.plannedQty,
    })),
  };
}
