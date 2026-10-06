import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { LotDto, SupplierDto, supplierSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly } from '../field/field-errors';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Input = z.output<typeof supplierSchema>;

const duplicate = () =>
  new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', 'Ce fournisseur existe déjà.', { field: 'name' });

const toDto = (s: { id: string; name: string; phone: string | null; isActive: boolean }) => ({
  id: s.id,
  name: s.name,
  phone: s.phone,
  isActive: s.isActive,
});

/** Fournisseurs et lots (phase 21) : axes de l'analyse des retours. */
@Injectable()
export class SuppliersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SupplierDto[]> {
    const rows = await this.db.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(actor: AuthUser, input: Input): Promise<SupplierDto> {
    if (await this.db.supplier.findFirst({ where: { name: input.name, deletedAt: null } }))
      throw duplicate();
    const row = await this.db.supplier.create({
      data: {
        id: uuidv7(),
        companyId: actor.companyId,
        name: input.name,
        phone: input.phone ?? null,
        isActive: input.isActive ?? true,
        createdByUserId: actor.userId,
      },
    });
    await this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'supplier.create',
      entity: 'Supplier',
      entityId: row.id,
      after: { name: row.name },
    });
    return toDto(row);
  }

  async update(actor: AuthUser, id: string, input: Partial<Input>): Promise<SupplierDto> {
    const current = await this.db.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw notFound('Fournisseur introuvable.');
    if (
      input.name &&
      input.name !== current.name &&
      (await this.db.supplier.findFirst({ where: { name: input.name, deletedAt: null } }))
    )
      throw duplicate();
    const row = await this.db.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        version: { increment: 1 },
      },
    });
    await this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'supplier.update',
      entity: 'Supplier',
      entityId: id,
      after: { name: row.name, phone: row.phone, isActive: row.isActive },
    });
    return toDto(row);
  }

  /** Vérifie qu'un fournisseur existe ; renvoie son identifiant ou null. */
  async assertExists(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    if (!(await this.db.supplier.findFirst({ where: { id, deletedAt: null } })))
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', 'Fournisseur inconnu.');
    return id;
  }

  async lots(variantId: string): Promise<LotDto[]> {
    const rows = await this.db.lot.findMany({
      where: { productVariantId: variantId, deletedAt: null },
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((l) => ({
      id: l.id,
      number: l.number,
      expiresAt: l.expiresAt ? dateOnly(l.expiresAt) : null,
      receivedQty: l.receivedQty,
      supplier: l.supplier ? { id: l.supplier.id, name: l.supplier.name } : null,
    }));
  }
}
