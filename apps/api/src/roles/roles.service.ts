import { Injectable } from '@nestjs/common';
import {
  assertAllowedPermissions,
  type PermissionRules,
  ROLE_CODES,
  rolePermissions,
} from '@sellwasl/business-rules';
import type { RoleCode } from '@sellwasl/business-rules';

/** Client de transaction, filtré par entreprise ou non : seules ces opérations sont utilisées. */
export interface RolesTx {
  role: {
    findMany(args: { where: { companyId: string } }): Promise<{ id: string; code: RoleCode }[]>;
  };
  rolePermission: {
    deleteMany(args: { where: { roleId: string } }): Promise<unknown>;
    createMany(args: { data: { roleId: string; permissionCode: string }[] }): Promise<unknown>;
  };
}

/**
 * Permissions des rôles d'une entreprise (docs/rbac.md §5, §7, §8).
 * Appelé à la création de l'entreprise et à chaque changement de P-08 ou P-10.
 */
@Injectable()
export class RolesService {
  async applyPermissions(tx: RolesTx, companyId: string, rules: PermissionRules): Promise<void> {
    const roles = await tx.role.findMany({ where: { companyId } });
    for (const code of ROLE_CODES) {
      const role = roles.find((r) => r.code === code);
      if (!role) continue;
      const permissions = rolePermissions(code, rules);
      assertAllowedPermissions(code, permissions);
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      });
    }
  }
}
