import { useRouter } from 'expo-router';
import { useToday } from '@/today/TodayContext';
import { TruckCheck } from '@/truck/TruckCheck';

/** Pointage du camion du vendeur cash van : rien ne se vend avant (BR-CV-02). */
export default function SellerTruckCheckScreen() {
  const router = useRouter();
  const { today, refresh } = useToday();
  return (
    <TruckCheck
      workdayId={today?.workday?.id ?? null}
      onDone={() => {
        void refresh();
        router.back();
      }}
    />
  );
}
