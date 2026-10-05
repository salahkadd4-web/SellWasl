'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

/** Dépôt ou camion, tel que le renvoie `GET /warehouses`. */
export interface StockWarehouse {
  id: string;
  type: 'DEPOT' | 'TRUCK';
  code: string;
  name: string;
  plateNumber: string | null;
  isActive: boolean;
  assignedUser: { id: string; code: string; firstName: string; lastName: string } | null;
}

export const warehouseLabel = (w: { code: string; name: string }) => `${w.code} · ${w.name}`;

/** Entrepôts actifs de l'entreprise, dépôts d'abord ; `error` si le chargement échoue. */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<StockWarehouse[]>('company', '/warehouses')
      .then((list) =>
        setWarehouses(
          list
            .filter((w) => w.isActive)
            .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)),
        ),
      )
      .catch((err) => setError(errorMessage(err)));
  }, []);
  return { warehouses, error };
}
