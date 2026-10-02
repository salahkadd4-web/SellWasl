// BR-USR-01, BR-USR-02 ; docs/rbac.md §2, docs/modules.md §5
import type { ModuleCode } from './modules';

export const ROLE_CODES = [
  'COMPANY_ADMIN',
  'SUPERVISEUR',
  'COMPTABLE',
  'PRE_VENDEUR',
  'VENDEUR_CASH_VAN',
  'LIVREUR',
  'MAGASINIER',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export type Channel = 'WEB' | 'MOBILE';

export const ROLE_CHANNEL: Record<RoleCode, Channel> = {
  COMPANY_ADMIN: 'WEB',
  SUPERVISEUR: 'WEB',
  COMPTABLE: 'WEB',
  PRE_VENDEUR: 'MOBILE',
  VENDEUR_CASH_VAN: 'MOBILE',
  LIVREUR: 'MOBILE',
  MAGASINIER: 'MOBILE',
};

/** Module sans lequel un rôle mobile n'a pas de sens ; null pour les rôles du socle. */
export const ROLE_REQUIRED_MODULE: Record<RoleCode, ModuleCode | null> = {
  COMPANY_ADMIN: null,
  SUPERVISEUR: null,
  COMPTABLE: null,
  PRE_VENDEUR: 'PRE_SALES',
  VENDEUR_CASH_VAN: 'CASH_VAN',
  LIVREUR: 'DELIVERY',
  MAGASINIER: 'WAREHOUSE',
};

export function isRoleAvailable(role: RoleCode, activeModules: readonly ModuleCode[]): boolean {
  const required = ROLE_REQUIRED_MODULE[role];
  return required === null || activeModules.includes(required);
}
