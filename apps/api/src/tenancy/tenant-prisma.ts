import { ClsService } from 'nestjs-cls';
import { Prisma } from '../generated/prisma/client';
import { guardedQuery } from '../common/version-guard';
import { PrismaService } from '../prisma/prisma.service';

/** Clé du contexte de requête (nestjs-cls) qui porte l'entreprise de l'utilisateur. */
export const TENANT_KEY = 'companyId';
export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

/** Tables d'entreprise : celles qui ont une colonne company_id (docs/database.md §1.2). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Object.values(Prisma.ModelName).filter((model) => {
    if (model === 'PlatformAuditLog') return false; // audit plateforme : company_id facultatif
    const fields = (Prisma as unknown as Record<string, Record<string, string> | undefined>)[
      `${model}ScalarFieldEnum`
    ];
    return !!fields && 'companyId' in fields;
  }),
);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

export class TenantViolationError extends Error {}

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

function withCompany(row: unknown, companyId: string, model: string): Record<string, unknown> {
  const data = { ...(row as Record<string, unknown>) };
  if ('company' in data)
    throw new TenantViolationError(`${model} : utilisez companyId, pas la relation company.`);
  if (data.companyId !== undefined && data.companyId !== companyId) {
    throw new TenantViolationError(`${model} : écriture refusée dans une autre entreprise.`);
  }
  data.companyId = companyId;
  return data;
}

/** Filtre ajouté au where : company_id pour les tables d'entreprise, id pour Company. */
function scopeWhere(where: Record<string, unknown> | undefined, model: string, companyId: string) {
  const key = model === 'Company' ? 'id' : 'companyId';
  if (where?.[key] !== undefined && where[key] !== companyId) {
    throw new TenantViolationError(`${model} : lecture refusée dans une autre entreprise.`);
  }
  return { ...where, [key]: companyId };
}

/**
 * Client Prisma filtré par entreprise (ARC-02, phase 5) :
 * - ajoute company_id à toutes les lectures, mises à jour et suppressions ;
 * - renseigne company_id à la création et refuse une autre valeur ;
 * - refuse toute requête sur une table d'entreprise sans entreprise dans le contexte.
 * Les relations incluses (include) ne sont pas filtrées : elles pointent toujours vers la même
 * entreprise, puisque toute écriture passe par ce client.
 */
export function createTenantPrisma(prisma: PrismaService, cls: ClsService) {
  return prisma.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = model === 'Company' || TENANT_MODELS.has(model);
          if (!scoped) return query(args);
          const companyId = cls.isActive() ? cls.get<string | undefined>(TENANT_KEY) : undefined;
          if (!companyId) {
            throw new TenantViolationError(
              `${model}.${operation} : aucune entreprise dans le contexte de la requête.`,
            );
          }
          const next = { ...(args as Args) };
          if (WHERE_OPERATIONS.has(operation))
            next.where = scopeWhere(next.where, model, companyId);
          if (model !== 'Company') {
            if (CREATE_OPERATIONS.has(operation)) {
              next.data = Array.isArray(next.data)
                ? next.data.map((row) => withCompany(row, companyId, model))
                : withCompany(next.data, companyId, model);
            }
            if (operation === 'upsert') next.create = withCompany(next.create, companyId, model);
            if (['update', 'updateMany', 'updateManyAndReturn', 'upsert'].includes(operation)) {
              const data = (operation === 'upsert' ? next.update : next.data) as
                Record<string, unknown> | undefined;
              if (data && 'companyId' in data && data.companyId !== companyId) {
                throw new TenantViolationError(`${model} : changement d'entreprise interdit.`);
              }
            }
          } else if (CREATE_OPERATIONS.has(operation) || operation === 'upsert') {
            throw new TenantViolationError('Company : création réservée à la plateforme.');
          }
          // Fiche gardée par sa version (phase 25) : mise à jour conditionnelle
          const guarded = await guardedQuery(cls, model, operation, next, query as never);
          if (guarded) return guarded.result;
          return query(next as typeof args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof createTenantPrisma>;
