import { Injectable } from '@nestjs/common';
import {
  applyMove,
  moveDeltas,
  type StockBalance,
  type StockMoveType,
} from '@sellwasl/business-rules';
import { uuidv7 } from '../common/uuid';
import { rule } from '../field/field-errors';
import type { Prisma, StockSourceType } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface StockActor {
  companyId: string;
  userId: string;
  deviceId?: string | null;
}

/** Un mouvement de stock, en unité de base (BR-STK-03). */
export interface Move {
  type: StockMoveType;
  variantId: string;
  qty: number;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  source?: { type: StockSourceType; id: string };
  reasonId?: string;
}

interface LockedRow extends StockBalance {
  id: string;
}

const key = (warehouseId: string, variantId: string) => `${warehouseId}:${variantId}`;

/**
 * Registre de stock : toute variation passe par ici (docs/architecture.md, Stock). Les lignes
 * touchées sont verrouillées dans un ordre fixe, chaque mouvement est contrôlé (BR-STK-04) et
 * enregistré ; une erreur annule la transaction de l'appelant en entier (BR-STK-05).
 */
@Injectable()
export class StockLedger {
  /** Dépôt principal de l'entreprise : stock proposable, bonus limités, réservations. */
  async mainDepot(tx: Pick<Tx, 'warehouse'>) {
    const depot = await tx.warehouse.findFirst({
      where: { type: 'DEPOT', isActive: true, deletedAt: null },
      orderBy: { code: 'asc' },
    });
    if (!depot) throw rule("Aucun dépôt actif : contactez l'administrateur.");
    return depot;
  }

  /**
   * Soldes verrouillés d'un entrepôt par article (les lignes manquantes sont créées à 0).
   * `alsoLock` : autres entrepôts que l'opération touchera, verrouillés dans le même ordre global
   * pour que deux opérations croisées (chargement, déchargement) ne s'attendent pas mutuellement.
   */
  async balances(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    variantIds: string[],
    alsoLock: string[] = [],
  ): Promise<Map<string, StockBalance>> {
    const rows = await this.lock(
      tx,
      companyId,
      [warehouseId, ...alsoLock].flatMap((w) => variantIds.map((v) => [w, v] as const)),
    );
    return new Map(variantIds.map((v) => [v, rows.get(key(warehouseId, v))!]));
  }

  async apply(tx: Tx, actor: StockActor, moves: Move[], occurredAt = new Date()): Promise<void> {
    const effects = moves.map((m) => ({ move: m, deltas: moveDeltas(m) }));
    if (effects.length === 0) return;
    const rows = await this.lock(
      tx,
      actor.companyId,
      effects.flatMap((e) => e.deltas.map((d) => [d.warehouseId, e.move.variantId] as const)),
    );
    const changed = new Set<string>();
    for (const { move, deltas } of effects)
      for (const { warehouseId, delta } of deltas) {
        const k = key(warehouseId, move.variantId);
        const row = rows.get(k)!;
        const next = applyMove(row, delta);
        if (!next) throw await this.insufficient(tx, warehouseId, move.variantId, row);
        rows.set(k, { ...row, ...next });
        changed.add(k);
      }
    for (const k of changed) {
      const row = rows.get(k)!;
      await tx.stock.update({
        where: { id: row.id },
        data: {
          physicalQty: row.physical,
          reservedQty: row.reserved,
          version: { increment: 1 },
        },
      });
    }
    await tx.stockMovement.createMany({
      data: moves.map((m) => ({
        id: uuidv7(),
        companyId: actor.companyId,
        type: m.type,
        qty: m.qty,
        productVariantId: m.variantId,
        fromWarehouseId: m.fromWarehouseId ?? null,
        toWarehouseId: m.toWarehouseId ?? null,
        sourceType: m.source?.type ?? null,
        sourceId: m.source?.id ?? null,
        reasonId: m.reasonId ?? null,
        userId: actor.userId,
        deviceId: actor.deviceId ?? null,
        occurredAt,
      })),
    });
  }

  /** Crée à 0 puis verrouille les lignes de stock, triées par entrepôt puis article. */
  private async lock(
    tx: Tx,
    companyId: string,
    pairs: (readonly [string, string])[],
  ): Promise<Map<string, LockedRow>> {
    const unique = [...new Map(pairs.map((p) => [key(p[0], p[1]), p])).values()].sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
    );
    if (unique.length === 0) return new Map();
    const warehouses = unique.map((p) => p[0]);
    const variants = unique.map((p) => p[1]);
    // Un article inconnu est refusé clairement, plutôt que par la clé étrangère de la base
    const known = await tx.productVariant.count({ where: { id: { in: [...new Set(variants)] } } });
    if (known !== new Set(variants).size) throw rule('Article introuvable.');
    const ids = unique.map(() => uuidv7());
    await tx.$executeRaw`
      INSERT INTO stock (id, company_id, warehouse_id, product_variant_id, updated_at)
      SELECT u.id, ${companyId}::uuid, u.w, u.v, CURRENT_TIMESTAMP
      FROM unnest(${ids}::uuid[], ${warehouses}::uuid[], ${variants}::uuid[]) AS u(id, w, v)
      ON CONFLICT (company_id, warehouse_id, product_variant_id) DO NOTHING`;
    const rows = await tx.$queryRaw<
      {
        id: string;
        warehouse_id: string;
        product_variant_id: string;
        physical_qty: number;
        reserved_qty: number;
      }[]
    >`
      SELECT s.id, s.warehouse_id, s.product_variant_id, s.physical_qty, s.reserved_qty
      FROM stock s
      JOIN unnest(${warehouses}::uuid[], ${variants}::uuid[]) AS u(w, v)
        ON s.warehouse_id = u.w AND s.product_variant_id = u.v
      WHERE s.company_id = ${companyId}::uuid
      ORDER BY s.warehouse_id, s.product_variant_id
      FOR UPDATE OF s`;
    return new Map(
      rows.map((r) => [
        key(r.warehouse_id, r.product_variant_id),
        { id: r.id, physical: r.physical_qty, reserved: r.reserved_qty },
      ]),
    );
  }

  private async insufficient(tx: Tx, warehouseId: string, variantId: string, row: StockBalance) {
    const [variant, warehouse] = await Promise.all([
      tx.productVariant.findFirst({ where: { id: variantId }, include: { product: true } }),
      tx.warehouse.findFirst({ where: { id: warehouseId } }),
    ]);
    const article = variant
      ? variant.isDefault
        ? variant.product.name
        : `${variant.product.name} ${variant.name}`
      : 'article inconnu';
    const available = row.physical - row.reserved;
    return rule(
      `Stock insuffisant : ${article} dans ${warehouse?.name ?? 'cet entrepôt'} (disponible ${available}).`,
      { variantId, warehouseId, available },
    );
  }
}
