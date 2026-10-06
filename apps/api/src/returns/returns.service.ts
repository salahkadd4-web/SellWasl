import { Inject, Injectable } from '@nestjs/common';
import { netReturnCost, rate } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type KeyLabel,
  type RateDto,
  type ReturnAxis,
  type ReturnFactDto,
  type returnFactsQuerySchema,
  type ReturnsAxisDto,
  type ReturnsAxisRowDto,
  type returnsCrossQuerySchema,
  type ReturnsCrossDto,
  type ReturnsQuery,
  type ReturnsSummaryDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { dateOnly, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleName, fullName } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Fact = Prisma.ReturnFactGetPayload<object>;

/** Colonne de `ReturnFact` qui porte chaque axe. */
const AXIS_FIELD: Record<ReturnAxis, keyof Fact> = {
  product: 'productId',
  lot: 'lotId',
  supplier: 'supplierId',
  seller: 'sellerUserId',
  driver: 'driverUserId',
  customer: 'customerId',
  territory: 'territoryId',
  route: 'routeId',
  reason: 'reasonId',
  condition: 'condition',
};

const RATE_LABEL: Record<ReturnAxis, string> = {
  product: 'Taux de retour (retourné ÷ livré)',
  lot: 'Taux de retour (retourné ÷ reçu)',
  supplier: 'Taux de retour (retourné ÷ livré)',
  seller: 'Taux de refus (commandes)',
  driver: 'Taux de retour (retourné ÷ chargé)',
  customer: 'Taux de refus (commandes)',
  territory: 'Taux de refus (commandes)',
  route: 'Taux de refus (commandes)',
  reason: 'Part des refus',
  condition: 'Part du retourné',
};

export const CONDITION_LABEL: Record<string, string> = {
  RESTOCK: 'Remis en stock',
  DEFECTIVE: 'Défectueux',
  EXPIRED: 'Périmé',
  BROKEN: 'Cassé',
};

const NONE = 'none';
const keyOf = (f: Fact, axis: ReturnAxis): string | null =>
  (f[AXIS_FIELD[axis]] as string | null) ?? null;

/** Montants d'un groupe de faits. */
interface Totals {
  refusedOrders: Set<string>;
  refusedQty: number;
  refusedValue: number;
  returnedQty: number;
  returnedValue: number;
  defectiveQty: number;
  resoldQty: number;
  resoldValue: number;
  gapQty: number;
  gapValue: number;
}

const emptyTotals = (): Totals => ({
  refusedOrders: new Set(),
  refusedQty: 0,
  refusedValue: 0,
  returnedQty: 0,
  returnedValue: 0,
  defectiveQty: 0,
  resoldQty: 0,
  resoldValue: 0,
  gapQty: 0,
  gapValue: 0,
});

function add(t: Totals, f: Fact): void {
  const value = Number(f.value);
  switch (f.kind) {
    case 'REFUSAL':
      if (f.orderId) t.refusedOrders.add(f.orderId);
      t.refusedQty += f.qty;
      t.refusedValue += value;
      break;
    case 'RETURN':
      t.returnedQty += f.qty;
      t.returnedValue += value;
      if (f.condition === 'DEFECTIVE') t.defectiveQty += f.qty;
      break;
    case 'RESALE':
      t.resoldQty += f.qty;
      t.resoldValue += value;
      break;
    case 'GAP':
      t.gapQty += f.qty;
      t.gapValue += value;
      break;
  }
}

/**
 * Analyse des retours (phase 21) : faits figés regroupés par axe, vue croisée, détail des faits.
 * Les taux ne sont pas conclus sous le volume minimum de l'entreprise.
 */
