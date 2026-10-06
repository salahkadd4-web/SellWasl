import { companySettingsSchema, type PayrollSettings } from '@sellwasl/validation';
import type { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

/** Utilisateur avec son rôle, pour les DTO (`personOf`). */
export const WITH_ROLE = { include: { role: true } } as const;

/** Premier et dernier jour d'un mois AAAA-MM. */
export function monthRange(month: string): { start: Date; end: Date } {
  const start = toDate(`${month}-01`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start, end };
}

export const monthOf = (d: Date) => dateOnly(d).slice(0, 7);

/** Mois décalé de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const d = toDate(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return monthOf(d);
}

/** Paramètres de paie de l'entreprise (dernière version). */
export async function payrollSettings(tx: Pick<Tx, 'companySettings'>): Promise<PayrollSettings> {
  const row = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
  return companySettingsSchema.parse(row?.data ?? {}).payroll;
}

export async function assertPayrollEnabled(
  tx: Pick<Tx, 'companySettings'>,
): Promise<PayrollSettings> {
  const settings = await payrollSettings(tx);
  if (!settings.enabled)
    throw rule("La paie n'est pas activée dans les paramètres de l'entreprise.");
  return settings;
}

/**
 * Rémunération d'un employé pour un mois : celle en vigueur le premier jour, sinon la première
 * qui commence dans le mois ; null s'il n'en a pas.
 */
export async function salaryFor(
  tx: Pick<Tx, 'employeeCompensation'>,
  userId: string,
  month: string,
): Promise<{ id: string; baseSalary: bigint } | null> {
  const { start, end } = monthRange(month);
  const rows = await tx.employeeCompensation.findMany({
    where: {
      userId,
      deletedAt: null,
      effectiveFrom: { lte: end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
    },
    orderBy: { effectiveFrom: 'asc' },
  });
  const atStart = [...rows].reverse().find((r) => r.effectiveFrom <= start);
  return atStart ?? rows[0] ?? null;
}

/** Écrit une ligne d'audit financière (avant, après) dans la transaction. */
export function audit(
  service: AuditService,
  tx: Tx,
  actor: AuthUser,
  action: string,
  entity: string,
  entityId: string | null,
  before: Prisma.InputJsonValue | undefined,
  after: Prisma.InputJsonValue,
) {
  return service.write(
    {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      deviceId: actor.deviceId,
      action,
      entity,
      ...(entityId && { entityId }),
      ...(before !== undefined && { before }),
      after,
    },
    tx,
  );
}

/** Noms des utilisateurs dont on a l'identifiant (auteurs des décisions). */
export async function namesOf(
  db: { user: { findMany: Tx['user']['findMany'] } },
  ids: (string | null | undefined)[],
): Promise<(id: string | null | undefined) => string | null> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const users = wanted.length ? await db.user.findMany({ where: { id: { in: wanted } } }) : [];
  return (id) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : null;
  };
}
