import type { IconName } from '@/components/icons';

export type NavGroup =
  'Pilotage' | 'Terrain' | 'Stock et livraison' | 'Comptabilité et paie' | 'Administration' | 'Moi';

export const NAV_GROUPS: NavGroup[] = [
  'Pilotage',
  'Terrain',
  'Stock et livraison',
  'Comptabilité et paie',
  'Administration',
  'Moi',
];

export interface NavItem {
  href: string;
  label: string;
  /** Droit requis ; null : toujours visible. */
  permission: string | null;
  /** Module qui doit être actif dans l'entreprise. */
  module?: string;
  /** Autres pages de la même entrée (onglets). */
  also?: string[];
  group: NavGroup;
  icon: IconName;
  /** Rang dans la barre du bas sur smartphone (plus petit : prioritaire). */
  bottom?: number;
}

/** Menu de l'espace entreprise (droits et modules : docs/rbac.md). */
export const COMPANY_NAV: NavItem[] = [
  { href: '/app', label: 'Accueil', permission: null, group: 'Pilotage', icon: 'home', bottom: 1 },
  {
    href: '/app/suivi',
    label: 'Suivi du jour',
    permission: 'reports.read',
    group: 'Pilotage',
    icon: 'pulse',
    bottom: 2,
  },
  {
    href: '/app/rapports',
    label: 'Rapports',
    permission: 'reports.read',
    group: 'Pilotage',
    icon: 'chart',
  },
  {
    href: '/app/retours',
    label: 'Analyse des retours',
    permission: 'returns.read',
    module: 'RETURNS_ANALYSIS',
    group: 'Pilotage',
    icon: 'undo',
  },
  {
    href: '/app/clients',
    label: 'Clients',
    permission: 'customers.read',
    group: 'Terrain',
    icon: 'store',
  },
  {
    href: '/app/secteurs',
    label: 'Secteurs',
    permission: 'territories.read',
    group: 'Terrain',
    icon: 'map',
  },
  {
    href: '/app/planning',
    label: 'Planning',
    permission: 'territories.read',
    group: 'Terrain',
    icon: 'calendar',
  },
  {
    href: '/app/journees',
    label: 'Journées',
    permission: 'workdays.read',
    group: 'Terrain',
    icon: 'clock',
  },
  {
    href: '/app/commandes',
    label: 'Commandes',
    permission: 'orders.read',
    group: 'Terrain',
    icon: 'cart',
    bottom: 3,
  },
  {
    href: '/app/attente',
    label: 'Lignes en attente',
    permission: 'pending_lines.process',
    group: 'Terrain',
    icon: 'hourglass',
  },
  {
    href: '/app/quotas',
    label: 'Quotas',
    permission: 'quotas.read',
    group: 'Terrain',
    icon: 'gauge',
  },
  {
    href: '/app/objectifs',
    label: 'Objectifs',
    permission: 'objectives.read',
    group: 'Terrain',
    icon: 'target',
  },
  {
    href: '/app/produits',
    label: 'Produits',
    permission: 'products.read',
    group: 'Stock et livraison',
    icon: 'tag',
  },
  {
    href: '/app/stock',
    label: 'Stock',
    permission: 'stock.read',
    group: 'Stock et livraison',
    icon: 'box',
    bottom: 5,
  },
  {
    href: '/app/tournees',
    label: 'Tournées',
    permission: 'preparation.launch',
    group: 'Stock et livraison',
    icon: 'truck',
  },
  {
    href: '/app/versements',
    label: 'Comptabilité',
    permission: 'settlements.read',
    also: [
      '/app/paiements',
      '/app/ecarts',
      '/app/retenues',
      '/app/acomptes',
      '/app/primes',
      '/app/paie',
    ],
    group: 'Comptabilité et paie',
    icon: 'wallet',
    bottom: 4,
  },
  {
    href: '/app/remunerations',
    label: 'Rémunérations',
    permission: 'compensation.read',
    group: 'Comptabilité et paie',
    icon: 'banknote',
  },
  {
    href: '/app/utilisateurs',
    label: 'Utilisateurs',
    permission: 'users.read',
    group: 'Administration',
    icon: 'users',
  },
  {
    href: '/app/appareils',
    label: 'Appareils',
    permission: 'devices.read',
    group: 'Administration',
    icon: 'phone',
  },
  {
    href: '/app/synchronisation',
    label: 'Synchronisation',
    permission: 'devices.read',
    group: 'Administration',
    icon: 'sync',
  },
  {
    href: '/app/parametres',
    label: 'Paramètres',
    permission: 'settings.read',
    group: 'Administration',
    icon: 'settings',
  },
  {
    href: '/app/ma-paie',
    label: 'Ma paie',
    permission: 'pay.mine',
    group: 'Moi',
    icon: 'user',
    bottom: 6,
  },
];

/** Barre du bas préférée de chaque rôle Web, complétée par le rang général. */
const BOTTOM_BY_ROLE: Record<string, string[]> = {
  COMPANY_ADMIN: ['/app', '/app/suivi', '/app/versements'],
  SUPERVISEUR: ['/app', '/app/suivi', '/app/commandes'],
  COMPTABLE: ['/app', '/app/versements', '/app/remunerations'],
};

/** Entrées auxquelles l'utilisateur a droit (droit accordé, module actif). */
export function visibleItems(
  items: NavItem[],
  can: (permission: string) => boolean,
  modules: readonly string[],
): NavItem[] {
  return items.filter(
    (i) =>
      (i.permission === null || can(i.permission)) && (!i.module || modules.includes(i.module)),
  );
}

/** L'entrée est-elle celle de la page affichée (ou d'un de ses onglets) ? */
export function isActive(item: NavItem, pathname: string, root: string): boolean {
  const match = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return item.href === root
    ? pathname === root
    : match(item.href) || !!item.also?.some((p) => match(p));
}

/**
 * Entrées de la barre du bas sur smartphone : les `max` entrées prioritaires parmi celles
 * auxquelles l'utilisateur a droit (jamais une entrée interdite) ; « Plus » donne le reste.
 */
export function bottomItems(visible: NavItem[], roleCode?: string, max = 3): NavItem[] {
  const preferred = (BOTTOM_BY_ROLE[roleCode ?? ''] ?? [])
    .map((href) => visible.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i);
  const ranked = visible
    .filter((i) => i.bottom !== undefined && !preferred.includes(i))
    .sort((a, b) => a.bottom! - b.bottom!);
  return [...preferred, ...ranked].slice(0, max);
}
