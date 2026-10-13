import type { SheetAction } from '@/components/ActionSheet';
import { callCustomer, type Destination, directionsUrl, openDirectionsTo } from './customers';

/**
 * Visiter, Localiser, Appeler (refonte mobile) : mêmes actions dans le glissement, la feuille
 * « ⋯ » et le panneau de la carte. Une action impossible reste visible, grisée, avec sa raison.
 */
export function customerActions(
  customer: Destination & { phone: string | null },
  visit: { label: string; onPress: () => void; disabledReason?: string },
): SheetAction[] {
  return [
    {
      key: 'visit',
      label: visit.label,
      icon: 'log-in',
      onPress: visit.onPress,
      disabledReason: visit.disabledReason,
    },
    {
      key: 'locate',
      label: 'Localiser',
      icon: 'navigation',
      onPress: () => void openDirectionsTo(customer),
      disabledReason: directionsUrl(customer) ? undefined : 'Ni position ni adresse précise',
    },
    {
      key: 'call',
      label: 'Appeler',
      icon: 'phone',
      onPress: () => callCustomer(customer.phone!),
      disabledReason: customer.phone ? undefined : 'Aucun numéro',
    },
  ];
}