@Injectable()
export class ReturnsService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  private async minVolume(): Promise<number> {
    const row = await this.db.companySettings.findFirst({ orderBy: { version: 'desc' } });
    return companySettingsSchema.parse(row?.data ?? {}).returnsMinVolume;
  }

  /** Faits de la période et des filtres. */
  async facts(q: ReturnsQuery, kind?: Fact['kind']): Promise<Fact[]> {
    const where: Prisma.ReturnFactWhereInput = {
      date: { gte: toDate(q.from), lte: toDate(q.to) },
      ...(kind && { kind }),
      ...(q.territoryId && { territoryId: q.territoryId }),
      ...(q.partId && { partId: q.partId }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.productId && { productId: q.productId }),
      ...(q.driverId && { driverUserId: q.driverId }),
      ...(q.sellerId && { sellerUserId: q.sellerId }),
      ...(q.lotId && { lotId: q.lotId }),
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.reasonId && { reasonId: q.reasonId }),
      ...(q.condition && { condition: q.condition }),
      ...(q.userId && { OR: [{ sellerUserId: q.userId }, { driverUserId: q.userId }] }),
    };
    return this.db.returnFact.findMany({ where, orderBy: { date: 'asc' } });
  }

  /** Refus dont la contestation a été retenue : ils ne pèsent pas sur le client. */
  private async upheldDeliveries(facts: Fact[]): Promise<Set<string>> {
    const ids = [
      ...new Set(
        facts.filter((f) => f.kind === 'REFUSAL' && f.deliveryId).map((f) => f.deliveryId!),
      ),
    ];
    if (ids.length === 0) return new Set();
    const rows = await this.db.delivery.findMany({
      where: { id: { in: ids }, contestStatus: 'UPHELD' },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  async axis(axis: ReturnAxis, q: ReturnsQuery): Promise<ReturnsAxisDto> {
    const [all, minVolume] = await Promise.all([this.facts(q), this.minVolume()]);
    const upheld = axis === 'customer' ? await this.upheldDeliveries(all) : new Set<string>();
    const facts = all.filter(
      (f) => !(f.kind === 'REFUSAL' && f.deliveryId && upheld.has(f.deliveryId)),
    );
    const groups = new Map<string | null, Totals>();
    for (const f of facts) {
      const key = keyOf(f, axis);
      if (!groups.has(key)) groups.set(key, emptyTotals());
      add(groups.get(key)!, f);
    }
    const keys = [...groups.keys()];
    const [labels, denominators] = await Promise.all([
      this.labels(axis, keys),
      this.denominators(axis, keys, q, facts),
    ]);
    const rows: ReturnsAxisRowDto[] = keys.map((key) => {
      const t = groups.get(key)!;
      const row: ReturnsAxisRowDto = {
        key,
        label: labels.get(key) ?? 'Non renseigné',
        refusals: t.refusedOrders.size,
        refusedQty: t.refusedQty,
        refusedValue: t.refusedValue,
        returnedQty: t.returnedQty,
        returnedValue: t.returnedValue,
        resoldQty: t.resoldQty,
        resoldValue: t.resoldValue,
        gapQty: t.gapQty,
        gapValue: t.gapValue,
        netCost: netReturnCost(t.returnedValue, t.resoldValue),
        rate: this.rateFor(axis, t, denominators.get(key) ?? 0, minVolume),
      };
      if (axis === 'product' || axis === 'lot' || axis === 'supplier')
        row.defectiveShare = rate(t.defectiveQty, t.returnedQty, minVolume);
      return row;
    });
    rows.sort((a, b) => b.refusedValue + b.returnedValue - (a.refusedValue + a.returnedValue));
    return { axis, rateLabel: RATE_LABEL[axis], rows };
  }

  private rateFor(axis: ReturnAxis, t: Totals, denominator: number, min: number): RateDto {
    switch (axis) {
      case 'seller':
      case 'customer':
      case 'territory':
      case 'route':
      case 'reason':
        return rate(t.refusedOrders.size, denominator, min);
      case 'condition':
        return rate(t.returnedQty, denominator, min);
      default:
        return rate(t.returnedQty, denominator, min);
    }
  }

  /**
   * Dénominateur du taux de chaque valeur de l'axe : commandes présentées (refus), quantité livrée
   * (produit, fournisseur), reçue (lot), chargée (livreur), total des refus (motif) ou du retourné
   * (état).
   */
  private async denominators(
    axis: ReturnAxis,
    keys: (string | null)[],
    q: ReturnsQuery,
    facts: Fact[],
  ): Promise<Map<string | null, number>> {
    const result = new Map<string | null, number>();
    const period = { gte: toDate(q.from), lte: toDate(q.to) };
    const ids = keys.filter((k): k is string => k !== null);
    switch (axis) {
      case 'seller':
      case 'customer':
      case 'territory':
      case 'route': {
        const deliveries = await this.db.delivery.findMany({
          where: { deletedAt: null, workday: { date: period } },
          include: { order: { include: { customer: true } } },
        });
        const byKey = new Map<string | null, Set<string>>();
        for (const d of deliveries) {
          const key =
            axis === 'seller'
              ? d.order.sellerUserId
              : axis === 'customer'
                ? d.order.customerId
                : axis === 'territory'
                  ? d.order.customer.territoryId
                  : d.routeId;
          if (!byKey.has(key)) byKey.set(key, new Set());
          byKey.get(key)!.add(d.orderId);
        }
        for (const key of keys) result.set(key, byKey.get(key)?.size ?? 0);
        return result;
      }
      case 'reason': {
        const total = new Set(facts.filter((f) => f.kind === 'REFUSAL').map((f) => f.orderId)).size;
        for (const key of keys) result.set(key, total);
        return result;
      }
      case 'condition': {
        const total = facts.filter((f) => f.kind === 'RETURN').reduce((s, f) => s + f.qty, 0);
        for (const key of keys) result.set(key, total);
        return result;
      }
      case 'lot': {
        const lots = await this.db.lot.findMany({ where: { id: { in: ids } } });
        for (const l of lots) result.set(l.id, l.receivedQty);
        return result;
      }
      case 'driver': {
        const lines = await this.db.unloadLine.findMany({
          where: { unload: { date: period, userId: { in: ids }, deletedAt: null } },
          include: { unload: true },
        });
        for (const l of lines)
          result.set(l.unload.userId, (result.get(l.unload.userId) ?? 0) + l.loadedQty);
        return result;
      }
      case 'product':
      case 'supplier': {
        const lines = await this.db.orderLine.findMany({
          where: {
            kind: 'NORMAL',
            deliveredQty: { gt: 0 },
            order: {
              deliveries: { some: { result: { not: 'FAILED' }, workday: { date: period } } },
            },
          },
          include: { product: true },
        });
        for (const l of lines) {
          const key = axis === 'product' ? l.productId : l.product.supplierId;
          result.set(key, (result.get(key) ?? 0) + (l.deliveredQty ?? 0));
        }
        return result;
      }
    }
  }

  /** Libellé lisible de chaque valeur d'un axe. */
  async labels(axis: ReturnAxis, keys: (string | null)[]): Promise<Map<string | null, string>> {
    const ids = keys.filter((k): k is string => k !== null);
    const map = new Map<string | null, string>();
    const set = (rows: { id: string }[], label: (r: never) => string) =>
      rows.forEach((r) => map.set(r.id, label(r as never)));
    switch (axis) {
      case 'product':
        set(
          await this.db.product.findMany({ where: { id: { in: ids } } }),
          (p: { name: string }) => p.name,
        );
        break;
      case 'lot':
        set(
          await this.db.lot.findMany({
            where: { id: { in: ids } },
            include: { productVariant: { include: { product: true } } },
          }),
          (l: { number: string; productVariant: Parameters<typeof articleName>[0] }) =>
            `${l.number} · ${articleName(l.productVariant)}`,
        );
        break;
      case 'supplier':
        set(
          await this.db.supplier.findMany({ where: { id: { in: ids } } }),
          (s: { name: string }) => s.name,
        );
        break;
      case 'seller':
      case 'driver':
        set(
          await this.db.user.findMany({ where: { id: { in: ids } } }),
          (u: { code: string; firstName: string; lastName: string }) =>
            `${fullName(u)} (${u.code})`,
        );
        break;
      case 'customer':
        set(
          await this.db.customer.findMany({ where: { id: { in: ids } } }),
          (c: { name: string }) => c.name,
        );
        break;
      case 'territory':
        set(
          await this.db.territory.findMany({ where: { id: { in: ids } } }),
          (s: { code: string; name: string }) => `${s.code} · ${s.name}`,
        );
        break;
      case 'route':
        set(
          await this.db.deliveryRoute.findMany({
            where: { id: { in: ids } },
            include: { deliveryUser: true },
          }),
          (r: { deliveryDate: Date; deliveryUser: { firstName: string; lastName: string } }) =>
            `${fullName(r.deliveryUser)} · ${dateOnly(r.deliveryDate).split('-').reverse().join('/')}`,
        );
        break;
      case 'reason':
        set(
          await this.db.reason.findMany({ where: { id: { in: ids } } }),
          (r: { label: string }) => r.label,
        );
        break;
      case 'condition':
        for (const key of ids) map.set(key, CONDITION_LABEL[key] ?? key);
        break;
    }
    return map;
  }

  async cross(q: z.output<typeof returnsCrossQuerySchema>): Promise<ReturnsCrossDto> {
    const facts = await this.facts(q, q.kind);
    const cells = new Map<
      string,
      { row: string | null; col: string | null; qty: number; value: number }
    >();
    for (const f of facts) {
      const row = keyOf(f, q.rows);
      const col = keyOf(f, q.cols);
      const id = `${row ?? NONE}|${col ?? NONE}`;
      const cell = cells.get(id) ?? { row, col, qty: 0, value: 0 };
      cell.qty += f.qty;
      cell.value += Number(f.value);
      cells.set(id, cell);
    }
    const rowKeys = [...new Set([...cells.values()].map((c) => c.row))];
    const colKeys = [...new Set([...cells.values()].map((c) => c.col))];
    const [rowLabels, colLabels] = await Promise.all([
      this.labels(q.rows, rowKeys),
      this.labels(q.cols, colKeys),
    ]);
    const toKeyLabels = (keys: (string | null)[], labels: Map<string | null, string>): KeyLabel[] =>
      keys
        .map((key) => ({ key, label: labels.get(key) ?? 'Non renseigné' }))
        .sort((a, b) => a.label.localeCompare(b.label));
    return {
      rows: toKeyLabels(rowKeys, rowLabels),
      cols: toKeyLabels(colKeys, colLabels),
      cells: [...cells.values()],
    };
  }

  /** Faits derrière un chiffre : 200 au plus, les plus récents d'abord. */
  async list(q: z.output<typeof returnFactsQuerySchema>): Promise<ReturnFactDto[]> {
    let facts = await this.facts(q, q.kind);
    if (q.axis && q.value) facts = facts.filter((f) => (keyOf(f, q.axis!) ?? NONE) === q.value);
    facts = facts.reverse().slice(0, 200);
    const pick = (field: keyof Fact) => [
      ...new Set(facts.map((f) => f[field] as string | null).filter((x): x is string => !!x)),
    ];
    const [variants, lots, suppliers, users, customers, territories, reasons, orders, deliveries] =
      await Promise.all([
        this.db.productVariant.findMany({
          where: { id: { in: pick('productVariantId') } },
          include: { product: true },
        }),
        this.db.lot.findMany({ where: { id: { in: pick('lotId') } } }),
        this.db.supplier.findMany({ where: { id: { in: pick('supplierId') } } }),
        this.db.user.findMany({
          where: { id: { in: [...pick('sellerUserId'), ...pick('driverUserId')] } },
        }),
        this.db.customer.findMany({ where: { id: { in: pick('customerId') } } }),
        this.db.territory.findMany({ where: { id: { in: pick('territoryId') } } }),
        this.db.reason.findMany({ where: { id: { in: pick('reasonId') } } }),
        this.db.order.findMany({ where: { id: { in: pick('orderId') } } }),
        this.db.delivery.findMany({ where: { id: { in: pick('deliveryId') } } }),
      ]);
    const user = (id: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? fullName(u) : null;
    };
    return facts.map((f) => {
      const variant = variants.find((v) => v.id === f.productVariantId);
      const order = orders.find((o) => o.id === f.orderId);
      const delivery = deliveries.find((d) => d.id === f.deliveryId);
      return {
        id: f.id,
        kind: f.kind,
        date: dateOnly(f.date),
        qty: f.qty,
        value: Number(f.value),
        condition: f.condition,
        article: variant ? articleName(variant) : 'Article',
        lot: lots.find((l) => l.id === f.lotId)?.number ?? null,
        supplier: suppliers.find((s) => s.id === f.supplierId)?.name ?? null,
        seller: user(f.sellerUserId),
        driver: user(f.driverUserId),
        customer: customers.find((c) => c.id === f.customerId)?.name ?? null,
        territory: territories.find((s) => s.id === f.territoryId)?.name ?? null,
        reason: reasons.find((r) => r.id === f.reasonId)?.label ?? null,
        order: order ? { id: order.id, number: order.number } : null,
        delivery: delivery ? { id: delivery.id, number: delivery.number } : null,
        unloadId: f.unloadId,
      };
    });
  }

  /** Synthèse des retours d'une période (dashboard, fiche d'un utilisateur). */
  async summary(q: ReturnsQuery): Promise<ReturnsSummaryDto> {
    const [facts, minVolume] = await Promise.all([this.facts(q), this.minVolume()]);
    const t = emptyTotals();
    for (const f of facts) add(t, f);
    const period = { gte: toDate(q.from), lte: toDate(q.to) };
    const userFilter = q.userId
      ? { OR: [{ userId: q.userId }, { order: { sellerUserId: q.userId } }] }
      : {};
    const [presented, loaded] = await Promise.all([
      this.db.delivery.findMany({
        where: { deletedAt: null, workday: { date: period }, ...userFilter },
        select: { orderId: true },
      }),
      this.db.unloadLine.aggregate({
        where: {
          unload: { date: period, deletedAt: null, ...(q.userId && { userId: q.userId }) },
        },
        _sum: { loadedQty: true },
      }),
    ]);
    return {
      refusals: t.refusedOrders.size,
      refusedValue: t.refusedValue,
      refusalRate: rate(
        t.refusedOrders.size,
        new Set(presented.map((d) => d.orderId)).size,
        minVolume,
      ),
      returnedQty: t.returnedQty,
      returnedValue: t.returnedValue,
      returnRate: rate(t.returnedQty, loaded._sum.loadedQty ?? 0, minVolume),
      resoldValue: t.resoldValue,
      netCost: netReturnCost(t.returnedValue, t.resoldValue),
      gapQty: t.gapQty,
      gapValue: t.gapValue,
    };
  }
}
