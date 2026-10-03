'use client';

import Link from 'next/link';
import { Card } from '@/components/ui';
import { CompanyAuth } from '@/lib/auth';

const MODULE_NAMES: Record<string, string> = {
  PRE_SALES: 'Prévente',
  DELIVERY: 'Livraison',
  CASH_VAN: 'Cash van',
  WAREHOUSE: 'Entrepôt et stock',
  ANALYTICS: 'Analyse',
};

export default function CompanyHomePage() {
  const { me, can } = CompanyAuth.useAuth();
  if (!me) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Bonjour {me.user.firstName}</h1>
        <p className="text-muted">
          {me.role.name} · {me.company.name}
        </p>
      </div>

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
