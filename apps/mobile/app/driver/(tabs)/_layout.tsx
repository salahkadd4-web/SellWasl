import { driverRouteView } from '@sellwasl/offline';
import { useRouter } from 'expo-router';
import type { SheetAction } from '@/components/ActionSheet';
import { FieldTabs } from '@/components/FieldTabs';
import { phoneDate } from '@/offline/ids';
import { useLocal } from '@/offline/SyncProvider';

/** Onglets du livreur (refonte mobile) : Accueil · Tournée · + · Bons du jour · Map. */
export default function DriverTabs() {
  const router = useRouter();
  const { data: route } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  const inProgress = route?.workday?.status === 'IN_PROGRESS';

  const quick: SheetAction[] = [
    {
      key: 'receive',
      label: 'Pointer le camion',
      icon: 'check-square',
      onPress: () => router.push('/driver/receive'),
      disabledReason: inProgress ? undefined : 'Démarrez votre journée',
    },
    {
      key: 'truck',
      label: 'Stock du camion',
      icon: 'truck',
      onPress: () => router.push('/driver/truck'),
    },
  ];

  const menu: SheetAction[] = [
    {
      key: 'objectives',
      label: 'Objectifs',
      icon: 'target',
      onPress: () => router.push('/driver/objectives'),
    },
    {
      key: 'pay',
      label: 'Ma paie',
      icon: 'credit-card',
      onPress: () => router.push('/driver/pay'),
    },
    {
      key: 'sync',
      label: 'Synchronisation',
      icon: 'refresh-cw',
      onPress: () => router.push('/driver/sync'),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      onPress: () => router.push('/driver/notifications'),
    },
    {
      key: 'profile',
      label: 'Profil',
      icon: 'user',
      onPress: () => router.push('/driver/profile'),
    },
  ];

  return (
    <FieldTabs
      items={[
        { name: 'index', label: 'Accueil', title: 'Accueil', icon: 'home' },
        { name: 'route', label: 'Tournée', title: 'Ma tournée', icon: 'truck' },
        { name: 'receipts', label: 'Bons', title: 'Bons du jour', icon: 'file-text' },
        { name: 'map', label: 'Map', title: 'Carte de la tournée', icon: 'map-pin' },
      ]}
      menu={menu}
      quick={quick}
      notificationsHref="/driver/notifications"
    />
  );
}
