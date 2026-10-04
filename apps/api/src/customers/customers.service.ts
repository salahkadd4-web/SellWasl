import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  createCustomerSchema,
  CustomerDto,
  CustomerHistory,
  customerListQuerySchema,
  Page,
  ReviewReason,
  updateCustomerSchema,
} from '@sellwasl/validation';
import { companySettingsSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { type Placement, PlacementService } from './placement.service';

type CreateInput = z.output<typeof createCustomerSchema>;
type UpdateInput = z.output<typeof updateCustomerSchema>;
type ListQuery = z.output<typeof customerListQuerySchema>;

export const customerInclude = {
  customerType: true,
  territory: true,
  part: true,
} as const satisfies Prisma.CustomerInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);

const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];

/** Clients à revoir par le superviseur (BR-CLI-05). */
export const TO_REVIEW = {
  status: 'ACTIVE',
  OR: [{ isNew: true }, { partId: null }, { isClosedPermanently: true }],
} satisfies Prisma.CustomerWhereInput;

const dateOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

export function toCustomerDto(c: CustomerRow, createdBy: string | null = null): CustomerDto {
  const reviewReasons: ReviewReason[] = [];
  if (c.status === 'ACTIVE') {
    if (c.isNew) reviewReasons.push('NEW');
    if (!c.partId) reviewReasons.push('OUT_OF_PART');
    if (c.isClosedPermanently) reviewReasons.push('CLOSED');
  }
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    address: c.address,
    latitude: c.latitude,
    longitude: c.longitude,
    customerType: { id: c.customerType.id, code: c.customerType.code, name: c.customerType.name },
    territory: c.territory
      ? { id: c.territory.id, code: c.territory.code, name: c.territory.name }
      : null,
    part: c.part ? { id: c.part.id, number: c.part.number, name: c.part.name } : null,
    isPartForced: c.isPartForced,
    frequency: c.frequency,
    referenceDate: dateOnly(c.referenceDate),
    isCreditAllowed: c.isCreditAllowed,
    creditLimitAmount: Number(c.creditLimitAmount),
    debtAmount: Number(c.debtAmount),
    status: c.status,
    isNew: c.isNew,
    isCashOnly: c.isCashOnly,
    isClosedPermanently: c.isClosedPermanently,
    reviewReasons,
    createdBy,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Curseur opaque : nom et identifiant du dernier client de la page (tri par nom). */
function encodeCursor(c: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify([c.name, c.id])).toString('base64url');
}
function decodeCursor(cursor: string): Prisma.CustomerWhereInput {
  try {
    const [name, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    return { OR: [{ name: { gt: name } }, { name, id: { gt: id } }] };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Curseur invalide.');
  }
}

/** Fiches clients (UC-11, UC-12, UC-53). */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly placement: PlacementService,
  ) {}

  /**
   * Clients visibles par l'utilisateur : tous sur le Web ; sur le téléphone, ceux de son secteur
   * (vendeurs) ou des secteurs qu'il livre (livreur).
   */
  private scope(actor: AuthUser): Prisma.CustomerWhereInput {
    if (actor.channel === 'WEB') return {};
    if (SELLER_ROLES.includes(actor.roleCode)) return { territory: { sellerUserId: actor.userId } };
    if (actor.roleCode === 'LIVREUR') return { territory: { deliveryUserId: actor.userId } };
    return { id: { in: [] } };
  }

  async list(actor: AuthUser, query: ListQuery): Promise<Page<CustomerDto>> {
    const q = query.q;
    const where: Prisma.CustomerWhereInput = {
      AND: [
        { deletedAt: null },
        this.scope(actor),
        query.status === 'ALL' ? {} : { status: query.status },
        q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { address: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        query.territoryId ? { territoryId: query.territoryId } : {},
        query.partId === 'none' ? { partId: null } : query.partId ? { partId: query.partId } : {},
        query.customerTypeId ? { customerTypeId: query.customerTypeId } : {},
        query.toReview ? TO_REVIEW : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.db.customer.findMany({
        where: query.cursor ? { AND: [where, decodeCursor(query.cursor)] } : where,
        include: customerInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      }),
      this.db.customer.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((c) => toCustomerDto(c)),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
      total,
    };
  }

  private async find(actor: AuthUser, id: string): Promise<CustomerRow> {
    const customer = await this.db.customer.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scope(actor)] },
      include: customerInclude,
    });
    if (!customer) throw notFound('Client introuvable.');
    return customer;
  }

  async get(actor: AuthUser, id: string): Promise<CustomerDto> {
    const customer = await this.find(actor, id);
    const creator = customer.createdByUserId
      ? await this.db.user.findFirst({ where: { id: customer.createdByUserId } })
      : null;
    return toCustomerDto(customer, creator ? `${creator.firstName} ${creator.lastName}` : null);
  }

  private async assertType(customerTypeId: string) {
    const type = await this.db.customerType.findFirst({
      where: { id: customerTypeId, deletedAt: null },
    });
    if (!type) throw rule('Type de client introuvable.');
    if (!type.isActive) throw rule(`Le type « ${type.name} » est désactivé.`);
    return type;
  }

  private async assertCodeFree(code: string | null | undefined, exceptId?: string) {
    if (!code) return;
    const other = await this.db.customer.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (other) {
      throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', `Le code ${code} est déjà utilisé.`, {
        field: 'code',
      });
    }
  }

  /**
   * Création d'un client. Par un vendeur (BR-CLI-02, BR-CLI-03) : rattaché à son secteur, partie
   * calculée dans ce secteur, marqué « nouveau », sans crédit, au comptant seul si P-09 le veut.
   * Par le superviseur ou l'admin (UC-53) : partie calculée parmi tous les secteurs, ou choisie.
   */
  async create(actor: AuthUser, input: CreateInput): Promise<CustomerDto> {
    await this.assertType(input.customerTypeId);
    await this.assertCodeFree(input.code);
    const point =
      input.latitude != null && input.longitude != null
        ? { latitude: input.latitude, longitude: input.longitude }
        : null;

    let placement: Placement;
    let seller = false;
    let isCashOnly = false;
    if (actor.channel === 'MOBILE') {
      if (!SELLER_ROLES.includes(actor.roleCode))
        throw rule('Seuls les vendeurs créent un client.');
      seller = true;
      const territory = await this.db.territory.findFirst({
        where: { sellerUserId: actor.userId, isActive: true, deletedAt: null },
        include: { territoryCustomerTypes: true },
      });
      if (!territory) throw rule("Vous n'avez pas de secteur : contactez votre superviseur.");
      if (!territory.territoryCustomerTypes.some((t) => t.customerTypeId === input.customerTypeId))
        throw rule('Votre secteur ne sert pas ce type de client.', { rule: 'BR-CLI-02' });
      if (!point) throw rule('La position du client est obligatoire.', { rule: 'BR-CLI-02' });
      placement = await this.placement.place(input.customerTypeId, point, {
        territoryId: territory.id,
        onAmbiguous: 'first',
      });
      const settings = await this.db.companySettings.findFirst({ orderBy: { version: 'desc' } });
      isCashOnly = !companySettingsSchema.parse(settings?.data ?? {}).rules
        .P09_newCustomerActiveImmediately;
    } else {
      placement = input.partId
        ? await this.placement.forced(input.customerTypeId, input.partId)
        : await this.placement.place(input.customerTypeId, point, { onAmbiguous: 'reject' });
    }

    const referenceDate =
      toDate(input.referenceDate) ??
      this.placement.referenceDate(await this.placement.calendar(), placement.partId);

    const id = uuidv7();
    const created = await this.db.$transaction(async (tx) => {
      const row = await tx.customer.create({
        data: {
          id,
          companyId: actor.companyId,
          code: input.code ?? null,
          name: input.name,
          phone: input.phone ?? null,
          address: input.address ?? null,
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
          customerTypeId: input.customerTypeId,
          ...placement,
          frequency: input.frequency,
          referenceDate,
          isCreditAllowed: seller ? false : input.isCreditAllowed,
          creditLimitAmount: BigInt(seller ? 0 : input.creditLimitAmount),
          isNew: seller,
          isCashOnly,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
        },
        include: customerInclude,
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'customer.create',
          entity: 'Customer',
          entityId: id,
          after: { name: row.name, territoryId: row.territoryId, partId: row.partId },
        },
        tx,
      );
      return row;
    });
    return toCustomerDto(created);
  }

  /** Modification par le superviseur ou l'admin (BR-CLI-04, UC-53). */
  async update(actor: AuthUser, id: string, input: UpdateInput): Promise<CustomerDto> {
    const current = await this.find(actor, id);
    const customerTypeId = input.customerTypeId ?? current.customerTypeId;
    if (input.customerTypeId && input.customerTypeId !== current.customerTypeId)
      await this.assertType(input.customerTypeId);
    if (input.code !== undefined) await this.assertCodeFree(input.code, id);

    const positionGiven = input.latitude !== undefined || input.longitude !== undefined;
    const latitude = positionGiven ? (input.latitude ?? null) : current.latitude;
    const longitude = positionGiven ? (input.longitude ?? null) : current.longitude;
    const point = latitude != null && longitude != null ? { latitude, longitude } : null;

    // Partie : choisie (forcée), libérée (null), ou recalculée si la position ou le type change
    let placement: Placement | null = null;
    if (input.partId) {
      placement = await this.placement.forced(customerTypeId, input.partId);
    } else if (input.partId === null) {
      placement = await this.placement.place(customerTypeId, point, { onAmbiguous: 'reject' });
    } else if (current.isPartForced && current.partId) {
      if (customerTypeId !== current.customerTypeId)
        placement = await this.placement.forced(customerTypeId, current.partId);
    } else if (positionGiven || customerTypeId !== current.customerTypeId) {
      placement = await this.placement.place(customerTypeId, point, { onAmbiguous: 'reject' });
    }

    const partChanged = placement !== null && placement.partId !== current.partId;
    const referenceDate =
      input.referenceDate !== undefined
        ? toDate(input.referenceDate)
        : partChanged
          ? this.placement.referenceDate(await this.placement.calendar(), placement!.partId)
          : undefined;

    const data: Prisma.CustomerUncheckedUpdateInput = {
      ...(input.code !== undefined && { code: input.code ?? null }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone ?? null }),
      ...(input.address !== undefined && { address: input.address ?? null }),
      ...(positionGiven && { latitude, longitude }),
      ...(input.customerTypeId !== undefined && { customerTypeId }),
      ...(placement ?? {}),
      ...(input.frequency !== undefined && { frequency: input.frequency }),
      ...(referenceDate !== undefined && { referenceDate }),
      ...(input.isCreditAllowed !== undefined && { isCreditAllowed: input.isCreditAllowed }),
      ...(input.creditLimitAmount !== undefined && {
        creditLimitAmount: BigInt(input.creditLimitAmount),
      }),
      ...(input.isClosedPermanently === false && { isClosedPermanently: false }),
      version: { increment: 1 },
    };
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.customer.update({ where: { id }, data, include: customerInclude });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'customer.update',
          entity: 'Customer',
          entityId: id,
          before: toCustomerDto(current) as unknown as Prisma.InputJsonValue,
          after: toCustomerDto(row) as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      return row;
    });
    return toCustomerDto(updated);
  }

  /** Validation d'un client créé par un vendeur (BR-CLI-03) : il n'est plus « nouveau ». */
  async validate(actor: AuthUser, id: string): Promise<CustomerDto> {
    const current = await this.find(actor, id);
    if (!current.isNew) throw rule("Ce client n'est pas un nouveau client.");
    return this.setFlags(actor, id, { isNew: false, isCashOnly: false }, 'customer.validate');
  }

  /** Désactiver remplace la suppression : l'historique reste (BR-CLI-04). */
  async setStatus(
    actor: AuthUser,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<CustomerDto> {
    const current = await this.find(actor, id);
    if (current.status === status)
      throw rule(status === 'ACTIVE' ? 'Ce client est déjà actif.' : 'Ce client est déjà inactif.');
    return this.setFlags(
      actor,
      id,
      { status },
      status === 'ACTIVE' ? 'customer.enable' : 'customer.disable',
    );
  }

  private async setFlags(
    actor: AuthUser,
    id: string,
    data: Prisma.CustomerUncheckedUpdateInput,
    action: string,
  ): Promise<CustomerDto> {
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        include: customerInclude,
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action,
          entity: 'Customer',
          entityId: id,
          after: data as Prisma.InputJsonValue,
        },
        tx,
      );
      return row;
    });
    return toCustomerDto(updated);
  }

  /** Historique de la fiche : visites, commandes, paiements, dette (UC-11). */
  async history(actor: AuthUser, id: string): Promise<CustomerHistory> {
    await this.find(actor, id);
    const take = 50;
    const [visits, orders, payments, debtEntries] = await Promise.all([
      this.db.visit.findMany({
        where: { customerId: id, deletedAt: null },
        include: { user: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take,
      }),
      this.db.order.findMany({
        where: { customerId: id, deletedAt: null },
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        take,
      }),
      this.db.payment.findMany({
        where: { customerId: id, deletedAt: null },
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.db.customerDebtEntry.findMany({
        where: { customerId: id },
        orderBy: { occurredAt: 'desc' },
        take,
      }),
    ]);
    return {
      visits: visits.map((v) => ({
        id: v.id,
        date: dateOnly(v.date)!,
        status: v.status,
        outcome: v.outcome,
        user: `${v.user.firstName} ${v.user.lastName}`,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        date: dateOnly(o.orderDate)!,
        status: o.status,
        source: o.source,
        totalAmount: Number(o.totalAmount),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        number: p.number,
        date: (p.occurredAt ?? p.createdAt).toISOString(),
        kind: p.kind,
        cashAmount: Number(p.cashAmount),
        creditAmount: Number(p.creditAmount),
        user: `${p.user.firstName} ${p.user.lastName}`,
      })),
      debtEntries: debtEntries.map((e) => ({
        id: e.id,
        date: e.occurredAt.toISOString(),
        kind: e.kind,
        amount: Number(e.amount),
      })),
    };
  }
}
