import { Inject, Injectable } from '@nestjs/common';
import {
  bonusPaymentDate,
  driverBonus,
  driverScore,
  localDate,
  returnRate,
  tierScore,
} from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type DriverObjectiveDto,
  type DriverObjectivesSettings,
  type putDriverObjectivesSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { fullName } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

/** Premier jour du mois suivant, « AAAA-MM-01 ». */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Objectif du livreur (phase 19) : paliers du taux de retour et critères notés sur 10, pondérés,
 * réglés par l'admin ou le superviseur ; prime du mois × score.
 */
@Injectable()
export class DriverObjectivesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private async companySettings() {
    const row = await this.db.companySettings.findFirst({ orderBy: { version: 'desc' } });
    return { row, data: companySettingsSchema.parse(row?.data ?? {}) };
  }

  async settings(): Promise<DriverObjectivesSettings> {
    return (await this.companySettings()).data.driverObjectives;
  }

  async setSettings(
    actor: AuthUser,
    input: DriverObjectivesSettings,
  ): Promise<DriverObjectivesSettings> {
    if (new Set(input.criteria.map((c) => c.id)).size !== input.criteria.length)
      throw rule('Deux critères ont le même identifiant.');
    const returnTiers = [...input.returnTiers].sort((a, b) => a.maxRate - b.maxRate);
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
      const data = companySettingsSchema.parse(row?.data ?? {});
      await tx.companySettings.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          version: (row?.version ?? 0) + 1,
          data: { ...data, driverObjectives: { ...input, returnTiers } },
          createdByUserId: actor.userId,
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'driver_objectives.settings',
          entity: 'CompanySettings',
          after: { ...input, returnTiers },
        },
        tx,
      );
    });
    return { ...input, returnTiers };
  }

  /** Objectifs d'un mois : un par livreur actif (ou seulement `userId`). */
  async list(month: string, userId?: string): Promise<DriverObjectiveDto[]> {
    const { data } = await this.companySettings();
    const rules = data.driverObjectives;
    const drivers = await this.db.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        role: { code: 'LIVREUR' },
        ...(userId ? { id: userId } : {}),
      },
      orderBy: { code: 'asc' },
    });
    const range = { gte: toDate(`${month}-01`), lt: toDate(nextMonth(month)) };
    const [objectives, lines] = await Promise.all([
      this.db.driverObjective.findMany({
        where: {
          month: toDate(`${month}-01`),
          deletedAt: null,
          userId: { in: drivers.map((d) => d.id) },
        },
      }),
      this.db.unloadLine.findMany({
        where: {
          unload: {
            userId: { in: drivers.map((d) => d.id) },
            status: 'VALIDATED',
            date: range,
            deletedAt: null,
          },
        },
        include: { unload: true },
      }),
    ]);
    const paymentDate = bonusPaymentDate(month, data.objectivePaymentDelayMonths);
    return drivers.map((d) => {
      const objective = objectives.find((o) => o.userId === d.id);
      const own = lines.filter((l) => l.unload.userId === d.id);
      const loaded = own.reduce((sum, l) => sum + l.loadedQty, 0);
      const returned = own.reduce((sum, l) => sum + l.countedQty, 0);
      const rate = returnRate(loaded, returned);
      const returnScore = tierScore(rate, rules.returnTiers);
      const ratings = (objective?.ratings ?? {}) as Record<string, number>;
      const score = driverScore({
        returnWeight: rules.returnWeight,
        returnScore,
        criteria: rules.criteria.map((c) => ({ weight: c.weight, rating: ratings[c.id] ?? 0 })),
      });
      const bonusAmount = Number(objective?.bonusAmount ?? 0n);
      return {
        month,
        user: { id: d.id, code: d.code, name: fullName(d) },
        bonusAmount,
        ratings,
        loaded,
        returned,
        returnRate: rate,
        returnScore,
        score,
        estimatedBonus: driverBonus(bonusAmount, score),
        paymentDate,
      };
    });
  }

  async put(
    actor: AuthUser,
    input: z.output<typeof putDriverObjectivesSchema>,
  ): Promise<DriverObjectiveDto[]> {
    const { data } = await this.companySettings();
    const criteria = new Set(data.driverObjectives.criteria.map((c) => c.id));
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const drivers = await tx.user.findMany({
        where: { id: { in: input.entries.map((e) => e.userId) }, role: { code: 'LIVREUR' } },
      });
      if (drivers.length !== new Set(input.entries.map((e) => e.userId)).size)
        throw rule('Les objectifs de livreur ne concernent que les livreurs.');
      const month = toDate(`${input.month}-01`);
      for (const e of input.entries) {
        if (Object.keys(e.ratings).some((id) => !criteria.has(id)))
          throw rule('Critère inconnu : réglez d’abord les critères de l’objectif.');
        const existing = await tx.driverObjective.findFirst({
          where: { userId: e.userId, month, deletedAt: null },
        });
        if (existing)
          await tx.driverObjective.update({
            where: { id: existing.id },
            data: {
              bonusAmount: BigInt(e.bonusAmount),
              ratings: e.ratings,
              version: { increment: 1 },
            },
          });
        else
          await tx.driverObjective.create({
            data: {
              id: uuidv7(),
              companyId: actor.companyId,
              userId: e.userId,
              month,
              bonusAmount: BigInt(e.bonusAmount),
              ratings: e.ratings,
              createdByUserId: actor.userId,
            },
          });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'driver_objectives.update',
          entity: 'DriverObjective',
          after: { month: input.month, entries: input.entries },
        },
        tx,
      );
    });
    return this.list(input.month);
  }

  /** Objectif du livreur connecté : mois en cours, et précédent si la prime est versée après. */
  async mine(actor: AuthUser): Promise<DriverObjectiveDto[]> {
    const company = await this.db.company.findFirstOrThrow();
    const { data } = await this.companySettings();
    const current = localDate(new Date(), company.timezone).slice(0, 7);
    const months = [current];
    if (data.objectivePaymentDelayMonths === 1) {
      const [y, m] = current.split('-').map(Number) as [number, number];
      months.push(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
    }
    const result: DriverObjectiveDto[] = [];
    for (const month of months) result.push(...(await this.list(month, actor.userId)));
    return result;
  }
}
