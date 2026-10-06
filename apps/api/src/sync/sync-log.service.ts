import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  OPERATION_LABELS,
  type Page,
  type SyncChange,
  type SyncOperationRowDto,
  type SyncOperationsQuery,
} from '@sellwasl/validation';
import { ApiError } from '../common/api-error';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

interface StoredResult {
  error?: { code: string; message: string };
  changes?: SyncChange[];
}

/** Curseur opaque : heure de réception et id de la dernière opération de la page. */
function encodeCursor(row: { receivedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.receivedAt.toISOString(), row.id])).toString('base64url');
}
function decodeCursor(cursor: string): Prisma.SyncOperationWhereInput {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    const receivedAt = new Date(at);
    return { OR: [{ receivedAt: { lt: receivedAt } }, { receivedAt, id: { lt: id } }] };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Curseur invalide.');
  }
}

/** Journal de synchronisation pour le diagnostic (BR-SYN-07) : opérations reçues des téléphones. */
@Injectable()
export class SyncLogService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  async list(query: SyncOperationsQuery): Promise<Page<SyncOperationRowDto>> {
    const where: Prisma.SyncOperationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.syncOperation.findMany({
        where: query.cursor ? { AND: [where, decodeCursor(query.cursor)] } : where,
        include: { user: true },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.db.syncOperation.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => {
        const stored = (r.result ?? {}) as StoredResult;
        return {
          id: r.id,
          opId: r.opId,
          type: r.type,
          typeLabel: OPERATION_LABELS[r.type] ?? r.type,
          status: r.status as SyncOperationRowDto['status'],
          errorCode: r.errorCode,
          errorMessage: stored.error?.message ?? null,
          changes: stored.changes ?? [],
          occurredAt: r.occurredAt.toISOString(),
          receivedAt: r.receivedAt.toISOString(),
          user: {
            id: r.user.id,
            code: r.user.code,
            name: `${r.user.firstName} ${r.user.lastName}`,
          },
          deviceId: r.deviceId,
        };
      }),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
      total,
    };
  }
}
