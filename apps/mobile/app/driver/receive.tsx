import { driverRouteView } from '@sellwasl/offline';
import { useRouter } from 'expo-router';
import { phoneDate } from '@/offline/ids';
import { useLocal } from '@/offline/SyncProvider';
import { TruckCheck } from '@/truck/TruckCheck';

/** Pointage du camion du livreur (UC-30, BR-PRE-05) : sa tournée part ensuite en livraison. */
export default function ReceiveScreen() {
  const router = useRouter();
  const { data: route } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  return <TruckCheck workdayId={route?.workday?.id ?? null} onDone={() => router.back()} />;
}
