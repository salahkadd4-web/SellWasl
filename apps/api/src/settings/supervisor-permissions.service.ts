import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  delegablePermissions,
  forbiddenPermissionsFor,
  permissionDefinition,
  rolePermissions,
} from '@sellwasl/business-rules';
import type { SupervisorPermissionsDto } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { SettingsService } from './settings.service';

/**
 * Permissions du superviseur réglées par l'administrateur (docs/rbac.md §7 bis) : toute
 * permission de l'administrateur peut lui être accordée, sauf les interdits absolus (§8) et la
 * gestion des permissions. Effet à la requête suivante du superviseur.
 */
@Injectable()
export class SupervisorPermissionsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async supervisorRole() {
    const role = await this.db.role.findFirst({ where: { code: 'SUPERVISEUR' } });
    if (!role) throw notFound('Rôle superviseur introuvable.');
    return role;
  }

  private async granted(roleId: string): Promise<string[]> {
    const rows = await this.db.rolePermission.findMany({ where: { roleId } });
    return rows.map((r) => r.permissionCode).sort();
  }

  async get(): Promise<SupervisorPermissionsDto> {
    const role = await this.supervisorRole();
    const { data } = await this.settings.current();
    return {
      granted: await this.granted(role.id),
      delegable: delegablePermissions().map((code) => ({
        code,
        description: permissionDefinition(code)?.description ?? code,
      })),
      defaults: rolePermissions('SUPERVISEUR', data.rules).sort(),
    };
  }

  async update(actor: AuthUser, permissions: string[]): Promise<SupervisorPermissionsDto> {
    const wanted = [...new Set(permissions)].sort();
    const delegable = new Set(delegablePermissions());
    const refused = [
      ...forbiddenPermissionsFor('SUPERVISEUR', wanted),
      ...wanted.filter((code) => !delegable.has(code)),
    ];
    if (refused.length > 0)
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BUSINESS_RULE',
        `Permissions impossibles à accorder au superviseur : ${[...new Set(refused)].join(', ')}.`,
        { refused: [...new Set(refused)] },
      );
    const role = await this.supervisorRole();
    const before = await this.granted(role.id);
    await this.db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'role.permissions.update',
          entity: 'Role',
          entityId: role.id,
          before: { permissions: before } as unknown as Prisma.InputJsonValue,
          after: { permissions: wanted } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return this.get();
  }
}
