import { describe, expect, it } from 'vitest';
import { bottomItems, COMPANY_NAV, isActive, type NavItem, visibleItems } from './navigation';

/** Menu de l'espace entreprise : jamais une entrée interdite (phase 28). */
describe('menu', () => {
  const all = (permissions: string[]) => (p: string) => permissions.includes(p);

  it('n’affiche que les entrées autorisées et dont le module est actif', () => {
    const items: NavItem[] = [
      { href: '/app', label: 'Accueil', permission: null, group: 'Pilotage', icon: 'home' },
      {
        href: '/app/audit',
        label: 'Audit',
        permission: 'audit.read',
        group: 'Administration',
        icon: 'clock',
      },
      {
        href: '/app/quotas',
        label: 'Quotas',
        permission: 'quotas.read',
        module: 'PRESALES',
        group: 'Terrain',
        icon: 'gauge',
      },
    ];
    expect(visibleItems(items, all([]), []).map((i) => i.href)).toEqual(['/app']);
    expect(visibleItems(items, all(['audit.read', 'quotas.read']), []).map((i) => i.href)).toEqual([
      '/app',
      '/app/audit',
    ]);
    expect(visibleItems(items, all(['quotas.read']), ['PRESALES']).map((i) => i.href)).toEqual([
      '/app',
      '/app/quotas',
    ]);
  });

  it('le journal d’audit n’apparaît qu’avec audit.read', () => {
    const hrefs = (perms: string[]) => visibleItems(COMPANY_NAV, all(perms), []).map((i) => i.href);
    expect(hrefs(['audit.read'])).toContain('/app/audit');
    expect(hrefs(['orders.read'])).not.toContain('/app/audit');
  });

  it('barre du bas : 3 entrées au plus, toutes autorisées', () => {
    const visible = visibleItems(COMPANY_NAV, all(['orders.read', 'customers.read']), []);
    const bottom = bottomItems(visible, 'SUPERVISEUR');
    expect(bottom.length).toBeLessThanOrEqual(3);
    for (const item of bottom) expect(visible).toContain(item);
  });

  it('entrée active : la racine seulement sur elle-même, les autres avec leurs sous-pages', () => {
    const home = COMPANY_NAV.find((i) => i.href === '/app')!;
    const clients = COMPANY_NAV.find((i) => i.href === '/app/clients')!;
    expect(isActive(home, '/app', '/app')).toBe(true);
    expect(isActive(home, '/app/clients', '/app')).toBe(false);
    expect(isActive(clients, '/app/clients/123', '/app')).toBe(true);
    expect(isActive(clients, '/app/clientsx', '/app')).toBe(false);
  });
});
