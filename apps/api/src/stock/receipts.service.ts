import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import type {
  createReceiptSchema,
  ReceiptDto,
  Page,
  stockReceiptsQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import {
  activeWarehouse,
  articleOf,
  fullName,
  localRange,
  toBaseLines,
  warehouseRef,
} from './stock-helpers';
import { StockLedger } from './stock-ledger.service';
import { paginate, type PageQuery } from '../common/pagination';

const DETAIL = {
  warehouse: true,
  supplierRef: true,
  stockReceiptLines: { include: { productVariant: { include: { product: true } }, unit: true } },
} as const;

/** Entrées au dépôt (UC-40) : une réception de fournisseur, un mouvement `IN` par ligne. */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthUser, input: z.output<typeof createReceiptSchema>): Promise<ReceiptDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const depot = await activeWarehouse(tx, input.warehouseId, 'DEPOT');
      const lines = await toBaseLines(tx, input.lines);
      if (
        input.supplierId &&
        !(await tx.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null } }))
      )
        throw rule('Fournisseur inconnu.');
      const lotIds = await this.lots(tx, actor, input, lines);
      const now = new Date();
      await tx.stockReceipt.create({
        data: {
          id,
          companyId: actor.companyId,
          warehouseId: depot.id,
          reference: input.reference || null,
          supplier: input.supplier || null,
          supplierId: input.supplierId ?? null,
          receivedAt: now,
          occurredAt: now,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          stockReceiptLines: {
            create: lines.map((l, i) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              productVariantId: l.variantId,
              unitId: l.unitId,
              enteredQty: l.enteredQty,
              qty: l.qty,
              lotNumber: input.lines[i]!.lotNumber ?? null,
              expiresAt: input.lines[i]!.expiresAt ? toDate(input.lines[i]!.expiresAt!) : null,
              lotId: lotIds[i] ?? null,
            })),
          },
        },
      });
      await this.ledger.apply(
        tx,
        actor,
        lines.map((l) => ({
          type: 'IN' as const,
          variantId: l.variantId,
          qty: l.qty,
          toWarehouseId: depot.id,
          source: { type: 'RECEIPT' as const, id },
        })),
        now,
      );
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'stock.receive',
          entity: 'StockReceipt',
          entityId: id,
          after: { warehouseId: depot.id, lines: lines.map((l) => [l.variantId, l.qty]) },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Lots des lignes (phase 21) : créé au premier passage, quantité reçue cumulée ensuite ; son
   * fournisseur est celui de l'entrée.
   */
  private async lots(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    input: z.output<typeof createReceiptSchema>,
    lines: { variantId: string; qty: number }[],
  ): Promise<(string | null)[]> {
    const ids: (string | null)[] = [];
    for (const [i, line] of lines.entries()) {
      const entry = input.lines[i]!;
      if (!entry.lotNumber) {
        ids.push(null);
        continue;
      }
      const existing = await tx.lot.findFirst({
        where: { productVariantId: line.variantId, number: entry.lotNumber, deletedAt: null },
      });
      if (existing) {
        await tx.lot.update({
          where: { id: existing.id },
          data: {
            receivedQty: { increment: line.qty },
            ...(entry.expiresAt && !existing.expiresAt && { expiresAt: toDate(entry.expiresAt) }),
            ...(input.supplierId && !existing.supplierId && { supplierId: input.supplierId }),
            version: { increment: 1 },
          },
        });
        ids.push(existing.id);
      } else {
        const id = uuidv7();
        await tx.lot.create({
          data: {
            id,
            companyId: actor.companyId,
            productVariantId: line.variantId,
            number: entry.lotNumber,
            expiresAt: entry.expiresAt ? toDate(entry.expiresAt) : null,
            supplierId: input.supplierId ?? null,
            receivedQty: line.qty,
            createdByUserId: actor.userId,
          },
        });
        ids.push(id);
      }
    }
    return ids;
  }

  /** Entrées d'une période (par défaut les 30 derniers jours), les plus récentes d'abord. */
  async list(q: z.output<typeof stockReceiptsQuerySchema>): Promise<Page<ReceiptDto>> {
    const company = await this.db.company.findFirstOrThrow();
    const today = localDate(new Date(), company.timezone);
    const start = q.from ?? localDate(new Date(Date.now() - 30 * 86_400_000), company.timezone);
    const where: Prisma.StockReceiptWhereInput = {
      deletedAt: null,
      receivedAt: localRange(start, q.to ?? today, company.timezone),
    };
    return paginate(
      q,
      (p) =>
        this.db.stockReceipt.findMany({
          where: { AND: [where, p.after] },
          include: DETAIL,
          orderBy: p.orderBy,
          take: p.take,
        }),
      () => this.db.stockReceipt.count({ where }),
      async (rows) => {
        return this.toDtos(rows);
      },
    );
  }

  async get(id: string): Promise<ReceiptDto> {
    const row = await this.db.stockReceipt.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL,
    });
    if (!row) throw notFound('Entrée introuvable.');
    return (await this.toDtos([row]))[0]!;
  }

  private async toDtos(
    rows: Prisma.StockReceiptGetPayload<{ include: typeof DETAIL }>[],
  ): Promise<ReceiptDto[]> {
    const ids = [...new Set(rows.map((r) => r.createdByUserId).filter((x): x is string => !!x))];
    const users = await this.db.user.findMany({ where: { id: { in: ids } } });
    return rows.map((r) => {
      const user = users.find((u) => u.id === r.createdByUserId);
      return {
        id: r.id,
        warehouse: warehouseRef(r.warehouse),
        reference: r.reference,
        supplier: r.supplier,
        supplierRef: r.supplierRef ? { id: r.supplierRef.id, name: r.supplierRef.name } : null,
        receivedAt: r.receivedAt.toISOString(),
        user: user ? fullName(user) : null,
        lines: r.stockReceiptLines.map((l) => ({
          variantId: l.productVariantId,
          ...articleOf(l.productVariant),
          unitName: l.unit.name,
          enteredQty: l.enteredQty,
          qty: l.qty,
          lotNumber: l.lotNumber,
          expiresAt: l.expiresAt ? dateOnly(l.expiresAt) : null,
        })),
      };
    });
  }
}
