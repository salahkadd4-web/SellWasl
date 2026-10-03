import { HttpStatus, Injectable } from '@nestjs/common';
import { modulesForMode, ROLE_CHANNEL, ROLE_CODES, type RoleCode } from '@sellwasl/business-rules';
import {
  type CreateCompanyResponse,
  defaultCompanySettings,
  type PlatformCompany,
} from '@sellwasl/validation';
import { hashPassword, temporaryPassword } from '../auth/passwords';
import { ApiError } from '../common/api-error';
import { uuidv7 } from '../common/uuid';
import type { Company, SalesMode } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { DEFAULT_CUSTOMER_TYPES, DEFAULT_REASONS, ROLE_NAMES } from './defaults';

export interface ProvisionInput {
  name: string;
  code: string;
  mode: SalesMode;
  admin: { firstName: string; lastName: string; email?: string; code: string };
}

/**
 * Création d'une entreprise par le Super Admin (UC-90, docs/modules.md §4) : dans une seule
 * transaction, l'entreprise, ses modules, ses paramètres par défaut, ses rôles et leurs
 * permissions, les motifs système, le type de client « Détail » et son administrateur.
 */
@Injectable()
export class ProvisioningService {
  // Accès système : l'entreprise n'existe pas encore.
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
  ) {}

  async createCompany(
    input: ProvisionInput,
    platformUserId: string,
  ): Promise<CreateCompanyResponse> {
    if (await this.prisma.company.findUnique({ where: { code: input.code } })) {
      throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', 'Ce code d’entreprise existe déjà.', {
        field: 'code',
      });
    }
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    const companyId = uuidv7();

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          id: companyId,
          name: input.name,
          code: input.code,
          mode: input.mode,
          status: 'ACTIVE',
          createdByPlatformUserId: platformUserId,
        },
      });
      const now = new Date();
      await tx.companyModule.createMany({
        data: modulesForMode(input.mode).map((moduleCode) => ({
          id: uuidv7(),
          companyId,
          moduleCode,
          activatedAt: now,
        })),
      });
      const settings = defaultCompanySettings();
      settings.receiptHeader.name = input.name;
      await tx.companySettings.create({
        data: { id: uuidv7(), companyId, version: 1, data: settings },
      });

      const roleIds = {} as Record<RoleCode, string>;
      for (const code of ROLE_CODES) {
        roleIds[code] = uuidv7();
        await tx.role.create({
          data: {
            id: roleIds[code],
            companyId,
            code,
            name: ROLE_NAMES[code],
            channel: ROLE_CHANNEL[code],
          },
        });
      }
      await this.roles.applyPermissions(tx, companyId, settings.rules);

      await tx.reason.createMany({
        data: DEFAULT_REASONS.map((r, i) => ({
          id: uuidv7(),
          companyId,
          kind: r.kind,
          label: r.label,
          systemCode: r.systemCode ?? null,
          sortOrder: i,
        })),
      });
      await tx.customerType.createMany({
        data: DEFAULT_CUSTOMER_TYPES.map((t) => ({ id: uuidv7(), companyId, ...t })),
      });

      const adminId = uuidv7();
      await tx.user.create({
        data: {
          id: adminId,
          companyId,
          roleId: roleIds.COMPANY_ADMIN,
          code: input.admin.code,
          firstName: input.admin.firstName,
          lastName: input.admin.lastName,
          email: input.admin.email ?? null,
          passwordHash,
          mustChangePassword: true,
        },
      });
      const after = {
        code: input.code,
        name: input.name,
        mode: input.mode,
        admin: input.admin.code,
      };
      await tx.platformAuditLog.create({
        data: {
          id: uuidv7(),
          platformUserId,
          companyId,
          action: 'company.create',
          entity: 'Company',
          entityId: companyId,
          after,
        },
      });
      await tx.auditLog.create({
        data: {
          id: uuidv7(),
          companyId,
          actorUserId: null,
          action: 'company.create',
          entity: 'Company',
          entityId: companyId,
          after,
        },
      });
      return created;
    });

    return {
      company: toPlatformCompany(company, modulesForMode(input.mode), 1),
      admin: {
        code: input.admin.code,
        email: input.admin.email ?? null,
        temporaryPassword: password,
      },
    };
  }
}

export function toPlatformCompany(
  company: Company,
  modules: readonly string[],
  users: number,
): PlatformCompany {
  return {
    id: company.id,
    code: company.code,
    name: company.name,
    mode: company.mode,
    status: company.status,
    modules: [...modules],
    users,
    createdAt: company.createdAt.toISOString(),
  };
}
