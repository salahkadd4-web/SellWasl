'use client';

import type { UserSheetDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { monthToDate, type Period, PeriodFields, Rate, Stat } from '@/components/analytics';
import { Alert, Card, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA } from '@/lib/labels';

/** Fiche d'un vendeur ou d'un livreur, en consultation seule (UC-57). */
export default function UserSheetPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>(monthToDate);
  const [sheet, setSheet] = useState<UserSheetDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<UserSheetDto>('company', `/reports/users/${id}?from=${period.from}&to=${period.to}`)
      .then(setSheet)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [id, period]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={sheet ? sheet.user.name : 'Fiche'}
        subtitle={sheet ? `${sheet.user.role} · ${sheet.user.code}` : undefined}
        action={
          <Link href="/app/suivi" className="font-semibold text-deep-blue">
            ← Suivi du jour
          </Link>
        }
      />
      <Card>
        <PeriodFields value={period} onChange={setPeriod} />
      </Card>
      {error && <Alert>{error}</Alert>}
      {sheet && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Journées" value={sheet.workdays} />
          <Stat label="Visites réalisées" value={sheet.visits} />
          <Stat label="Commandes" value={sheet.orders} hint={formatDA(sheet.revenue)} />
          <Stat label="Taux de conversion" value={<Rate value={sheet.conversion} />} />
          <Stat
            label="Livraisons"
            value={sheet.deliveries.delivered + sheet.deliveries.partial}
            hint={`${sheet.deliveries.partial} partielle(s) · ${sheet.deliveries.failed} échec(s)`}
          />
          <Stat label="Encaissé" value={formatDA(sheet.collected)} />
          {sheet.returns && (
            <>
              <Stat
                label="Refus"
                value={sheet.returns.refusals}
                hint={
                  <>
                    {formatDA(sheet.returns.refusedValue)} · taux{' '}
                    <Rate value={sheet.returns.refusalRate} />
                  </>
                }
              />
              <Stat
                label="Retours au déchargement"
                value={formatDA(sheet.returns.returnedValue)}
                hint={
                  <>
                    taux <Rate value={sheet.returns.returnRate} /> · écarts {sheet.returns.gapQty}
                  </>
                }
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
