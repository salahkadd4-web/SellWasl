import { Inject, Injectable } from '@nestjs/common';
import { localDate, unloadLine } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type createUnloadSchema,
  type PendingUnloadDto,
  type UnloadDto,
  type UnloadPreviewLine,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { articleOf, fullName, localRange, warehouseRef } from './stock-helpers';
import { type Move, StockLedger } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

const DETAIL = {
  truck: true,
  user: true,
  unloadLines: { include: { productVariant: { include: { product: true } } } },
} as const;

/**
 * Déchargement d'un camion après la clôture de la journée de son conducteur (UC-43, BR-STK-07) :
 * comptage, écart signé avec motif, retour du compté au dépôt ou stock gardé selon P-06.
 */
@Injectable()
export class UnloadsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
  ) {}

  /** Journées clôturées d'un conducteur de camion, pas encore déchargées. */
  async pending(): Promise<PendingUnloadDto[]> {
    const trucks = await this.db.warehouse.findMany({
      where: { type: 'TRUCK', isActive: true, deletedAt: null, assignedUserId: { not: null } },
    });
    const workdays = await this.db.workday.findMany({
      where: {
        status: 'CLOSED',
        deletedAt: null,
        unload: null,
        userId: { in: trucks.map((t) => t.assignedUserId!) },
      },
      include: { user: true },
      orderBy: { date: 'desc' },
      take: 100,
    });
    const result: PendingUnloadDto[] = [];
    for (const w of workdays) {
      const truck = trucks.find((t) => t.assignedUserId === w.userId)!;
      const hasStock = await this.db.stock.findFirst({
        where: { warehouseId: truck.id, physicalQty: { gt: 0 } },
      });
      const loaded = await this.db.load.findFirst({
        where: { truckId: truck.id, date: w.date, deletedAt: null },
      });
      if (!hasStock && !loaded) continue;
      result.push({
        workdayId: w.id,
        date: dateOnly(w.date),
        truck: warehouseRef(truck),
        user: { id: w.user.id, code: w.user.code, name: fullName(w.user) },
      });
    }
    return result;
  }

  async preview(workdayId: string): Promise<UnloadPreviewLine[]> {
    const tx = this.db as unknown as Tx;
    const { truck, workday } = await this.context(tx, workdayId);
    return this.lines(tx, truck.id, workday.date);
  }

  async validate(actor: AuthUser, input: z.output<typeof createUnloadSchema>): Promise<UnloadDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const { truck, workday } = await this.context(tx, input.workdayId);
      if (await tx.unload.findFirst({ where: { workdayId: workday.id } }))
        throw rule('Ce camion est déjà déchargé pour cette journée.');
      const expected = await this.lines(tx, truck.id, workday.date);
      const counted = new Map(input.lines.map((l) => [l.variantId, l]));
      if (expected.some((l) => !counted.has(l.variantId)))
        throw rule('Comptez chaque article du camion : il en manque.');
      const variantIds = [...new Set([...expected.map((l) => l.variantId), ...counted.keys()])];
      // Le théorique est relu sous verrou : rien ne bouge pendant la validation
      const balances = await this.ledger.balances(tx, actor.companyId, truck.id, variantIds);
      const reasons = await tx.reason.findMany({
        where: { kind: 'ADJUSTMENT', isActive: true, deletedAt: null },
      });
      const settingsRow = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
      const fullUnload = companySettingsSchema.parse(settingsRow?.data ?? {}).rules.P06_fullUnload;
      const depot = fullUnload ? await this.ledger.mainDepot(tx) : null;

      const moves: Move[] = [];
      const rows = variantIds.map((variantId) => {
        const preview = expected.find((l) => l.variantId === variantId);
        const entry = counted.get(variantId)!;
        const theoretical = balances.get(variantId)!.physical;
        const { loaded, gap } = unloadLine({
          theoretical,
          delivered: preview?.delivered ?? 0,
          free: preview?.free ?? 0,
          counted: entry.countedQty,
        });
        if (gap !== 0) {
          if (!entry.reasonId || !reasons.some((r) => r.id === entry.reasonId))
            throw rule('Choisissez le motif de chaque écart.', { variantId });
          moves.push({
            type: 'ADJUSTMENT',
            variantId,
            qty: Math.abs(gap),
            ...(gap < 0 ? { fromWarehouseId: truck.id } : { toWarehouseId: truck.id }),
            reasonId: entry.reasonId,
            source: { type: 'UNLOAD', id },
          });
        }
        if (depot && entry.countedQty > 0)
          moves.push({
            type: 'TRANSFER',
            variantId,
            qty: entry.countedQty,
            fromWarehouseId: truck.id,
            toWarehouseId: depot.id,
            source: { type: 'UNLOAD', id },
          });
        return {
          id: uuidv7(),
          companyId: actor.companyId,
          productVariantId: variantId,
          loadedQty: loaded,
          deliveredQty: preview?.delivered ?? 0,
          freeQty: preview?.free ?? 0,
          theoreticalQty: theoretical,
          countedQty: entry.countedQty,
          gapQty: gap,
        };
      });
      // Les ajustements d'abord : le compté devient le stock du camion, puis il part au dépôt
      moves.sort((a, b) => Number(a.type === 'TRANSFER') - Number(b.type === 'TRANSFER'));
      const now = new Date();
      await tx.unload.create({
        data: {
          id,
          companyId: actor.companyId,
          date: workday.date,
          status: 'VALIDATED',
          keepsStockInTruck: !fullUnload,
          validatedByUserId: actor.userId,
          validatedAt: now,
          occurredAt: now,
          truckId: truck.id,
          userId: workday.userId,
          workdayId: workday.id,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          unloadLines: { create: rows.map(({ companyId, ...r }) => ({ ...r, companyId })) },
        },
      });
      await this.ledger.apply(tx, actor, moves, now);
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'unload.validate',
          entity: 'Unload',
          entityId: id,
          after: {
            workdayId: workday.id,
            keepsStockInTruck: !fullUnload,
            gaps: rows.filter((r) => r.gapQty !== 0).map((r) => [r.productVariantId, r.gapQty]),
          },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async list(date?: string): Promise<UnloadDto[]> {
    const day = date ?? localDate(new Date(), (await this.db.company.findFirstOrThrow()).timezone);
    const rows = await this.db.unload.findMany({
      where: { date: toDate(day), deletedAt: null },
      include: DETAIL,
      orderBy: { validatedAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<UnloadDto> {
    const row = await this.db.unload.findFirst({ where: { id, deletedAt: null }, include: DETAIL });
    if (!row) throw notFound('Déchargement introuvable.');
    return toDto(row);
  }

  /** Journée clôturée et camion affecté à son conducteur (UC-43, préconditions). */
  private async context(tx: Tx, workdayId: string) {
    const workday = await tx.workday.findFirst({ where: { id: workdayId, deletedAt: null } });
    if (!workday) throw notFound('Journée introuvable.');
    if (workday.status !== 'CLOSED')
      throw rule("La journée de ce conducteur n'est pas clôturée : déchargement impossible.");
    const truck = await tx.warehouse.findFirst({
      where: { type: 'TRUCK', assignedUserId: workday.userId, deletedAt: null },
    });
    if (!truck) throw rule("Cet utilisateur n'a pas de camion.");
    return { workday, truck };
  }

  /**
   * Articles du camion : en stock, chargés ou sortis ce jour-là. Théorique = stock du camion ;
   * livré = sorties du jour ; l'offert est distingué par les phases 19 et 20.
   */
  private async lines(tx: Tx, truckId: string, date: Date): Promise<UnloadPreviewLine[]> {
    const company = await tx.company.findFirstOrThrow();
    const day = dateOnly(date);
    const range = localRange(day, day, company.timezone);
    const [stock, loads, outs] = await Promise.all([
      tx.stock.findMany({ where: { warehouseId: truckId, deletedAt: null } }),
      tx.loadLine.findMany({ where: { load: { truckId, date, deletedAt: null } } }),
      tx.stockMovement.groupBy({
        by: ['productVariantId'],
        where: { type: 'OUT', fromWarehouseId: truckId, occurredAt: range },
        _sum: { qty: true },
      }),
    ]);
    const ids = new Set([
      ...stock.filter((s) => s.physicalQty > 0).map((s) => s.productVariantId),
      ...loads.map((l) => l.productVariantId),
      ...outs.map((o) => o.productVariantId),
    ]);
    const variants = await tx.productVariant.findMany({
      where: { id: { in: [...ids] } },
      include: { product: true },
    });
    return variants
      .map((v) => {
        const theoretical = stock.find((s) => s.productVariantId === v.id)?.physicalQty ?? 0;
        const delivered = outs.find((o) => o.productVariantId === v.id)?._sum.qty ?? 0;
        const free = 0;
        return {
          variantId: v.id,
          ...articleOf(v),
          loaded: theoretical + delivered + free,
          delivered,
          free,
          theoretical,
        };
      })
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) ||
          (a.variantName ?? '').localeCompare(b.variantName ?? ''),
      );
  }
}

function toDto(row: Prisma.UnloadGetPayload<{ include: typeof DETAIL }>): UnloadDto {
  const lines = row.unloadLines
    .map((l) => ({
      variantId: l.productVariantId,
      ...articleOf(l.productVariant),
      loaded: l.loadedQty,
      delivered: l.deliveredQty,
      free: l.freeQty,
      theoretical: l.theoreticalQty,
      counted: l.countedQty,
      gap: l.gapQty,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));
  return {
    id: row.id,
    date: dateOnly(row.date),
    truck: warehouseRef(row.truck),
    user: { id: row.user.id, code: row.user.code, name: fullName(row.user) },
    keepsStockInTruck: row.keepsStockInTruck,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    hasGap: lines.some((l) => l.gap !== 0),
    lines,
  };
}
