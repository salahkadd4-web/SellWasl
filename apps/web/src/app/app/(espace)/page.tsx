'use client';

import type { StockAlertDto } from '@sellwasl/validation';
import { Dashboard } from './dashboard';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';

const MODULE_NAMES: Record<string, string> = {
  PRE_SALES: 'Prévente',
  DELIVERY: 'Livraison',
  CASH_VAN: 'Cash van',
  WAREHOUSE: 'Entrepôt et stock',
  ANALYTICS: 'Analyse',
  RETURNS_ANALYSIS: 'Analyse des retours',
};

export default function CompanyHomePage() {
  const { me, can } = CompanyAuth.useAuth();
  const canStock = !!me && can('stock.read');
  const [alerts, setAlerts] = useState<number | null>(null);

  useEffect(() => {
    if (!canStock) return;
    api<StockAlertDto[]>('company', '/stock/alerts')
      .then((list) => setAlerts(list.length))
      .catch(() => setAlerts(null));
  }, [canStock]);

  if (!me) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Bonjour {me.user.firstName}</h1>
        <p className="text-muted">
          {me.role.name} · {me.company.name}
        </p>
      </div>

      {can('reports.read') && <Dashboard />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-text-dark">Modules actifs</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {me.modules.map((m) => (
              <li key={m} className="rounded-full bg-surface px-3 py-1 text-sm text-primary">
                {MODULE_NAMES[m] ?? m}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold text-text-dark">Votre accès</h2>
          <p className="mt-3 text-sm text-muted">
            {me.permissions.length} permissions accordées par votre rôle.
          </p>
        </Card>
        {canStock && alerts !== null && (
          <Card>
            <h2 className="font-semibold text-text-dark">Stock faible</h2>
            <p className="mt-1 text-sm text-muted">
              {alerts > 0
                ? `${alerts} article(s) sous leur seuil dans un dépôt.`
                : 'Aucun article sous son seuil.'}
            </p>
            <Link href="/app/stock" className="mt-3 inline-block font-semibold text-deep-blue">
              Voir le stock →
            </Link>
          </Card>
        )}
        {can('devices.read') && (
          <Card>
            <h2 className="font-semibold text-text-dark">Appareils</h2>
            <p className="mt-1 text-sm text-muted">
              Associer le téléphone d'un vendeur, d'un livreur ou d'un magasinier.
            </p>
            <Link href="/app/appareils" className="mt-3 inline-block font-semibold text-deep-blue">
              Gérer les appareils →
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
