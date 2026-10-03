import type { RoleCode } from '@sellwasl/business-rules';
import type { ReasonKind, ReasonSystemCode } from '../generated/prisma/client';

/** Valeurs créées avec chaque entreprise (docs/modules.md §4, docs/database.md §5). */
export const ROLE_NAMES: Record<RoleCode, string> = {
  COMPANY_ADMIN: 'Administrateur',
  SUPERVISEUR: 'Superviseur',
  COMPTABLE: 'Comptable',
  PRE_VENDEUR: 'Pré-vendeur',
  VENDEUR_CASH_VAN: 'Vendeur cash van',
  LIVREUR: 'Livreur',
  MAGASINIER: 'Magasinier',
};

export const DEFAULT_REASONS: { kind: ReasonKind; label: string; systemCode?: ReasonSystemCode }[] =
  [
    { kind: 'NO_ORDER', label: 'Client absent', systemCode: 'CUSTOMER_ABSENT' },
    { kind: 'NO_ORDER', label: 'Client a encore du stock' },
    { kind: 'NO_ORDER', label: 'Magasin fermé', systemCode: 'STORE_CLOSED' },
    { kind: 'NO_ORDER', label: 'Fermé définitivement', systemCode: 'CLOSED_PERMANENTLY' },
    { kind: 'NO_ORDER', label: 'Refus' },
    { kind: 'NO_ORDER', label: 'Autre', systemCode: 'OTHER' },
    { kind: 'DELIVERY_FAILURE', label: 'Client absent', systemCode: 'CUSTOMER_ABSENT' },
    { kind: 'DELIVERY_FAILURE', label: 'Refus', systemCode: 'REFUSED' },
    { kind: 'DELIVERY_FAILURE', label: 'Magasin fermé', systemCode: 'STORE_CLOSED' },
    { kind: 'DELIVERY_FAILURE', label: 'Non livrée', systemCode: 'NOT_DELIVERED' },
    { kind: 'DELIVERY_FAILURE', label: 'Autre', systemCode: 'OTHER' },
    { kind: 'ADJUSTMENT', label: 'Casse' },
    { kind: 'ADJUSTMENT', label: 'Erreur de comptage' },
    { kind: 'ADJUSTMENT', label: 'Autre', systemCode: 'OTHER' },
    { kind: 'FORCED_CLOSE', label: 'Téléphone perdu' },
    { kind: 'FORCED_CLOSE', label: 'Téléphone en panne' },
    { kind: 'REOPEN', label: 'Commande oubliée' },
    { kind: 'REOPEN', label: 'Erreur de saisie' },
  ];

/** Type de client par défaut (BR-TEN-07). */
export const DEFAULT_CUSTOMER_TYPES = [{ code: 'DETAIL', name: 'Détail' }];
