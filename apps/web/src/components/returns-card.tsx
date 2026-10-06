'use client';

import type { ReturnsAxisDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Rate } from '@/components/analytics';
import { api } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, shiftDate, todayDate } from '@/lib/labels';

/** Fenêtre des indicateurs de retours d'une fiche. */
const DAYS = 90;

/**
 * Indicateurs de retours d'un produit ou d'un client sur les 90 derniers jours (phase 21) ;
 * rien si le module d'analyse des retours est inactif.
 */
export function ReturnsCard({ axis, id }: { axis: 'product' | 'customer'; id: string }) {
  const { me, can } = CompanyAuth.useAuth();
  const enabled = !!me?.modules.includes('RETURNS_ANALYSIS') && can('returns.read');
  const [data, setData] = useState<ReturnsAxisDto | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const to = todayDate();
    const filter = axis === 'product' ? `productId=${id}` : `customerId=${id}`;
    api<ReturnsAxisDto>(
      'company',
      `/returns/axis/${axis}?from=${shiftDate(to, -(DAYS - 1))}&to=${to}&${filter}`,
    )
      .then(setData)
      .catch(() => setData(null));
  }, [enabled, axis, id]);

  if (!enabled || !data) return null;
  const row = data.rows.find((r) => r.key === id);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2">
      <span className="text-sm font-semibold text-text-dark">Retours · {DAYS} derniers jours</span>
      {row ? (
        <span className="text-sm text-text-dark">
          {row.refusals} refus ({formatDA(row.refusedValue)})
          {axis === 'product' && (
            <>
              {' '}
              · retourné {formatDA(row.returnedValue)} · revendu {formatDA(row.resoldValue)}
            </>
          )}{' '}
          · {data.rateLabel.toLowerCase()} <Rate value={row.rate} />
        </span>
      ) : (
        <span className="text-sm text-muted">Aucun refus ni retour.</span>
      )}
      <Link href="/app/retours" className="text-sm font-semibold text-deep-blue">
        Analyse des retours →
      </Link>
    </div>
  );
}
