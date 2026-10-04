import { Inject, Injectable } from '@nestjs/common';
import { isPermissionModuleActive } from '@sellwasl/business-rules';
import type {
  SyncOperationInput,
  SyncPushInput,
  SyncPushResponse,
  SyncResult,
} from '@sellwasl/validation';
import { ApiError, forbidden } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { SyncHandlers } from './sync.handlers';

/** Résultat enregistré dans SyncOperation.result, renvoyé tel quel si l'opération revient. */
interface StoredResult {
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** Refus décidé avant le traitement (type inconnu, droit manquant, données invalides). */
class Rejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Erreur métier → motif de refus ; toute autre erreur remonte (500). */
function toRefusal(error: unknown): { code: string; message: string } | null {
  if (error instanceof Rejection) return { code: error.code, message: error.message };
  if (error instanceof ApiError) {
    const body = error.getResponse() as { code: string; message: string };
    return { code: body.code, message: body.message };
  }
  return null;
}

/**
 * Réception des opérations du téléphone (docs/api.md §6.1, architecture §10.2) : idempotence par
 * opId (BR-SYN-02), ordre par deviceSeq, une transaction par opération. Une opération refusée
 * n'empêche pas les suivantes.
 */
@Injectable()
export class SyncService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly handlers: SyncHandlers,
  ) {}

  async push(actor: AuthUser, input: SyncPushInput): Promise<SyncPushResponse> {
    if (actor.channel !== 'MOBILE' || !actor.deviceId)
      throw forbidden('MOBILE_ONLY', 'La synchronisation est réservée au téléphone.');
    if (input.deviceId !== actor.deviceId)
      throw forbidden('DEVICE_MISMATCH', "Cet appareil n'est pas celui de la session.");
    const deviceId = actor.deviceId;

    const last = await this.db.syncOperation.findFirst({
      where: { deviceId },
      orderBy: { deviceSeq: 'desc' },
    });
    let expected = (last?.deviceSeq ?? 0) + 1;
    let gap = false;
    const results: SyncResult[] = [];

    for (const op of input.operations) {
      const known = await this.db.syncOperation.findFirst({ where: { opId: op.opId } });
      if (known) {
        results.push({ opId: op.opId, status: known.status, ...(known.result as StoredResult) });
        continue;
      }
      if (gap || op.deviceSeq > expected) {
        // Une opération manque : le téléphone renverra la suite dans l'ordre
        gap = true;
        results.push({ opId: op.opId, status: 'GAP', result: { expectedDeviceSeq: expected } });
        continue;
      }
      if (op.deviceSeq < expected) {
        results.push({
          opId: op.opId,
          status: 'REJECTED',
          result: { expectedDeviceSeq: expected },
          error: {
            code: 'DUPLICATE',
            message: "Numéro d'opération déjà utilisé sur cet appareil.",
          },
        });
        continue;
      }
      results.push(await this.apply(actor, deviceId, op));
      expected += 1;
    }
    return { results, serverTime: new Date().toISOString() };
  }

  private async apply(
    actor: AuthUser,
    deviceId: string,
    op: SyncOperationInput,
  ): Promise<SyncResult> {
    const record = (
      tx: Pick<Prisma.TransactionClient, 'syncOperation'>,
      status: 'APPLIED' | 'REJECTED',
      stored: StoredResult,
    ) =>
      tx.syncOperation.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          opId: op.opId,
          deviceSeq: op.deviceSeq,
          type: op.type,
          payload: (op.payload ?? {}) as Prisma.InputJsonValue,
          status,
          result: stored as Prisma.InputJsonValue,
          errorCode: stored.error?.code ?? null,
          occurredAt: new Date(op.occurredAt),
          deviceId,
          userId: actor.userId,
        },
      });

    try {
      const handler = this.handlers.get(op.type);
      if (!handler) throw new Rejection('UNKNOWN_OPERATION', `Opération inconnue : ${op.type}.`);
      if (
        !actor.permissions.has(handler.permission) ||
        !isPermissionModuleActive(handler.permission, actor.modules)
      )
        throw new Rejection('FORBIDDEN', "Vous n'avez pas le droit de faire cette action.");
      const parsed = handler.schema.safeParse(op.payload);
      if (!parsed.success)
        throw new Rejection(
          'VALIDATION_ERROR',
          parsed.error.issues.map((i) => i.message).join(' ; ') || 'Données invalides.',
        );

      const result = await this.db.$transaction(async (tenantTx) => {
        const tx = tenantTx as unknown as Prisma.TransactionClient;
        const value = await handler.handle({ actor, op, payload: parsed.data, tx });
        await record(tx, 'APPLIED', { result: value });
        return value;
      });
      return { opId: op.opId, status: 'APPLIED', result };
    } catch (error) {
      const refusal = toRefusal(error);
      if (!refusal) throw error;
      await record(this.db as unknown as Prisma.TransactionClient, 'REJECTED', { error: refusal });
      return { opId: op.opId, status: 'REJECTED', error: refusal };
    }
  }
}
