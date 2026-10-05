import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import { companySettingsSchema, type createLoadSchema, type LoadDto } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { activeWarehouse, articleOf, fullName, toBaseLines, warehouseRef } from './stock-helpers';
import { StockLedger } from './stock-ledger.service';

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
