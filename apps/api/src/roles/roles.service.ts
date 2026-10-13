import { Injectable } from '@nestjs/common';
import {
  assertAllowedPermissions,
  type PermissionRules,
  ROLE_CODES,
  rolePermissions,
  SETTING_PERMISSIONS,
} from '@sellwasl/business-rules';
import type { RoleCode } from '@sellwasl/business-rules';

/** Client de transaction, filtré par entreprise ou non : seules ces opérations sont utilisées. */
export interface RolesTx {
  role: {
    findMany(args: { where: { companyId: string } }): Promise<{ id: string; code: RoleCode }[]>;
  };
  rolePermission: {
    deleteMany(args: {
      where: { roleId: string; permissionCode?: { in: string[] } };
    }): Promise<unknown>;
    createMany(args: {
      data: { roleId: string; permissionCode: string }[];
      skipDuplicates?: boolean;
    }): Promise<unknown>;
  };
}

/**
 * Permissions des rôles d'une entreprise (docs/rbac.md §5, §7, §7 bis, §8).
 */
@Injectable()
export class RolesService {
  /** Création de l'entreprise : chaque rôle reçoit ses permissions par défaut. */
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

  /**
   * Changement de P-08 ou P-10 : seules les permissions de ce paramètre sont ajoutées ou
   * retirées ; les autres permissions du rôle (réglées par l'administrateur, §7 bis) restent.
   */
  async applySettingPermissions(
    tx: RolesTx,
    companyId: string,
    rules: PermissionRules,
  ): Promise<void> {
    const roles = await tx.role.findMany({ where: { companyId } });
    for (const [rule, effect] of Object.entries(SETTING_PERMISSIONS)) {
      const role = roles.find((r) => r.code === effect.role);
      if (!role) continue;
      const permissions = [...effect.permissions];
      if (rules[rule as keyof PermissionRules]) {
        assertAllowedPermissions(effect.role, permissions);
        await tx.rolePermission.createMany({
          data: permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })),
          skipDuplicates: true,
        });
      } else {
        await tx.rolePermission.deleteMany({
          where: { roleId: role.id, permissionCode: { in: permissions } },
        });
      }
    }
  }
}
