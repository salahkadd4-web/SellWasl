// docs/rbac.md §4 (catalogue), §5 (matrice), §7 (P-08, P-10), §8 (interdits)
import type { ModuleCode } from './modules';
import type { RoleCode } from './roles';

/** Module d'une permission : un module produit, le socle, ou les fonctions terrain (BR-TEN-05). */
export type PermissionModule = ModuleCode | 'CORE' | 'FIELD';

export interface PermissionDefinition {
  code: string;
  description: string;
  scope: 'PLATFORM' | 'COMPANY';
  module: PermissionModule;
}

const platform = (code: string, description: string): PermissionDefinition => ({
  code,
  description,
  scope: 'PLATFORM',
  module: 'CORE',
});
const company = (
  code: string,
  description: string,
  module: PermissionModule = 'CORE',
): PermissionDefinition => ({ code, description, scope: 'COMPANY', module });

export const PERMISSIONS: readonly PermissionDefinition[] = [
  platform('companies.read', 'Lister et consulter les entreprises'),
  platform('companies.create', 'Créer une entreprise, son administrateur et son mode'),
  platform('companies.update', 'Modifier une entreprise et son mode'),
  platform('companies.suspend', 'Suspendre et réactiver une entreprise'),
  platform('platform.audit.read', "Consulter l'audit plateforme"),

  company('settings.read', "Consulter les paramètres de l'entreprise"),
  company(
    'settings.update',
    'Paramètres, P-01 à P-10, types de clients, jours fériés, motifs, entrepôts',
  ),
  company('modules.read', 'Voir les modules actifs'),
  company('users.read', 'Lister et consulter les utilisateurs'),
  company('users.create', 'Créer un utilisateur'),
  company('users.update', 'Modifier un utilisateur'),
  company('users.disable', 'Désactiver ou réactiver un utilisateur'),
  company('devices.read', 'Voir les appareils et leur état'),
  company('devices.associate', "Générer un code d'association"),
  company('devices.revoke', 'Révoquer une session, bloquer ou réactiver un appareil'),
  company('audit.read', "Consulter l'audit de l'entreprise"),
  company('imports.run', 'Importer des clients et des produits en CSV'),

  company('products.read', 'Consulter le catalogue, sans les prix'),
  company('products.write', 'Créer et modifier produits, parfums, gammes, catégories, unités'),
  company('prices.read', 'Voir les prix, paliers et bonus'),
  company('prices.update', 'Modifier les prix'),
  company('price_tiers.update', 'Modifier les paliers'),
  company('bonuses.update', 'Modifier les règles de bonus'),

  company('territories.read', 'Secteurs, parties, planning, affectations', 'FIELD'),
  company('territories.update', 'Dessiner les polygones, affecter, planifier', 'FIELD'),
  company('customers.read', 'Consulter les clients et leur dette'),
  company('customers.create', 'Créer un client'),
  company('customers.update', 'Modifier un client, forcer sa partie, valider un nouveau client'),
  company('customers.disable', 'Désactiver un client'),
  company('customers.reschedule', 'Reprogrammer une visite', 'FIELD'),
  company('quotas.read', 'Consulter les quotas'),
  company('quotas.update', 'Fixer les quotas du jour'),
  company('objectives.read', 'Consulter les objectifs'),
  company('objectives.update', 'Fixer les objectifs du mois'),

  company('workdays.read', 'Consulter les journées de tous', 'FIELD'),
  company('workdays.own', 'Démarrer et clôturer sa journée', 'FIELD'),
  company('workdays.reopen', 'Rouvrir une journée', 'FIELD'),
  company('workdays.force_close', "Clôturer d'office une journée", 'FIELD'),
  company('visits.read', 'Consulter les visites de tous', 'FIELD'),
  company('visits.own', 'Faire ses visites', 'FIELD'),

  company('orders.read', 'Consulter les commandes et ventes de tous'),
  company('orders.own', 'Prendre, modifier, annuler ses commandes de prévente', 'PRE_SALES'),
  company('pending_lines.process', 'Accepter ou refuser les lignes en attente', 'PRE_SALES'),
  company('sales.own', 'Vendre depuis son camion', 'CASH_VAN'),
  company('lost_demands.own', 'Enregistrer une demande perdue', 'CASH_VAN'),

  company('stock.read', 'Consulter le stock', 'WAREHOUSE'),
  company('stock.receive', 'Enregistrer une entrée au dépôt', 'WAREHOUSE'),
  company('inventory.count', "Faire l'inventaire du dépôt", 'WAREHOUSE'),
  company('loads.read', 'Consulter les chargements et déchargements', 'WAREHOUSE'),
  company('loads.plan', "Préparer le chargement d'un vendeur cash van", 'CASH_VAN'),
  company('loads.load', 'Valider un chargement dans un camion', 'WAREHOUSE'),
  company('loads.receive', 'Confirmer la réception de son chargement', 'WAREHOUSE'),
  company('unloads.validate', 'Décharger un camion', 'WAREHOUSE'),

  company('preparation.launch', "Lancer la préparation d'une tournée", 'DELIVERY'),
  company('preparation.do', 'Préparer une tournée', 'DELIVERY'),
  company('deliveries.read', 'Consulter les livraisons de tous', 'DELIVERY'),
  company('deliveries.own', 'Livrer sa tournée', 'DELIVERY'),

  company('payments.read', 'Consulter les paiements et les dettes'),
  company('payments.collect_delivery', 'Encaisser une livraison ou une vente'),
  company('payments.collect_debt', 'Encaisser une dette'),
  company('settlements.read', 'Consulter les versements'),
  company('settlements.create', 'Enregistrer un versement'),

  company('reports.read', 'Tableau du jour, carte du superviseur, fiches', 'ANALYTICS'),
  company('reports.export', 'Exports CSV', 'ANALYTICS'),
];

