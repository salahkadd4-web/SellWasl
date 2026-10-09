import { HttpStatus } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { ApiError } from './api-error';

/** Clé du contexte de requête : version attendue de la fiche modifiée. */
export const VERSION_GUARD = 'versionGuard';

export interface VersionGuard {
  /** Modèle Prisma (PascalCase), tel que le reçoit l'extension du client. */
  model: string;
  id: string;
  version: number;
}

export const versionConflict = (current?: number) =>
  new ApiError(
    HttpStatus.CONFLICT,
    'VERSION_CONFLICT',
    "Fiche modifiée entre-temps par quelqu'un d'autre : rechargez la page.",
    current !== undefined ? { current } : undefined,
  );

export const prismaCode = (error: unknown) => (error as { code?: unknown } | null)?.code;

/**
 * Appelé par le client Prisma de l'entreprise : sur la première mise à jour de la fiche gardée,
 * ajoute la version attendue au filtre (et l'avance, pour les tables sans déclencheur). Aucune ligne
 * touchée : `VERSION_CONFLICT`.
 */
export async function guardedQuery(
  cls: ClsService,
  model: string,
  operation: string,
  args: { where?: Record<string, unknown>; data?: unknown },
  query: (args: never) => Promise<unknown>,
): Promise<{ result: unknown } | null> {
  if (operation !== 'update' && operation !== 'updateMany') return null;
  const guard = cls.isActive() ? cls.get<VersionGuard | undefined>(VERSION_GUARD) : undefined;
  if (!guard || guard.model !== model || args.where?.id !== guard.id) return null;
  cls.set(VERSION_GUARD, undefined);
  const data = (args.data ?? {}) as Record<string, unknown>;
  const next = {
    ...args,
    where: { ...args.where, version: guard.version },
    data: 'version' in data ? data : { ...data, version: { increment: 1 } },
  };
  try {
    const result = await query(next as never);
    if (operation === 'updateMany' && (result as { count: number }).count === 0)
      throw versionConflict();
    return { result };
  } catch (error) {
    if (prismaCode(error) === 'P2025') throw versionConflict();
    throw error;
  }
}
