import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { ApiError } from './api-error';
import { prismaCode, VERSION_GUARD, type VersionGuard, versionConflict } from './version-guard';

export const VERSIONED = 'versioned';
export interface VersionedTarget {
  /** Délégué Prisma de la fiche (camelCase). */
  model: string;
  /** Paramètre de chemin qui porte l'identifiant de la fiche. */
  param: string;
  /** Fiche versionnée par lignes successives (paramètres) : comparée à la dernière. */
  latest: boolean;
}

/**
 * Fiche modifiable depuis le Web (api.md §1, phase 25) : une `version` envoyée dans le corps
 * doit être celle de la base, sinon `409 VERSION_CONFLICT` et rien n'est écrit.
 */
export const Versioned = (model: string, options: { param?: string; latest?: boolean } = {}) =>
  SetMetadata(VERSIONED, {
    model,
    param: options.param ?? 'id',
    latest: options.latest ?? false,
  } satisfies VersionedTarget);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type VersionDelegate = {
  findFirst(args: object): Promise<{ version: number } | null>;
};

/**
 * Contrôle de version des routes `@Versioned()`. Vérifie la version avant d'exécuter (réponse
 * claire), puis laisse la version attendue dans le contexte : le client Prisma l'ajoute à la
 * mise à jour de la fiche (tenant-prisma), ce qui ferme la course entre lecture et écriture.
 */
@Injectable()
export class VersionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = this.reflector.get<VersionedTarget | undefined>(VERSIONED, context.getHandler());
    if (!target) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const version = (req.body as { version?: unknown } | undefined)?.version;
    if (version === undefined || version === null) return next.handle();
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Données invalides.', {
        fields: [{ path: 'version', message: 'Version invalide.' }],
      });
    return from(this.run(target, req, version, next));
  }

  private delegate(model: string) {
    return (this.db as unknown as Record<string, VersionDelegate>)[model]!;
  }

  private async current(target: VersionedTarget, id: string) {
    const row = target.latest
      ? await this.delegate(target.model).findFirst({
          orderBy: { version: 'desc' },
          select: { version: true },
        })
      : await this.delegate(target.model).findFirst({ where: { id }, select: { version: true } });
    return row?.version;
  }

  private async run(target: VersionedTarget, req: Request, version: number, next: CallHandler) {
    const id = String(req.params[target.param] ?? '');
    // Identifiant illisible : la validation de la route répond 400, comme sans version
    if (!target.latest && !UUID.test(id))
      return lastValueFrom(next.handle(), { defaultValue: undefined });
    const current = await this.current(target, id);
    // Fiche absente : le service répond 404 comme sans version
    if (current === undefined) return lastValueFrom(next.handle(), { defaultValue: undefined });
    if (current !== version) throw versionConflict(current);
    if (!target.latest) {
      const model = target.model[0]!.toUpperCase() + target.model.slice(1);
      this.cls.set<VersionGuard>(VERSION_GUARD, { model, id, version });
    }
    try {
      return await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (error) {
      // Perdu la course : une autre modification est passée entre la vérification et l'écriture
      const lost =
        (error instanceof ApiError &&
          (error.getResponse() as { code?: string }).code === 'VERSION_CONFLICT') ||
        (target.latest && prismaCode(error) === 'P2002');
      if (lost) throw versionConflict(await this.current(target, id));
      throw error;
    } finally {
      if (!target.latest) this.cls.set(VERSION_GUARD, undefined);
    }
  }
}