const ADMIN_AND_SUPERVISOR_SHARED = [
  'settings.read',
  'modules.read',
  'users.read',
  'devices.read',
  'devices.associate',
  'devices.revoke',
  'products.read',
  'products.write',
  'prices.read',
  'territories.read',
  'territories.update',
  'customers.read',
  'customers.create',
  'customers.update',
  'customers.disable',
  'customers.reschedule',
  'quotas.read',
  'quotas.update',
  'objectives.read',
  'objectives.update',
  'workdays.read',
  'workdays.reopen',
  'workdays.force_close',
  'visits.read',
  'orders.read',
  'pending_lines.process',
  'stock.read',
  // Opérations du magasinier aussi sur le Web, pour les entreprises sans magasinier (phase 17)
  'stock.receive',
  'inventory.count',
  'loads.read',
  'loads.plan',
  'loads.load',
  'unloads.validate',
  'preparation.launch',
  'deliveries.read',
  'payments.read',
  'settlements.read',
  'reports.read',
  'reports.export',
] as const;

/** Matrice rôles × permissions par défaut (docs/rbac.md §5), avant les paramètres P-08 et P-10. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, readonly string[]> = {
  COMPANY_ADMIN: [
    ...ADMIN_AND_SUPERVISOR_SHARED,
    'settings.update',
    'users.create',
    'users.update',
    'users.disable',
    'audit.read',
    'imports.run',
    'prices.update',
    'price_tiers.update',
    'bonuses.update',
    'settlements.create',
  ],
  SUPERVISEUR: [...ADMIN_AND_SUPERVISOR_SHARED],
  COMPTABLE: [
    'settings.read',
    'modules.read',
    'users.read',
    'products.read',
    'prices.read',
    'customers.read',
    'objectives.read',
    'workdays.read',
    'orders.read',
    'loads.read',
    'deliveries.read',
    'payments.read',
    'settlements.read',
    'settlements.create',
    'reports.read',
    'reports.export',
  ],
  PRE_VENDEUR: [
    'settings.read',
    'modules.read',
    'products.read',
    'prices.read',
    'territories.read',
    'customers.read',
    'customers.create',
    'quotas.read',
    'objectives.read',
    'workdays.own',
    'visits.own',
    'orders.read',
    'orders.own',
    'payments.read',
    'payments.collect_debt',
  ],
  VENDEUR_CASH_VAN: [
    'settings.read',
    'modules.read',
    'products.read',
    'prices.read',
    'territories.read',
    'customers.read',
    'customers.create',
    'quotas.read',
    'objectives.read',
    'workdays.own',
    'visits.own',
    'orders.read',
    'sales.own',
    'lost_demands.own',
    'stock.read',
    'loads.read',
    'loads.receive',
    'payments.read',
    'payments.collect_delivery',
    'payments.collect_debt',
  ],
  LIVREUR: [
    'settings.read',
    'modules.read',
    'products.read',
    'prices.read',
    'territories.read',
    'customers.read',
    'workdays.own',
    'orders.read',
    'stock.read',
    'loads.read',
    'loads.receive',
    'deliveries.own',
    'payments.read',
    'payments.collect_delivery',
  ],
  MAGASINIER: [
    'settings.read',
    'modules.read',
    'products.read',
    'orders.read',
    'stock.read',
    'stock.receive',
    'inventory.count',
    'loads.read',
    'loads.load',
    'unloads.validate',
    'preparation.do',
  ],
};

/** Permissions ajoutées ou retirées selon les paramètres (docs/rbac.md §7). */
export const SETTING_PERMISSIONS = {
  P08_driverCollectsOldDebts: { role: 'LIVREUR', permissions: ['payments.collect_debt'] },
  P10_supervisorEditsPrices: {
    role: 'SUPERVISEUR',
    permissions: ['prices.update', 'price_tiers.update', 'bonuses.update'],
  },
} as const satisfies Record<string, { role: RoleCode; permissions: readonly string[] }>;

