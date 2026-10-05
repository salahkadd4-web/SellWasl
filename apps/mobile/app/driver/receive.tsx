import type { DriverRouteDto } from '@sellwasl/validation';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { request } from '@/api/client';
import { TruckCheck } from '@/truck/TruckCheck';

/** Pointage du camion du livreur (UC-30, BR-PRE-05) : sa tournée part ensuite en livraison. */
export default function ReceiveScreen() {
  const router = useRouter();
  const [workdayId, setWorkdayId] = useState<string | null>(null);

  useEffect(() => {
    void request<DriverRouteDto>('/me/route')
      .then((r) => setWorkdayId(r.workday?.id ?? null))
      .catch(() => setWorkdayId(null));
  }, []);

  return <TruckCheck workdayId={workdayId} onDone={() => router.back()} />;
}
