import { Inject, Injectable } from '@nestjs/common';
import { localDate, unloadLine, weightedUnitPrice } from '@sellwasl/business-rules';
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
import { ImageStorageService } from '../files/image-storage.service';
import { type NewFact, writeFacts } from '../returns/return-facts';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { articleOf, fullName, localRange, warehouseRef } from './stock-helpers';
import { type Move, StockLedger } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

/** Une part du compté d'un article, par état constaté. */
interface Part {
  condition: 'RESTOCK' | 'DEFECTIVE' | 'EXPIRED' | 'BROKEN';
  qty: number;
  lotId?: string;
  photoKey?: string;
}

const DETAIL = {
  truck: true,
  user: true,
  unloadLines: {
    include: {
      productVariant: { include: { product: true } },
      conditions: { include: { lot: true }, orderBy: { createdAt: 'asc' } },
    },
  },
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
    private readonly images: ImageStorageService,
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
    const lines = await this.lines(tx, truck.id, workday.date, workday.id);
    const price = await this.unitPrices(
      tx,
      workday.id,
      lines.map((l) => l.variantId),
    );
    return lines.map((l) => ({ ...l, unitValue: Math.round(price.get(l.variantId) ?? 0) }));
  }

  async validate(actor: AuthUser, input: z.output<typeof createUnloadSchema>): Promise<UnloadDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const { truck, workday } = await this.context(tx, input.workdayId);
      if (await tx.unload.findFirst({ where: { workdayId: workday.id } }))
        throw rule('Ce camion est déjà déchargé pour cette journée.');
      const expected = await this.lines(tx, truck.id, workday.date, workday.id);
      const counted = new Map(input.lines.map((l) => [l.variantId, l]));
      if (expected.some((l) => !counted.has(l.variantId)))
        throw rule('Comptez chaque article du camion : il en manque.');
      const variantIds = [...new Set([...expected.map((l) => l.variantId), ...counted.keys()])];
      // Le théorique est relu sous verrou : rien ne bouge pendant la validation
      const settingsRow = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
      const fullUnload = companySettingsSchema.parse(settingsRow?.data ?? {}).rules.P06_fullUnload;
      const depot = fullUnload ? await this.ledger.mainDepot(tx) : null;
      const balances = await this.ledger.balances(
        tx,
        actor.companyId,
        truck.id,
        variantIds,
        depot ? [depot.id] : [],
      );
      const reasons = await tx.reason.findMany({
        where: { kind: 'ADJUSTMENT', isActive: true, deletedAt: null },
      });
      const split = await this.split(tx, input, counted);
      const price = await this.unitPrices(tx, workday.id, variantIds);

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
        // Seul le remis en stock repart ; le reste sort en perte (phase 21)
        const restock = (split.get(variantId) ?? [])
          .filter((p) => p.condition === 'RESTOCK')
          .reduce((sum, p) => sum + p.qty, 0);
        if (entry.countedQty > restock)
          moves.push({
            type: 'WRITE_OFF',
            variantId,
            qty: entry.countedQty - restock,
            fromWarehouseId: truck.id,
            source: { type: 'UNLOAD', id },
          });
        if (depot && restock > 0)
          moves.push({
            type: 'TRANSFER',
            variantId,
            qty: restock,
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
          unitValue: BigInt(Math.round(price.get(variantId) ?? 0)),
        };
      });
      // Les ajustements d'abord : le compté devient le stock du camion, puis il part au dépôt
      const order = { ADJUSTMENT: 0, WRITE_OFF: 1, TRANSFER: 2 } as Record<string, number>;
      moves.sort((a, b) => (order[a.type] ?? 0) - (order[b.type] ?? 0));
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
      await tx.unloadLineCondition.createMany({
        data: rows.flatMap((r) =>
          (split.get(r.productVariantId) ?? []).map((p) => ({
            id: uuidv7(),
            companyId: actor.companyId,
            unloadLineId: r.id,
            condition: p.condition,
            qty: p.qty,
            lotId: p.lotId ?? null,
            photoKey: p.photoKey ?? null,
            createdByUserId: actor.userId,
          })),
        ),
      });
      await this.ledger.apply(tx, actor, moves, now);
      await this.facts(tx, actor.companyId, id, workday, rows, split, price);
      // Chaque écart est enregistré, validé par qui a contrôlé le camion (phase 21 bis)
      await tx.discrepancy.createMany({
        data: rows
          .filter((r) => r.gapQty !== 0)
          .map((r) => ({
            id: uuidv7(),
            companyId: actor.companyId,
            kind: 'STOCK' as const,
            status: 'VALIDATED' as const,
            date: workday.date,
            userId: workday.userId,
            workdayId: workday.id,
            productVariantId: r.productVariantId,
            unloadLineId: r.id,
            qty: r.gapQty,
            unitValue: r.unitValue,
            amount: BigInt(r.gapQty) * r.unitValue,
            cause:
              reasons.find((x) => x.id === counted.get(r.productVariantId)?.reasonId)?.label ??
              null,
            validatedByUserId: actor.userId,
            validatedAt: now,
            createdByUserId: actor.userId,
          })),
      });
      // Les commandes reprogrammées de la journée retrouvent une réservation au dépôt (BR-LIV-06)
      if (depot) await this.reserveRescheduled(tx, actor, workday.id, depot.id, now);
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

  private readonly photoUrl = (key: string | null) => this.images.urls(key)?.url ?? null;

  async list(date?: string): Promise<UnloadDto[]> {
    const day = date ?? localDate(new Date(), (await this.db.company.findFirstOrThrow()).timezone);
    const rows = await this.db.unload.findMany({
      where: { date: toDate(day), deletedAt: null },
      include: DETAIL,
      orderBy: { validatedAt: 'desc' },
    });
    const users = await this.db.user.findMany({
      where: { id: { in: rows.map((r) => r.validatedByUserId).filter((x): x is string => !!x) } },
    });
    return rows.map((r) => toDto(r, this.photoUrl, users));
  }

  async get(id: string): Promise<UnloadDto> {
    const row = await this.db.unload.findFirst({ where: { id, deletedAt: null }, include: DETAIL });
    if (!row) throw notFound('Déchargement introuvable.');
    const users = row.validatedByUserId
      ? await this.db.user.findMany({ where: { id: row.validatedByUserId } })
      : [];
    return toDto(row, this.photoUrl, users);
  }

  /**
   * Répartition du compté par état constaté (phase 21) : la somme fait le compté, le défectueux a
   * sa photo, un lot est celui de l'article. Sans répartition, tout est remis en stock.
   */
  private async split(
    tx: Tx,
    input: z.output<typeof createUnloadSchema>,
    counted: Map<string, { countedQty: number }>,
  ): Promise<Map<string, Part[]>> {
    const parts = new Map<string, Part[]>();
    for (const c of input.conditions ?? []) {
      if (!counted.get(c.variantId)?.countedQty)
        throw rule('Un état constaté porte sur un article non compté.', { variantId: c.variantId });
      if (c.condition === 'DEFECTIVE' && !c.photoKey)
        throw rule('Ajoutez la photo du produit défectueux.', { variantId: c.variantId });
      if (
        c.lotId &&
        !(await tx.lot.findFirst({
          where: { id: c.lotId, productVariantId: c.variantId, deletedAt: null },
        }))
      )
        throw rule("Ce lot n'est pas un lot de l'article.", { variantId: c.variantId });
      parts.set(c.variantId, [...(parts.get(c.variantId) ?? []), c]);
    }
    for (const [variantId, entry] of counted) {
      const list = parts.get(variantId);
      if (!list) {
        if (entry.countedQty > 0)
          parts.set(variantId, [{ condition: 'RESTOCK', qty: entry.countedQty }]);
        continue;
      }
      if (list.reduce((sum, p) => sum + p.qty, 0) !== entry.countedQty)
        throw rule('La répartition par état doit faire la quantité comptée.', { variantId });
    }
    return parts;
  }

  /**
   * Valeur d'une unité de base de chaque article : prix moyen des ventes de la journée du
   * conducteur, à défaut le dernier prix vendu, sinon 0 (phases 21 et 21 bis).
   */
  private async unitPrices(
    tx: Tx,
    workdayId: string,
    variantIds: string[],
  ): Promise<Map<string, number>> {
    const sold = await tx.orderLine.findMany({
      where: {
        productVariantId: { in: variantIds },
        kind: 'NORMAL',
        deliveredQty: { gt: 0 },
        order: { deliveries: { some: { workdayId, result: { not: 'FAILED' } } } },
      },
    });
    const price = new Map<string, number>();
    for (const variantId of variantIds) {
      const ofDay = weightedUnitPrice(
        sold
          .filter((l) => l.productVariantId === variantId)
          .map((l) => ({ qty: l.deliveredQty ?? 0, amount: Number(l.lineAmount) })),
      );
      if (ofDay !== null) {
        price.set(variantId, ofDay);
        continue;
      }
      const last = await tx.orderLine.findFirst({
        where: { productVariantId: variantId, kind: 'NORMAL', deliveredQty: { gt: 0 } },
        orderBy: { updatedAt: 'desc' },
      });
      price.set(
        variantId,
        last
          ? weightedUnitPrice([{ qty: last.deliveredQty!, amount: Number(last.lineAmount) }])!
          : 0,
      );
    }
    return price;
  }

  /**
   * Faits de l'analyse des retours (phase 21) : un retour par répartition, un écart par ligne,
   * valorisés au prix moyen des ventes de la journée (à défaut, le dernier prix vendu).
   */
  private async facts(
    tx: Tx,
    companyId: string,
    unloadId: string,
    workday: { id: string; userId: string; date: Date },
    rows: { productVariantId: string; gapQty: number }[],
    split: Map<string, Part[]>,
    price: Map<string, number>,
  ): Promise<void> {
    const variantIds = rows.map((r) => r.productVariantId);
    const [variants, route, lots] = await Promise.all([
      tx.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: true } }),
      tx.deliveryRoute.findFirst({
        where: { deliveryUserId: workday.userId, deliveryDate: workday.date, deletedAt: null },
      }),
      tx.lot.findMany({
        where: {
          id: { in: [...split.values()].flat().flatMap((p) => (p.lotId ? [p.lotId] : [])) },
        },
      }),
    ]);
    const axes = { driverUserId: workday.userId, routeId: route?.id ?? null, unloadId };
    const facts: NewFact[] = [];
    for (const r of rows) {
      const variant = variants.find((v) => v.id === r.productVariantId)!;
      const base = {
        ...axes,
        productVariantId: variant.id,
        productId: variant.productId,
        supplierId: variant.product.supplierId,
      };
      const unitPrice = price.get(variant.id) ?? 0;
      for (const p of split.get(variant.id) ?? []) {
        const lot = lots.find((l) => l.id === p.lotId);
        facts.push({
          ...base,
          kind: 'RETURN',
          condition: p.condition,
          lotId: p.lotId ?? null,
          supplierId: lot?.supplierId ?? base.supplierId,
          qty: p.qty,
          value: p.qty * unitPrice,
        });
      }
      if (r.gapQty !== 0)
        facts.push({ ...base, kind: 'GAP', qty: r.gapQty, value: Math.abs(r.gapQty) * unitPrice });
    }
    await writeFacts(tx, companyId, workday.date, facts);
  }

  /** Réserve de nouveau, au dépôt, la marchandise des commandes reprogrammées de la journée. */
  private async reserveRescheduled(
    tx: Tx,
    actor: AuthUser,
    workdayId: string,
    depotId: string,
    at: Date,
  ) {
    const lines = await tx.orderLine.findMany({
      where: {
        kind: { in: ['NORMAL', 'BONUS'] },
        preparedQty: { gt: 0 },
        order: {
          status: 'LOCKED',
          routeId: null,
          deletedAt: null,
          deliveries: { some: { workdayId, result: 'FAILED' } },
        },
      },
    });
    if (lines.length === 0) return;
    const balances = await this.ledger.balances(
      tx,
      actor.companyId,
      depotId,
      lines.map((l) => l.productVariantId),
    );
    const available = new Map(
      [...balances].map(([variantId, b]) => [variantId, b.physical - b.reserved]),
    );
    const moves: Move[] = [];
    for (const l of lines) {
      const take = Math.max(0, Math.min(l.preparedQty!, available.get(l.productVariantId) ?? 0));
      available.set(l.productVariantId, (available.get(l.productVariantId) ?? 0) - take);
      if (take > 0)
        moves.push({
          type: 'RESERVATION',
          variantId: l.productVariantId,
          qty: take,
          toWarehouseId: depotId,
          source: { type: 'ORDER', id: l.orderId },
        });
      await tx.orderLine.update({
        where: { id: l.id },
        data: { reservedQty: take, isStockout: take < l.orderedQty, version: { increment: 1 } },
      });
    }
    await this.ledger.apply(tx, actor, moves, at);
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
   * sorties du jour réparties en offert (lignes bonus des livraisons de la journée) et livré.
   */
  private async lines(
    tx: Tx,
    truckId: string,
    date: Date,
    workdayId: string,
  ): Promise<Omit<UnloadPreviewLine, 'unitValue'>[]> {
    const company = await tx.company.findFirstOrThrow();
    const day = dateOnly(date);
    const range = localRange(day, day, company.timezone);
    const [stock, loads, outs] = await Promise.all([
      tx.stock.findMany({ where: { warehouseId: truckId, deletedAt: null } }),
      tx.loadLine.findMany({ where: { load: { truckId, date, deletedAt: null } } }),
      tx.stockMovement.groupBy({
        by: ['productVariantId'],
        // Les sorties des livraisons sont comptées par la journée, plus bas
        where: {
          type: 'OUT',
          fromWarehouseId: truckId,
          occurredAt: range,
          NOT: { sourceType: 'DELIVERY' },
        },
        _sum: { qty: true },
      }),
    ]);
    // Livraisons de la journée : lignes bonus = offert, les autres = livré
    const deliveredLines = await tx.orderLine.findMany({
      where: {
        deliveredQty: { gt: 0 },
        order: { deliveries: { some: { workdayId, result: { not: 'FAILED' } } } },
      },
    });
    const sumOf = (variantId: string, bonus: boolean) =>
      deliveredLines
        .filter((l) => l.productVariantId === variantId && (l.kind === 'BONUS') === bonus)
        .reduce((sum, l) => sum + (l.deliveredQty ?? 0), 0);
    const ids = new Set([
      ...stock.filter((s) => s.physicalQty > 0).map((s) => s.productVariantId),
      ...loads.map((l) => l.productVariantId),
      ...outs.map((o) => o.productVariantId),
      ...deliveredLines.map((l) => l.productVariantId),
    ]);
    const variants = await tx.productVariant.findMany({
      where: { id: { in: [...ids] } },
      include: { product: true },
    });
    return variants
      .map((v) => {
        const theoretical = stock.find((s) => s.productVariantId === v.id)?.physicalQty ?? 0;
        const free = sumOf(v.id, true);
        const delivered =
          sumOf(v.id, false) + (outs.find((o) => o.productVariantId === v.id)?._sum.qty ?? 0);
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

function toDto(
  row: Prisma.UnloadGetPayload<{ include: typeof DETAIL }>,
  photoUrl: (key: string | null) => string | null,
  users: { id: string; firstName: string; lastName: string }[],
): UnloadDto {
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
      unitValue: Number(l.unitValue),
      gapValue: l.gapQty * Number(l.unitValue),
      conditions: l.conditions.map((c) => ({
        condition: c.condition,
        qty: c.qty,
        lot: c.lot?.number ?? null,
        photoUrl: photoUrl(c.photoKey),
      })),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));
  return {
    id: row.id,
    date: dateOnly(row.date),
    truck: warehouseRef(row.truck),
    user: { id: row.user.id, code: row.user.code, name: fullName(row.user) },
    keepsStockInTruck: row.keepsStockInTruck,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    validatedBy: (() => {
      const u = users.find((x) => x.id === row.validatedByUserId);
      return u ? fullName(u) : null;
    })(),
    hasGap: lines.some((l) => l.gap !== 0),
    lines,
  };
}
