import { Injectable } from '@nestjs/common';
import type { OperationType, SyncOperationInput } from '@sellwasl/validation';
import type { z, ZodType } from 'zod';
import type { AuthUser } from '../common/auth-context';
import type { Prisma } from '../generated/prisma/client';

/** Ce que reçoit le traitement d'une opération, dans sa propre transaction. */
export interface OperationContext<P> {
  actor: AuthUser;
  op: SyncOperationInput;
  payload: P;
  /** Transaction du client filtré par entreprise. */
  tx: Prisma.TransactionClient;
}

/** Lève une ApiError pour refuser l'opération ; renvoie le résultat envoyé au téléphone. */
export type OperationHandler<P> = (ctx: OperationContext<P>) => Promise<Record<string, unknown>>;

interface Registered {
  permission: string;
  schema: ZodType;
  handle: OperationHandler<unknown>;
}

/** Registre des types d'opérations (docs/api.md §7) : chaque module métier y inscrit les siens. */
@Injectable()
export class SyncHandlers {
  private readonly handlers = new Map<string, Registered>();

  register<S extends ZodType>(
    type: OperationType,
    permission: string,
    schema: S,
    handle: OperationHandler<z.output<S>>,
  ): void {
    this.handlers.set(type, { permission, schema, handle: handle as OperationHandler<unknown> });
  }

  get(type: string): Registered | undefined {
    return this.handlers.get(type);
  }
}
