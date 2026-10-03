import { describe, expect, it } from 'vitest';
import { modulesForMode } from './modules';
import {
  DEFAULT_ROLE_PERMISSIONS,
  forbiddenPermissionsFor,
  isPermissionModuleActive,
  PERMISSIONS,
  rolePermissions,
} from './permissions';
import { isRoleAvailable, ROLE_CODES } from './roles';

const DEFAULT_RULES = { P08_driverCollectsOldDebts: true, P10_supervisorEditsPrices: false };

describe('matrice des permissions (docs/rbac.md §5)', () => {
  it('ne référence que des permissions du catalogue', () => {
    const known = new Set(PERMISSIONS.map((p) => p.code));
    for (const role of ROLE_CODES) {
      for (const code of DEFAULT_ROLE_PERMISSIONS[role])
        expect(known.has(code), `${role} → ${code}`).toBe(true);
    }
  });

  it('respecte les interdits absolus pour tous les rôles et toutes les valeurs de P-08 et P-10 (§8)', () => {
    for (const P08 of [true, false]) {
      for (const P10 of [true, false]) {
        for (const role of ROLE_CODES) {
          const perms = rolePermissions(role, {
            P08_driverCollectsOldDebts: P08,
            P10_supervisorEditsPrices: P10,
          });
          expect(forbiddenPermissionsFor(role, perms), role).toEqual([]);
        }
      }
    }
  });

  it('refuse une opération terrain au superviseur, à l’admin et au comptable (BR-USR-05)', () => {
    for (const role of ['COMPANY_ADMIN', 'SUPERVISEUR', 'COMPTABLE'] as const) {
      expect(forbiddenPermissionsFor(role, ['orders.own', 'payments.collect_debt'])).toHaveLength(
        2,
      );
    }
  });

  it('refuse la modification des prix à un rôle terrain', () => {
    expect(forbiddenPermissionsFor('PRE_VENDEUR', ['prices.update', 'orders.own'])).toEqual([
      'prices.update',
    ]);
  });

  it('applique P-08 au livreur et P-10 au superviseur (§7)', () => {
    expect(rolePermissions('LIVREUR', DEFAULT_RULES)).toContain('payments.collect_debt');
    expect(
      rolePermissions('LIVREUR', { ...DEFAULT_RULES, P08_driverCollectsOldDebts: false }),
    ).not.toContain('payments.collect_debt');
    expect(rolePermissions('SUPERVISEUR', DEFAULT_RULES)).not.toContain('prices.update');
    expect(
      rolePermissions('SUPERVISEUR', { ...DEFAULT_RULES, P10_supervisorEditsPrices: true }),
    ).toEqual(expect.arrayContaining(['prices.update', 'price_tiers.update', 'bonuses.update']));
  });
});

describe('modules (docs/modules.md)', () => {
  it('active les modules du mode (BR-TEN-03)', () => {
    expect(modulesForMode('CASH_VAN')).toEqual(['CASH_VAN', 'WAREHOUSE', 'ANALYTICS']);
    expect(modulesForMode('MIXED')).toHaveLength(5);
  });

  it('bloque une permission dont le module est inactif', () => {
    const cashVan = modulesForMode('CASH_VAN');
    expect(isPermissionModuleActive('orders.own', cashVan)).toBe(false);
    expect(isPermissionModuleActive('sales.own', cashVan)).toBe(true);
    expect(isPermissionModuleActive('deliveries.read', cashVan)).toBe(false);
    expect(isPermissionModuleActive('customers.read', cashVan)).toBe(true);
    expect(isPermissionModuleActive('workdays.own', cashVan)).toBe(true); // FIELD (BR-TEN-05)
    expect(isPermissionModuleActive('inconnue.read', cashVan)).toBe(false);
  });

  it('rend un rôle indisponible si son module est inactif (§5)', () => {
    const cashVan = modulesForMode('CASH_VAN');
    expect(isRoleAvailable('LIVREUR', cashVan)).toBe(false);
    expect(isRoleAvailable('VENDEUR_CASH_VAN', cashVan)).toBe(true);
    expect(isRoleAvailable('SUPERVISEUR', cashVan)).toBe(true);
  });
});
