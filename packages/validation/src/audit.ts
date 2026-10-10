// Phase 26 — journal d'audit (BR-AUD-01, docs/audit.md)
import { z } from 'zod';
import { pageQuery } from './pagination';

/**
 * Catalogue des actions du journal : code → libellé affiché. Le type des actions écrites par l'API
 * en dépend : une action sans libellé ne compile pas.
 */
export const AUDIT_ACTIONS = {
  // Connexions, comptes et appareils
  'auth.login': 'Connexion',
  'auth.logout': 'Déconnexion',
  'user.create': 'Utilisateur créé',
  'user.update': 'Utilisateur modifié (dont le rôle)',
  'user.disable': 'Utilisateur désactivé',
  'user.enable': 'Utilisateur réactivé',
  'user.password.change': 'Mot de passe changé',
  'user.password.reset': 'Mot de passe réinitialisé',
  'session.revoke': 'Session fermée',
  'session.revoke_all': 'Toutes les sessions fermées',
  'device.activation_code.create': "Code d'activation d'appareil créé",
  'device.activate': 'Appareil associé à un profil',
  'device.block': 'Appareil bloqué',
  'device.unblock': 'Appareil débloqué',
  'device.revoke': 'Appareil révoqué',
  // Entreprise et paramètres
  'company.create': 'Entreprise créée',
  'company.mode.change': 'Mode de vente changé (modules activés ou désactivés)',
  'company.suspend': 'Entreprise suspendue',
  'company.reactivate': 'Entreprise réactivée',
  'settings.update': 'Paramètres modifiés',
  'customer_type.create': 'Type de client créé',
  'customer_type.update': 'Type de client modifié',
  'holiday.create': 'Jour férié ajouté',
  'holiday.delete': 'Jour férié retiré',
  'reason.create': 'Motif créé',
  'reason.update': 'Motif modifié',
  'warehouse.create': 'Entrepôt créé',
  'warehouse.update': 'Entrepôt modifié',
  'import.customers': 'Import de clients',
  'import.products': 'Import de produits',
  // Catalogue et prix
  'product.create': 'Produit créé',
  'product.update': 'Produit modifié',
  'product.photo.set': 'Photo de produit changée',
  'product.photo.remove': 'Photo de produit retirée',
  'product_unit.create': 'Unité créée',
  'product_unit.update': 'Unité modifiée',
  'product_variant.create': 'Parfum créé',
  'product_variant.update': 'Parfum modifié',
  'product_range.create': 'Gamme créée',
  'product_range.update': 'Gamme modifiée',
  'product_category.create': 'Catégorie créée',
  'product_category.update': 'Catégorie modifiée',
  'supplier.create': 'Fournisseur créé',
  'supplier.update': 'Fournisseur modifié',
  'price.update_grid': 'Prix changés',
  'price_tier.create': 'Palier créé',
  'price_tier.update': 'Palier modifié',
  'price_tier.delete': 'Palier retiré',
  'bonus_rule.create': 'Bonus créé',
  'bonus_rule.update': 'Bonus modifié',
  'bonus_rule.delete': 'Bonus retiré',
  // Clients, secteurs et planning
  'customer.create': 'Client créé',
  'customer.update': 'Client modifié',
  'customer.validate': 'Client validé',
  'customer.disable': 'Client désactivé',
  'customer.enable': 'Client réactivé',
  'customer.assign_part': 'Partie du client forcée',
  'customer.reschedule': 'Visite reprogrammée',
  'customer.reschedule_cancel': 'Reprogrammation annulée',
  'territory.create': 'Secteur créé',
  'territory.update': 'Secteur modifié (dont vendeur et livreur affectés)',
  'territory.parts': 'Polygones du secteur modifiés',
  'territory.schedule': 'Planning du secteur modifié',
  // Supervision
  'quota.update': 'Quotas modifiés',
  'objective.update': 'Objectifs modifiés',
  'objective.cap': 'Plafond des objectifs modifié',
  'objective.payment_delay': 'Délai de paiement des objectifs modifié',
  'driver_objectives.update': 'Objectifs des livreurs modifiés',
  'driver_objectives.settings': 'Réglages des objectifs des livreurs modifiés',
  'pending_line.accept': 'Ligne en attente acceptée',
  'pending_line.refuse': 'Ligne en attente refusée',
  // Journées et terrain
  'workday.start': 'Journée démarrée',
  'workday.close': 'Journée clôturée',
  'workday.force_close': "Journée clôturée d'office",
  'workday.reopen': 'Journée rouverte',
  'workday.clock_skew': 'Heure du téléphone décalée',
  'visit.start': 'Visite commencée',
  'visit.close': 'Visite terminée',
  'visit.close_no_order': 'Visite terminée sans commande',
  'order.confirm': 'Commande confirmée',
  'order.update': 'Commande modifiée',
  'order.cancel': 'Commande annulée',
  'payment.debt': 'Dette encaissée',
  'receipt.reprint': 'Bon réimprimé',
  // Préparation, livraison et cash van
  'route.prepare': 'Préparation lancée',
  'route.launch': 'Tournée lancée',
  'load.plan': 'Chargement prévu',
  'load.validate': 'Chargement validé',
  'load.receive': 'Chargement reçu',
  'truck.check': 'Camion pointé',
  'delivery.confirm': 'Livraison confirmée',
  'delivery.fail': 'Livraison en échec',
  'sale.confirm': 'Vente confirmée',
  'lost_demand.create': 'Vente perdue enregistrée',
  'refusal.contest': 'Refus contesté',
  'refusal.decide': 'Contestation tranchée',
  // Stock
  'stock.receive': 'Entrée de stock',
  'stock.thresholds': 'Seuils de stock modifiés',
  'inventory.validate': 'Inventaire validé',
  'unload.validate': 'Déchargement validé',
  // Comptabilité
  'settlement.create': 'Versement enregistré',
  'discrepancy.review': 'Écart en analyse',
  'discrepancy.decide': 'Écart tranché',
  // Paie
  'compensation.create': 'Rémunération fixée',
  'payroll.settings': 'Réglages de la paie modifiés',
  'payroll.create': 'Paie du mois créée',
  'payroll.calculate': 'Paie calculée',
  'payroll.adjustment': 'Ajustement de paie',
  'payroll.approve': 'Paie approuvée',
  'payroll.pay': 'Paie payée',
  'payroll.close': 'Paie clôturée',
  'advance.create': 'Acompte demandé',
  'advance.approve': 'Acompte approuvé',
  'advance.reject': 'Acompte refusé',
  'advance.pay': 'Acompte payé',
  'deduction.create': 'Retenue créée',
  'deduction.approve': 'Retenue approuvée',
  'deduction.reject': 'Retenue refusée',
  'incentive_rule.create': 'Règle de prime créée',
  'incentive_rule.update': 'Règle de prime modifiée',
  'incentive.calculate': 'Primes calculées',
  'incentive.validate': 'Prime validée',
  'incentive.reject': 'Prime refusée',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_CODES = Object.keys(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]];

