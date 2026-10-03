import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MODULE_CODES,
  type ModuleCode,
  modulesForMode,
  type SalesMode,
} from '@sellwasl/business-rules';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';

/** Durée du cache des modules actifs (docs/modules.md §7). */
const CACHE_TTL_MS = 60_000;

export interface ModeChangeBlocker {
  module: ModuleCode;
  reason: string;
  count: number;
}

@Injectable()
export class ModulesService {
  private readonly cache = new Map<string, { modules: ModuleCode[]; expiresAt: number }>();

  // Accès système : le mode d'une entreprise est géré par la plateforme.
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async activeModules(companyId: string): Promise<ModuleCode[]> {
    const cached = this.cache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached.modules;
    const rows = await this.prisma.companyModule.findMany({
      where: { companyId, status: 'ACTIVE' },
    });
    const modules = rows
      .map((r) => r.moduleCode)
      .sort((a, b) => MODULE_CODES.indexOf(a) - MODULE_CODES.indexOf(b));
    this.cache.set(companyId, { modules, expiresAt: Date.now() + CACHE_TTL_MS });
    return modules;
  }

  invalidate(companyId: string): void {
    this.cache.delete(companyId);
  }

  /** Travail en cours qui empêche de retirer des modules (docs/modules.md §8). */
  async modeChangeBlockers(
    companyId: string,
    removed: readonly ModuleCode[],
  ): Promise<ModeChangeBlocker[]> {
    const blockers: ModeChangeBlocker[] = [];
    const add = (module: ModuleCode, reason: string, count: number) => {
      if (count > 0) blockers.push({ module, reason, count });
    };
    const openWorkdays = (role: 'PRE_VENDEUR' | 'LIVREUR' | 'VENDEUR_CASH_VAN') =>
      this.prisma.workday.count({
        where: { companyId, status: 'IN_PROGRESS', user: { role: { code: role } } },
      });
    const unsettled = (role: 'PRE_VENDEUR' | 'LIVREUR' | 'VENDEUR_CASH_VAN') =>
      this.prisma.workday.count({
        where: {
          companyId,
          status: 'CLOSED',
          expectedCashAmount: { gt: 0 },
          settlement: null,
          user: { role: { code: role } },
        },
      });

    if (removed.includes('PRE_SALES')) {
      add('PRE_SALES', 'journées de pré-vendeurs en cours', await openWorkdays('PRE_VENDEUR'));
      add(
        'PRE_SALES',
        'commandes de prévente pas encore livrées',
        await this.prisma.order.count({
          where: {
            companyId,
            source: { in: ['PRE_SALES', 'PHONE'] },
            status: { in: ['CONFIRMED', 'LOCKED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] },
          },
        }),
      );
      add('PRE_SALES', 'journées de pré-vendeurs sans versement', await unsettled('PRE_VENDEUR'));
    }
    if (removed.includes('DELIVERY')) {
      add('DELIVERY', 'journées de livreurs en cours', await openWorkdays('LIVREUR'));
      add(
        'DELIVERY',
        'tournées non clôturées',
        await this.prisma.deliveryRoute.count({ where: { companyId, status: { not: 'CLOSED' } } }),
      );
      add('DELIVERY', 'journées de livreurs sans versement', await unsettled('LIVREUR'));
    }
    if (removed.includes('CASH_VAN')) {
      add(
        'CASH_VAN',
        'journées de vendeurs cash van en cours',
        await openWorkdays('VENDEUR_CASH_VAN'),
      );
      add(
        'CASH_VAN',
        'chargements cash van non reçus',
        await this.prisma.load.count({
          where: { companyId, kind: { in: ['CASH_VAN', 'RELOAD'] }, status: { not: 'RECEIVED' } },
        }),
      );
      add(
        'CASH_VAN',
        'journées de vendeurs cash van sans versement',
        await unsettled('VENDEUR_CASH_VAN'),
      );
    }
    if (removed.length > 0) {
      add(
        removed[0]!,
        'déchargements non validés',
        await this.prisma.unload.count({
          where: { companyId, status: 'DRAFT', user: { role: { code: { in: rolesOf(removed) } } } },
        }),
      );
    }
    return blockers;
  }

  /** Changement de mode par le Super Admin : ajout toujours possible, retrait si rien n'est en cours. */
  async changeMode(
    companyId: string,
    mode: SalesMode,
    platformUserId: string,
  ): Promise<{ modules: ModuleCode[] }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw notFound('Entreprise introuvable.');
    const target = modulesForMode(mode);
    const current = await this.prisma.companyModule.findMany({
      where: { companyId, status: 'ACTIVE' },
    });
    const removed = current.map((m) => m.moduleCode).filter((m) => !target.includes(m));

    const blockers = await this.modeChangeBlockers(companyId, removed);
    if (blockers.length > 0) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'INVALID_STATE',
        'Du travail est en cours dans les modules retirés.',
        { blockers },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const wasActive = new Set(current.map((m) => m.moduleCode));
      for (const moduleCode of MODULE_CODES) {
        const active = target.includes(moduleCode);
        if (active === wasActive.has(moduleCode)) continue; // inchangé : on garde ses dates
        await tx.companyModule.upsert({
          where: { companyId_moduleCode: { companyId, moduleCode } },
          create: { id: uuidv7(), companyId, moduleCode, status: 'ACTIVE', activatedAt: now },
          update: active
            ? { status: 'ACTIVE', activatedAt: now, deactivatedAt: null }
            : { status: 'INACTIVE', deactivatedAt: now },
        });
      }
      await tx.company.update({ where: { id: companyId }, data: { mode } });
      const change = { before: { mode: company.mode }, after: { mode, modules: target } };
      await tx.platformAuditLog.create({
        data: {
          id: uuidv7(),
          platformUserId,
          companyId,
          action: 'company.mode.change',
          entity: 'Company',
          entityId: companyId,
          ...change,
        },
      });
      await this.audit.write(
        {
          companyId,
          actorUserId: null,
          action: 'company.mode.change',
          entity: 'Company',
          entityId: companyId,
          ...change,
        },
        tx,
      );
    });
    this.invalidate(companyId);
    return { modules: [...target] };
  }
}

function rolesOf(
  modules: readonly ModuleCode[],
): ('PRE_VENDEUR' | 'LIVREUR' | 'VENDEUR_CASH_VAN')[] {
  const roles: ('PRE_VENDEUR' | 'LIVREUR' | 'VENDEUR_CASH_VAN')[] = [];
  if (modules.includes('DELIVERY')) roles.push('LIVREUR');
  if (modules.includes('CASH_VAN')) roles.push('VENDEUR_CASH_VAN');
  return roles;
}
