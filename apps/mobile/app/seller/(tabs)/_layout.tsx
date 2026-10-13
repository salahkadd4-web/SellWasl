import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import type { SheetAction } from '@/components/ActionSheet';
import { FieldTabs } from '@/components/FieldTabs';
import { useToday } from '@/today/TodayContext';

/** Raison affichée sur une action qui exige la journée en cours (BR-JOU-05). */
const NEEDS_WORKDAY = 'Démarrez votre journée';

/**
 * Onglets du pré-vendeur et du vendeur cash van (refonte mobile) : Accueil · Visites · + ·
 * Commandes · Map ; le reste dans le menu.
 */
export default function SellerTabs() {
  const router = useRouter();
  const { me, profile } = useAuth();
  const { inProgress } = useToday();
  const cashVan = (me?.role.code ?? profile?.roleCode) === 'VENDEUR_CASH_VAN';
  const refusals =
    me?.permissions.includes('returns.contest') && me.modules.includes('RETURNS_ANALYSIS');

  const quick: SheetAction[] = [
    {
      key: 'customer-new',
      label: 'Ajouter un client',
      icon: 'user-plus',
      onPress: () => router.push('/seller/customer-new'),
      disabledReason: inProgress ? undefined : NEEDS_WORKDAY,
    },
    ...(cashVan
      ? ([
          {
            key: 'truck-check',
            label: 'Pointer le camion',
            icon: 'check-square',
            onPress: () => router.push('/seller/truck-check'),
            disabledReason: inProgress ? undefined : NEEDS_WORKDAY,
          },
          {
            key: 'truck',
            label: 'Stock du camion',
            icon: 'truck',
            onPress: () => router.push('/seller/truck'),
          },
        ] satisfies SheetAction[])
      : []),
    {
      key: 'catalog',
      label: 'Catalogue',
      icon: 'book-open',
      onPress: () => router.push('/seller/catalog'),
    },
    {
      key: 'receipts',
      label: 'Bons du jour',
      icon: 'file-text',
      onPress: () => router.push('/seller/receipts'),
    },
  ];

  const menu: SheetAction[] = [
    {
      key: 'objectives',
      label: 'Objectifs',
      icon: 'target',
      onPress: () => router.push('/seller/objectives'),
    },
    {
      key: 'pay',
      label: 'Ma paie',
      icon: 'credit-card',
      onPress: () => router.push('/seller/pay'),
    },
    ...(refusals
      ? ([
          {
            key: 'refusals',
            label: 'Refus de mes commandes',
            icon: 'alert-triangle',
            onPress: () => router.push('/seller/refusals'),
          },
        ] satisfies SheetAction[])
      : []),
    {
      key: 'sync',
      label: 'Synchronisation',
      icon: 'refresh-cw',
      onPress: () => router.push('/seller/sync'),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      onPress: () => router.push('/seller/notifications'),
    },
    {
      key: 'profile',
      label: 'Profil',
      icon: 'user',
      onPress: () => router.push('/seller/profile'),
    },
  ];

  return (
    <FieldTabs
      items={[
        { name: 'index', label: 'Accueil', title: 'Accueil', icon: 'home' },
        { name: 'customers', label: 'Visites', title: 'Visites', icon: 'users' },
        { name: 'orders', label: 'Commandes', title: 'Commandes', icon: 'layers' },
        { name: 'map', label: 'Map', title: 'Carte des clients', icon: 'map-pin' },
      ]}
      menu={menu}
      quick={quick}
      notificationsHref="/seller/notifications"
    />
  );
}