export interface PermissionRules {
  P08_driverCollectsOldDebts: boolean;
  P10_supervisorEditsPrices: boolean;
}

/** Permissions effectives d'un rôle, compte tenu des paramètres P-08 et P-10. */
export function rolePermissions(role: RoleCode, rules: PermissionRules): string[] {
  const result = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
  for (const [rule, effect] of Object.entries(SETTING_PERMISSIONS)) {
    if (effect.role !== role) continue;
    for (const permission of effect.permissions) {
      if (rules[rule as keyof PermissionRules]) result.add(permission);
      else result.delete(permission);
    }
  }
  return [...result];
}

const PERMISSION_BY_CODE = new Map(PERMISSIONS.map((p) => [p.code, p]));

export function permissionDefinition(code: string): PermissionDefinition | undefined {
  return PERMISSION_BY_CODE.get(code);
}

/** Module requis par une permission ; inconnue = refusée (docs/modules.md §7). */
export function isPermissionModuleActive(
  code: string,
  activeModules: readonly ModuleCode[],
): boolean {
  const definition = PERMISSION_BY_CODE.get(code);
  if (!definition) return false;
  switch (definition.module) {
    case 'CORE':
      return true;
    case 'FIELD':
      return activeModules.includes('PRE_SALES') || activeModules.includes('CASH_VAN');
    default:
      return activeModules.includes(definition.module);
  }
}

const WEB_ROLES: readonly RoleCode[] = ['COMPANY_ADMIN', 'SUPERVISEUR', 'COMPTABLE'];

/**
 * Interdits absolus (docs/rbac.md §8) : ces permissions ne sont jamais accordées à ces rôles,
 * quels que soient les paramètres. Renvoie les permissions fautives.
 */
export function forbiddenPermissionsFor(role: RoleCode, permissions: readonly string[]): string[] {
  return permissions.filter((code) => {
    const definition = PERMISSION_BY_CODE.get(code);
    if (!definition || definition.scope === 'PLATFORM') return true;
    if (WEB_ROLES.includes(role)) {
      return code.endsWith('.own') || code.startsWith('payments.collect_');
    }
    return (
      code === 'settings.update' ||
      code.startsWith('users.') ||
      code === 'prices.update' ||
      code === 'price_tiers.update' ||
      code === 'bonuses.update' ||
      code === 'customers.update' ||
      code === 'customers.disable' ||
      code === 'workdays.reopen' ||
      code === 'workdays.force_close'
    );
  });
}

export function assertAllowedPermissions(role: RoleCode, permissions: readonly string[]): void {
  const forbidden = forbiddenPermissionsFor(role, permissions);
  if (forbidden.length > 0) {
    throw new Error(
      `Permissions interdites pour ${role} : ${forbidden.join(', ')} (docs/rbac.md §8)`,
    );
  }
}
