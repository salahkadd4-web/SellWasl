import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CompanySettings,
  companySettingsSchema,
  type AuditAction,
  type AuditEntity,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { RolesService } from '../roles/roles.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import type {
  customerTypeSchema,
  holidaySchema,
  reasonSchema,
  warehouseSchema,
} from '@sellwasl/validation';

const rule = (message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export interface SettingsResponse {
  version: number;
  updatedAt: string;
  data: CompanySettings;
}

/**
 * Paramétrage de l'entreprise (UC-82, BR-TEN-06 à 08) : paramètres versionnés et données de
 * référence. Un changement de paramètre crée une nouvelle version, qui s'applique aux journées
 * démarrées ensuite (ARC-12) ; P-08 et P-10 mettent à jour les permissions des rôles.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly roles: RolesService,
  ) {}

  async current(): Promise<SettingsResponse> {
    const row = await this.db.companySettings.findFirst({ orderBy: { version: 'desc' } });
    if (!row) throw notFound('Paramètres introuvables.');
    return {
      version: row.version,
      updatedAt: row.createdAt.toISOString(),
      data: companySettingsSchema.parse(row.data),
    };
  }

  async update(actor: AuthUser, data: CompanySettings): Promise<SettingsResponse> {
    const previous = await this.current();
    const rulesChanged =
      previous.data.rules.P08_driverCollectsOldDebts !== data.rules.P08_driverCollectsOldDebts ||
      previous.data.rules.P10_supervisorEditsPrices !== data.rules.P10_supervisorEditsPrices;
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.companySettings.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          version: previous.version + 1,
          data,
          createdByUserId: actor.userId,
        },
      });
      if (rulesChanged) await this.roles.applyPermissions(tx, actor.companyId, data.rules);
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'settings.update',
          entity: 'CompanySettings',
          entityId: created.id,
          before: previous.data as unknown as Prisma.InputJsonValue,
          after: data as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      return created;
    });
    return { version: row.version, updatedAt: row.createdAt.toISOString(), data };
  }

  // ---------------------------------------------------------------- Types de clients

  customerTypes() {
    return this.db.customerType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async createCustomerType(actor: AuthUser, input: z.output<typeof customerTypeSchema>) {
    const created = await this.db.customerType.create({
      data: { id: uuidv7(), companyId: actor.companyId, ...input, createdByUserId: actor.userId },
    });
    await this.log(actor, 'customer_type.create', 'CustomerType', created.id, input);
    return created;
  }

  async updateCustomerType(
    actor: AuthUser,
    id: string,
    input: Partial<z.output<typeof customerTypeSchema>>,
  ) {
    if (input.isActive === false) {
      const others = await this.db.customerType.count({
        where: { id: { not: id }, isActive: true, deletedAt: null },
      });
      if (others === 0) throw rule('Il faut au moins un type de client actif.');
    }
    const updated = await this.db.customerType.update({ where: { id }, data: input });
    await this.log(actor, 'customer_type.update', 'CustomerType', id, input);
    return updated;
  }

  // ---------------------------------------------------------------- Jours fériés

  holidays() {
    return this.db.holiday.findMany({ where: { deletedAt: null }, orderBy: { date: 'asc' } });
  }

  async createHoliday(actor: AuthUser, input: z.output<typeof holidaySchema>) {
    const existing = await this.db.holiday.findFirst({ where: { date: day(input.date) } });
    // Un jour férié supprimé puis recréé reprend sa ligne (unicité par date).
    const holiday = existing
      ? await this.db.holiday.update({
          where: { id: existing.id },
          data: { label: input.label, deletedAt: null },
        })
      : await this.db.holiday.create({
          data: {
            id: uuidv7(),
            companyId: actor.companyId,
            date: day(input.date),
            label: input.label,
            createdByUserId: actor.userId,
          },
        });
    if (existing && !existing.deletedAt)
      throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', 'Ce jour est déjà férié.');
    await this.log(actor, 'holiday.create', 'Holiday', holiday.id, input);
    return holiday;
  }

  /** Suppression logique : les téléphones la reçoivent à la synchronisation. */
  async deleteHoliday(actor: AuthUser, id: string): Promise<void> {
    await this.db.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.log(actor, 'holiday.delete', 'Holiday', id);
  }

  // ---------------------------------------------------------------- Motifs

  reasons() {
    return this.db.reason.findMany({
      where: { deletedAt: null },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createReason(actor: AuthUser, input: z.output<typeof reasonSchema>) {
    const last = await this.db.reason.findFirst({
      where: { kind: input.kind },
      orderBy: { sortOrder: 'desc' },
    });
    const created = await this.db.reason.create({
      data: {
        id: uuidv7(),
        companyId: actor.companyId,
        ...input,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        createdByUserId: actor.userId,
      },
    });
    await this.log(actor, 'reason.create', 'Reason', created.id, input);
    return created;
  }

  /** Un motif système se renomme mais ne se désactive pas (docs/database.md §5). */
  async updateReason(actor: AuthUser, id: string, input: { label?: string; isActive?: boolean }) {
    const reason = await this.db.reason.findFirst({ where: { id } });
    if (!reason) throw notFound('Motif introuvable.');
    if (reason.systemCode && input.isActive === false)
      throw rule('Ce motif est utilisé par l’application : il peut être renommé, pas désactivé.');
    const updated = await this.db.reason.update({
      where: { id },
      data: { label: input.label, isActive: input.isActive },
    });
    await this.log(actor, 'reason.update', 'Reason', id, input);
    return updated;
  }

  // ---------------------------------------------------------------- Dépôts et camions

  warehouses() {
    return this.db.warehouse.findMany({
      where: { deletedAt: null },
      include: {
        assignedUser: { select: { id: true, code: true, firstName: true, lastName: true } },
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async createWarehouse(actor: AuthUser, input: z.output<typeof warehouseSchema>) {
    await this.assertTruckDriver(input.type, input.assignedUserId);
    const created = await this.db.warehouse.create({
      data: {
        id: uuidv7(),
        companyId: actor.companyId,
        type: input.type,
        code: input.code,
        name: input.name,
        plateNumber: input.type === 'TRUCK' ? (input.plateNumber ?? null) : null,
        assignedUserId: input.type === 'TRUCK' ? (input.assignedUserId ?? null) : null,
        isActive: input.isActive,
        createdByUserId: actor.userId,
      },
    });
    await this.log(actor, 'warehouse.create', 'Warehouse', created.id, input);
    return created;
  }

  async updateWarehouse(
    actor: AuthUser,
    id: string,
    input: Partial<z.output<typeof warehouseSchema>>,
  ) {
    const warehouse = await this.db.warehouse.findFirst({ where: { id } });
    if (!warehouse) throw notFound('Entrepôt introuvable.');
    if (input.type && input.type !== warehouse.type)
      throw rule("Le type d'un entrepôt ne change pas.");
    await this.assertTruckDriver(warehouse.type, input.assignedUserId);
    const updated = await this.db.warehouse.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        plateNumber: input.plateNumber,
        assignedUserId: warehouse.type === 'TRUCK' ? input.assignedUserId : undefined,
        isActive: input.isActive,
      },
    });
    await this.log(actor, 'warehouse.update', 'Warehouse', id, input);
    return updated;
  }

  /** Un camion est confié à un livreur ou à un vendeur cash van actif (BR-STK-01). */
  private async assertTruckDriver(
    type: 'DEPOT' | 'TRUCK',
    userId: string | null | undefined,
  ): Promise<void> {
    if (!userId) return;
    if (type !== 'TRUCK') throw rule('Seul un camion est affecté à un utilisateur.');
    const user = await this.db.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      include: { role: true },
    });
    if (!user || !['LIVREUR', 'VENDEUR_CASH_VAN'].includes(user.role.code)) {
      throw rule('Un camion est affecté à un livreur ou à un vendeur cash van actif.');
    }
  }

  private log(
    actor: AuthUser,
    action: AuditAction,
    entity: AuditEntity,
    entityId: string,
    after?: unknown,
  ) {
    return this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action,
      entity,
      entityId,
      after: after as Prisma.InputJsonValue | undefined,
    });
  }
}
