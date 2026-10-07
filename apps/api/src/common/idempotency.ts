import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { ApiError } from './api-error';
import type { AuthUser } from './auth-context';
import { uuidv7 } from './uuid';

export const IDEMPOTENT = 'idempotent';

/**
 * Création d'argent ou de stock rejouable sans effet (api.md §1, phase 25) : avec l'en-tête
 * `Idempotency-Key`, un double clic ou un renvoi ne crée qu'une seule fois.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/** Une réponse est gardée 24 h. */
const TTL_MS = 24 * 3600_000;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * Applique `Idempotency-Key` sur les routes `@Idempotent()` : première requête exécutée et sa
 * réponse gardée ; même clé et même contenu → même réponse ; autre contenu → 422 ; requête en
 * cours → 409. Une erreur libère la clé (on peut réessayer).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    if (!this.reflector.get<boolean>(IDEMPOTENT, handler)) return next.handle();
    const req = context.switchToHttp().getRequest<Request & { principal?: AuthUser }>();
    const key = req.header('idempotency-key');
    if (!key) return next.handle();
    const actor = req.principal;
    if (!actor?.companyId) return next.handle();
    return from(this.run(context, next, req, key, actor));
  }

  private async run(
    context: ExecutionContext,
    next: CallHandler,
    req: Request,
    key: string,
    actor: AuthUser,
  ): Promise<unknown> {
    if (!KEY.test(key))
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'En-tête Idempotency-Key invalide (8 à 100 caractères).',
      );
    const res = context.switchToHttp().getResponse<Response>();
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');
    const path = req.path;

    const id = uuidv7();
    if (!(await this.claim(id, key, req.method, path, requestHash, actor))) {
      const known = await this.db.idempotencyKey.findFirst({ where: { key } });
      if (!known) return this.run(context, next, req, key, actor);
      if (known.requestHash !== requestHash || known.method !== req.method || known.path !== path)
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'IDEMPOTENCY_MISMATCH',
          'Cette clé a déjà servi pour une autre requête.',
        );
      if (known.status !== 'DONE')
        throw new ApiError(
          HttpStatus.CONFLICT,
          'IN_PROGRESS',
          'La même requête est déjà en cours. Patientez.',
        );
      res.status(known.responseStatus ?? HttpStatus.OK);
      return known.responseBody;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined) ??
        (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
      await this.db.idempotencyKey.updateMany({
        where: { id },
        data: {
          status: 'DONE',
          responseStatus: status,
          responseBody: (body ?? null) as Prisma.InputJsonValue,
        },
      });
      return body;
    } catch (error) {
      // Refusée ou en échec : rien n'a été créé, la même clé peut resservir
      await this.db.idempotencyKey.deleteMany({ where: { id } });
      throw error;
    }
  }

  /** Réserve la clé ; une clé expirée est libérée. Faux si elle existe déjà. */
  private async claim(
    id: string,
    key: string,
    method: string,
    path: string,
    requestHash: string,
    actor: AuthUser,
  ): Promise<boolean> {
    // Clés expirées de l'entreprise supprimées au passage : la table reste petite
    await this.db.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - TTL_MS) } },
    });
    const { count } = await this.db.idempotencyKey.createMany({
      data: [
        {
          id,
          key,
          method,
          path,
          requestHash,
          status: 'IN_PROGRESS',
          companyId: actor.companyId,
          userId: actor.userId,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