/** Fiches du journal : modèle → libellé affiché. */
export const AUDIT_ENTITIES = {
  BonusRule: 'Bonus',
  Company: 'Entreprise',
  CompanySettings: 'Paramètres',
  Customer: 'Client',
  CustomerType: 'Type de client',
  Delivery: 'Livraison',
  DeliveryRoute: 'Tournée',
  Device: 'Appareil',
  Discrepancy: 'Écart',
  DriverObjective: 'Objectif de livreur',
  EmployeeCompensation: 'Rémunération',
  Holiday: 'Jour férié',
  ImportJob: 'Import',
  Incentive: 'Prime',
  IncentiveRule: 'Règle de prime',
  InventoryCount: 'Inventaire',
  Load: 'Chargement',
  Objective: 'Objectif',
  Order: 'Commande',
  OrderLine: 'Ligne de commande',
  Payment: 'Paiement',
  PayrollAdjustment: 'Ajustement de paie',
  PayrollDeduction: 'Retenue',
  PayrollPayment: 'Paiement de paie',
  PayrollPeriod: 'Paie',
  PriceTier: 'Palier',
  Product: 'Produit',
  ProductCategory: 'Catégorie',
  ProductRange: 'Gamme',
  ProductUnit: 'Unité',
  ProductVariant: 'Parfum',
  Quota: 'Quota',
  Reason: 'Motif',
  SalaryAdvance: 'Acompte',
  Session: 'Session',
  StockReceipt: 'Entrée de stock',
  Supplier: 'Fournisseur',
  Territory: 'Secteur',
  TerritoryPart: 'Partie de secteur',
  Unload: 'Déchargement',
  User: 'Utilisateur',
  Visit: 'Visite',
  Warehouse: 'Entrepôt',
  Workday: 'Journée',
} as const;

export type AuditEntity = keyof typeof AUDIT_ENTITIES;
export const AUDIT_ENTITY_CODES = Object.keys(AUDIT_ENTITIES) as [AuditEntity, ...AuditEntity[]];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

/** Filtres du journal : période (jours locaux de l'entreprise), auteur, fiche, action. */
export const auditFiltersSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  userId: z.uuid().optional(),
  entity: z.enum(AUDIT_ENTITY_CODES).optional(),
  entityId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTION_CODES).optional(),
});
export type AuditFilters = z.output<typeof auditFiltersSchema>;

/** Liste paginée du journal, la plus récente d'abord. */
export const auditQuerySchema = z.object({
  ...auditFiltersSchema.shape,
  ...pageQuery(['createdAt'], '-createdAt'),
});

/** Ligne du journal (GET /audit). */
export interface AuditRowDto {
  id: string;
  at: string;
  action: AuditAction;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  actor: { id: string; code: string; name: string } | null;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
}
