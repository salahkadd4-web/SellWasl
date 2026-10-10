import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditFilters,
  type auditQuerySchema,
  type AuditRowDto,
  type Page,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { toCsv } from '../common/csv';
import { paginate } from '../common/pagination';
import type { Prisma } from '../generated/prisma/client';
import { localRange } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

/** Plafond de l'export du journal (phase 26). */
export const AUDIT_EXPORT_MAX = 10_000;

type Row = Prisma.AuditLogGetPayload<{ include: { actorUser: true } }>;

function toRow(r: Row): AuditRowDto {
  const action = r.action as AuditAction;
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    action,
    actionLabel: AUDIT_ACTIONS[action] ?? r.action,
    entity: r.entity,
    entityLabel: AUDIT_ENTITIES[r.entity as keyof typeof AUDIT_ENTITIES] ?? r.entity,
    entityId: r.entityId,
    actor: r.actorUser
      ? {
          id: r.actorUser.id,
          code: r.actorUser.code,
          name: `${r.actorUser.firstName} ${r.actorUser.lastName}`,
        }
      : null,
    deviceId: r.deviceId,
    ip: r.ip,
    userAgent: r.userAgent,
    reason: r.reason,
    before: r.before,
    after: r.after,
  };
}

/** Consultation du journal d'audit de l'entreprise, par l'admin (phase 26). */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /** Filtre Prisma ; la période suit les jours locaux de l'entreprise. */
  private async where(f: AuditFilters): Promise<Prisma.AuditLogWhereInput> {
    let createdAt: { gte: Date; lt: Date } | undefined;
    if (f.from || f.to) {
      const company = await this.db.company.findFirstOrThrow();
      createdAt = localRange(
        f.from ?? '2000-01-01',
        f.to ?? localDate(new Date(), company.timezone),
        company.timezone,
      );
    }
    return {
      ...(f.userId && { actorUserId: f.userId }),
      ...(f.entity && { entity: f.entity }),
      ...(f.entityId && { entityId: f.entityId }),
      ...(f.action && { action: f.action }),
      ...(createdAt && { createdAt }),
    };
  }

  async list(q: z.output<typeof auditQuerySchema>): Promise<Page<AuditRowDto>> {
    const where = await this.where(q);
    return paginate(
      q,
      (p) =>
        this.db.auditLog.findMany({
          where: { AND: [where, p.after] },
          include: { actorUser: true },
          orderBy: p.orderBy,
          take: p.take,
        }),
      () => this.db.auditLog.count({ where }),
      (rows) => rows.map(toRow),
    );
  }

  /** CSV des mêmes filtres, les plus récentes d'abord, 10 000 lignes au plus. */
  async csv(f: AuditFilters): Promise<string> {
    const rows = await this.db.auditLog.findMany({
      where: await this.where(f),
      include: { actorUser: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AUDIT_EXPORT_MAX,
    });
    const json = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v));
    return toCsv(
      [
        'Date',
        'Utilisateur',
        'Code',
        'Action',
        'Fiche',
        'Identifiant',
        'Appareil',
        'IP',
        'Navigateur',
        'Motif',
        'Avant',
        'Après',
      ],
      rows
        .map(toRow)
        .map((r) => [
          r.at,
          r.actor?.name ?? '',
          r.actor?.code ?? '',
          r.actionLabel,
          r.entityLabel,
          r.entityId,
          r.deviceId,
          r.ip,
          r.userAgent,
          r.reason,
          json(r.before),
          json(r.after),
        ]),
    );
  }
}
