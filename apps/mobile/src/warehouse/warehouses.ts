import { useEffect, useState } from 'react';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';

/** Dépôt ou camion, tel que le renvoie `GET /warehouses`. */
export interface WarehouseItem {
  id: string;
  type: 'DEPOT' | 'TRUCK';
  code: string;
  name: string;
  isActive: boolean;
  assignedUser: { id: string; code: string; firstName: string; lastName: string } | null;
}

/** Entrepôts actifs, dépôts d'abord ; `error` si le chargement échoue. */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void request<WarehouseItem[]>('/warehouses')
      .then((list) =>
        setWarehouses(
          list
            .filter((w) => w.isActive)
            .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)),
        ),
      )
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return { warehouses, error };
}
