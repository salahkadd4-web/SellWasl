import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { localDate } from '@sellwasl/business-rules';
import { companySettingsSchema } from '@sellwasl/validation';
import { ClsService } from 'nestjs-cls';
import { dateOnly, toDate } from '../field/field-errors';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_KEY } from '../tenancy/tenant-prisma';
import { IncentivesService } from './incentives.service';
import { shiftMonth, systemActor } from './payroll-common';
import { PayrollService } from './payroll.service';

/** Verrou PostgreSQL : une seule exécution à la fois, même avec plusieurs instances de l'API. */
const LOCK_KEY = 21_0062_1;

export interface AutomationReport {
  companyId: string;
  /** Jour traité (la veille, dans le fuseau de l'entreprise). */
  date: string;
  incentives: number;
  /** Mois dont la paie a été créée ou recalculée. */
  payrollMonths: string[];
  error?: string;
}

/**
 * Automatisation de la paie (phase 21 bis) : chaque nuit, pour chaque entreprise dont la paie est
 * activée, calcul des primes de la semaine et du mois qui contiennent la veille, puis création et
 * recalcul du brouillon de paie du mois (et du mois précédent s'il n'est pas approuvé). Les
 * validations, l'approbation et les paiements restent faits par le comptable.
 */
@Injectable()
export class PayrollAutomationService {
  private readonly logger = new Logger(PayrollAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly incentives: IncentivesService,
    private readonly payroll: PayrollService,
  ) {}

  @Cron('0 15 2 * * *', { name: 'payroll-automation' })
  async nightly(): Promise<void> {
    const reports = await this.run();
    for (const r of reports)
      if (r.error) this.logger.error(`Paie automatique ${r.companyId} : ${r.error}`);
    this.logger.log(`Paie automatique : ${reports.length} entreprise(s) traitée(s).`);
  }

  /** Une exécution ; `now` permet de rejouer une date (tests, rattrapage). */
  async run(now = new Date()): Promise<AutomationReport[]> {
    const [lock] = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`;
    if (!lock?.ok) return [];
    try {
      const companies = await this.prisma.company.findMany({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      });
      const reports: AutomationReport[] = [];
      for (const company of companies) {
        const row = await this.prisma.companySettings.findFirst({
          where: { companyId: company.id },
          orderBy: { version: 'desc' },
        });
        if (!companySettingsSchema.parse(row?.data ?? {}).payroll.enabled) continue;
        reports.push(
          await this.cls.run(async () => {
            this.cls.set(TENANT_KEY, company.id);
            return this.forCompany(company.id, localDate(now, company.timezone));
          }),
        );
      }
      return reports;
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async forCompany(companyId: string, today: string): Promise<AutomationReport> {
    const date = dateOnly(new Date(toDate(today).getTime() - 86_400_000));
    const report: AutomationReport = { companyId, date, incentives: 0, payrollMonths: [] };
    const actor = systemActor(companyId);
    try {
      for (const frequency of ['WEEKLY', 'MONTHLY'] as const)
        report.incentives += (await this.incentives.calculate(actor, { date, frequency })).length;
      const month = date.slice(0, 7);
      for (const m of [shiftMonth(month, -1), month]) {
        const existing = await this.prisma.payrollPeriod.findFirst({
          where: { companyId, month: toDate(`${m}-01`), deletedAt: null },
        });
        // Le brouillon du mois en cours est créé ; un mois passé n'est repris que s'il existe
        const period = existing ?? (m === month ? await this.payroll.create(actor, m) : null);
        if (!period || !['OPEN', 'CALCULATED'].includes(period.status)) continue;
        await this.payroll.calculate(actor, period.id);
        report.payrollMonths.push(m);
      }
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
    }
    return report;
  }
}
