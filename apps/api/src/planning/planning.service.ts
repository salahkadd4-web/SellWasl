import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  addDaysTo,
  dayList,
  dayStatus,
  localDate,
  type PlannedCustomer,
  type PlanningCalendar,
  type WeekdayCode,
} from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type PlanningCalendarDay,
  type PlanningDay,
  type RescheduleDto,
} from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/**
 * Clients du jour et reprogrammations (BR-PLA-01 à BR-PLA-07, UC-54). Le calcul vient de
 * `packages/business-rules`, le même que sur le téléphone.
 */
@Injectable()
export class PlanningService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private async companyCalendar() {
    const [company, settings, holidays] = await Promise.all([
      this.db.company.findFirstOrThrow(),
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
      this.db.holiday.findMany({ where: { deletedAt: null } }),
    ]);
    return {
      today: localDate(new Date(), company.timezone),
      workingDays: companySettingsSchema.parse(settings?.data ?? {}).workingDays as WeekdayCode[],
      holidays: holidays.map((h) => ({ date: dateOnly(h.date), label: h.label })),
    };
  }

  /** Secteur du vendeur, ses parties, son planning et ses clients. */
  private async sellerContext(userId: string) {
    const seller = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { role: true },
    });
    if (!seller || !['PRE_VENDEUR', 'VENDEUR_CASH_VAN'].includes(seller.role.code))
      throw notFound('Vendeur introuvable.');
    const territory = await this.db.territory.findFirst({
      where: { sellerUserId: userId, deletedAt: null },
      include: {
        territoryParts: { where: { deletedAt: null } },
        partSchedules: { where: { deletedAt: null } },
      },
    });
    const customers = territory
      ? await this.db.customer.findMany({
          where: { territoryId: territory.id, deletedAt: null },
          orderBy: { name: 'asc' },
        })
      : [];
    const company = await this.companyCalendar();
    const calendar: PlanningCalendar = {
      workingDays: company.workingDays,
      holidays: company.holidays.map((h) => h.date),
      partByWeekday: Object.fromEntries(
        (territory?.partSchedules ?? []).map((s) => [s.weekday, s.partId]),
      ),
    };
    const planned: PlannedCustomer[] = customers.map((c) => ({
      id: c.id,
      partId: c.partId,
      frequency: c.frequency,
      referenceDate: c.referenceDate ? dateOnly(c.referenceDate) : null,
      isActive: c.status === 'ACTIVE',
    }));
    return { seller, territory, customers, planned, calendar, company };
  }

  private async rescheduledIds(customerIds: string[], from: string, to: string) {
    const rows = await this.db.customerReschedule.findMany({
      where: {
        customerId: { in: customerIds },
        deletedAt: null,
        date: { gte: toDate(from), lte: toDate(to) },
      },
    });
    const byDate = new Map<string, string[]>();
    for (const r of rows) {
      const d = dateOnly(r.date);
      byDate.set(d, [...(byDate.get(d) ?? []), r.customerId]);
    }
    return byDate;
  }

  async day(userId: string, date: string): Promise<PlanningDay> {
    const ctx = await this.sellerContext(userId);
    const rescheduled = await this.rescheduledIds(
      ctx.customers.map((c) => c.id),
      date,
      date,
    );
    const status = dayStatus(date, ctx.calendar);
    const list = dayList(ctx.planned, date, ctx.calendar, rescheduled.get(date) ?? []);
    const partName = (id: string | null) =>
      ctx.territory?.territoryParts.find((p) => p.id === id)?.name ?? null;
    const partId = status.kind === 'WORKING' ? status.partId : null;
    return {
      date,
      status: status.kind,
      holiday: ctx.company.holidays.find((h) => h.date === date)?.label ?? null,
      seller: { id: ctx.seller.id, code: ctx.seller.code, name: fullName(ctx.seller) },
      territory: ctx.territory
        ? { id: ctx.territory.id, code: ctx.territory.code, name: ctx.territory.name }
        : null,
      part: partId ? { id: partId, name: partName(partId) ?? '?' } : null,
      customers: list.map((entry) => {
        const c = ctx.customers.find((x) => x.id === entry.customerId)!;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          phone: c.phone,
          address: c.address,
          latitude: c.latitude,
          longitude: c.longitude,
          partName: partName(c.partId),
          frequency: c.frequency,
          referenceDate: c.referenceDate ? dateOnly(c.referenceDate) : null,
          debtAmount: Number(c.debtAmount),
          reason: entry.reason,
        };
      }),
    };
  }

  /** Nombre de clients prévus chaque jour, pour le calendrier du superviseur. */
  async calendar(userId: string, from: string, days: number): Promise<PlanningCalendarDay[]> {
    const ctx = await this.sellerContext(userId);
    const to = addDaysTo(from, days - 1);
    const rescheduled = await this.rescheduledIds(
      ctx.customers.map((c) => c.id),
      from,
      to,
    );
    const partName = (id: string | null) =>
      ctx.territory?.territoryParts.find((p) => p.id === id)?.name ?? null;
    return Array.from({ length: days }, (_, i) => {
      const date = addDaysTo(from, i);
      const status = dayStatus(date, ctx.calendar);
      const list = dayList(ctx.planned, date, ctx.calendar, rescheduled.get(date) ?? []);
      return {
        date,
        status: status.kind,
        holiday: ctx.company.holidays.find((h) => h.date === date)?.label ?? null,
        partName: status.kind === 'WORKING' ? partName(status.partId) : null,
        count: list.length,
        rescheduledCount: list.filter((e) => e.reason === 'RESCHEDULED').length,
      };
    });
  }

  // Reprogrammations (BR-PLA-05, UC-54) ---------------------------------------------------------

  async reschedules(filter: { userId?: string; customerId?: string }): Promise<RescheduleDto[]> {
    const { today } = await this.companyCalendar();
    const rows = await this.db.customerReschedule.findMany({
      where: {
        deletedAt: null,
        date: { gte: toDate(today) },
        ...(filter.customerId && { customerId: filter.customerId }),
        ...(filter.userId && { customer: { territory: { sellerUserId: filter.userId } } }),
      },
      include: { customer: true },
      orderBy: [{ date: 'asc' }, { customer: { name: 'asc' } }],
    });
    const creators = await this.db.user.findMany({
      where: { id: { in: rows.map((r) => r.createdByUserId).filter((x): x is string => !!x) } },
    });
    return rows.map((r) => {
      const creator = creators.find((u) => u.id === r.createdByUserId);
      return {
        id: r.id,
        date: dateOnly(r.date),
        customer: { id: r.customer.id, code: r.customer.code, name: r.customer.name },
        createdBy: creator ? fullName(creator) : null,
      };
    });
  }

  /**
   * Ajoute le client aux clients du jour d'une date précise, sans changer sa fréquence
   * (BR-PLA-05). La date est un jour ouvré, à venir.
   */
  async reschedule(actor: AuthUser, customerId: string, date: string): Promise<RescheduleDto> {
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) throw notFound('Client introuvable.');
    if (customer.status !== 'ACTIVE') throw rule('Ce client est désactivé.');
    if (!customer.territoryId) throw rule("Ce client n'a pas de secteur : placez-le d'abord.");
    const company = await this.companyCalendar();
    if (date < company.today) throw rule('Choisissez une date à venir.');
    const status = dayStatus(date, {
      workingDays: company.workingDays,
      holidays: company.holidays.map((h) => h.date),
      partByWeekday: {},
    });
    if (status.kind === 'HOLIDAY') throw rule('Ce jour est férié.', { rule: 'BR-PLA-04' });
    if (status.kind === 'NON_WORKING')
      throw rule("Ce jour n'est pas travaillé.", { rule: 'BR-PLA-04' });

    // Une reprogrammation annulée occupe encore sa place dans l'index unique : elle est réactivée
    const existing = await this.db.customerReschedule.findFirst({
      where: { customerId, date: toDate(date) },
    });
    if (existing && !existing.deletedAt)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'DUPLICATE',
        'Ce client est déjà reprogrammé à cette date.',
      );
    const id = existing?.id ?? uuidv7();
    if (existing) {
      await this.db.customerReschedule.update({
        where: { id },
        data: { deletedAt: null, createdByUserId: actor.userId, version: { increment: 1 } },
      });
    } else {
      await this.db.customerReschedule.create({
        data: {
          id,
          companyId: actor.companyId,
          customerId,
          date: toDate(date),
          createdByUserId: actor.userId,
        },
      });
    }
    await this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'customer.reschedule',
      entity: 'Customer',
      entityId: customerId,
      after: { date },
    });
    return (await this.reschedules({ customerId })).find((r) => r.id === id)!;
  }

  async cancelReschedule(actor: AuthUser, customerId: string, date: string): Promise<void> {
    const existing = await this.db.customerReschedule.findFirst({
      where: { customerId, date: toDate(date), deletedAt: null },
    });
    if (!existing) throw notFound('Reprogrammation introuvable.');
    await this.db.customerReschedule.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'customer.reschedule_cancel',
      entity: 'Customer',
      entityId: customerId,
      after: { date },
    });
  }
}
