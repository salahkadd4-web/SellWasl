'use client';

import type { CommercialReportDto, DashboardDto, TerritoryDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { monthToDate, type Period, PeriodFields, Rate, Stat } from '@/components/analytics';
import { BarChart, LineChart } from '@/components/charts';
import { Alert, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA } from '@/lib/labels';

/** Dashboard de l'entreprise (phase 21) : chiffres de la période, retours si le module est actif. */
export function Dashboard() {
  const [period, setPeriod] = useState<Period>(monthToDate);
  const [territoryId, setTerritoryId] = useState('');
  const [territories, setTerritories] = useState<TerritoryDto[]>([]);
  const [data, setData] = useState<DashboardDto | null>(null);
  const [daily, setDaily] = useState<CommercialReportDto['byDay']>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<TerritoryDto[]>('company', '/territories')
      .then(setTerritories)
      .catch(() => setTerritories([]));
  }, []);

  useEffect(() => {
    const query = `from=${period.from}&to=${period.to}${territoryId ? `&territoryId=${territoryId}` : ''}`;
    setError(null);
    api<DashboardDto>('company', `/reports/dashboard?${query}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
    // Séries par jour des graphiques : le rapport commercial, déjà calculé par le serveur
    api<CommercialReportDto>('company', `/reports/commercial?${query}`)
      .then((r) => setDaily(r.byDay))
      .catch(() => setDaily([]));
  }, [period, territoryId]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <PeriodFields value={period} onChange={setPeriod} />
        {territories.length > 0 && (
          <Select
            label="Secteur"
            value={territoryId}
            onChange={(e) => setTerritoryId(e.target.value)}
            options={[
              { value: '', label: 'Tous les secteurs' },
              ...territories.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` })),
            ]}
          />
        )}
      </Card>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text-dark">Ventes et visites</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Chiffre d'affaires" value={formatDA(data.revenue)} />
              <Stat label="Commandes" value={data.orders} />
              <Stat
                label="Visites réalisées"
                value={`${data.visits.done} / ${data.visits.planned}`}
                hint="Visites faites sur les visites planifiées"
              />
              <Stat label="Taux de conversion" value={<Rate value={data.conversion} />} />
              <Stat label="Clients non visités" value={data.notVisited} />
              <Stat
                label="Clients en retard"
                value={data.lateCustomers}
                hint="Sans visite depuis plus que leur fréquence"
              />
              <Stat label="Pré-vendeurs actifs" value={data.activeSellers} />
              <Stat label="Livreurs actifs" value={data.activeDrivers} />
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text-dark">Préparation, livraison, stock</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Commandes en préparation" value={data.ordersPreparing} />
              <Stat label="Commandes en livraison" value={data.ordersInDelivery} />
              <Stat label="Échecs de livraison" value={data.deliveryFailures} />
              <Stat
                label="Stock faible / ruptures"
                value={`${data.lowStock} / ${data.stockouts}`}
                hint="Articles sous le seuil · lignes en rupture"
              />
            </div>
          </Card>
          {daily.length > 1 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-text-dark">
                  Chiffre d'affaires par jour
                </h2>
                <LineChart
                  label="Chiffre d'affaires par jour"
                  data={daily.map((d) => ({
                    label: d.date.slice(8, 10) + '/' + d.date.slice(5, 7),
                    value: d.revenue,
                  }))}
                  format={formatDA}
                />
              </Card>
              <Card className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-text-dark">Commandes par jour</h2>
                <LineChart
                  label="Commandes par jour"
                  data={daily.map((d) => ({
                    label: d.date.slice(8, 10) + '/' + d.date.slice(5, 7),
                    value: d.orders,
                  }))}
                  format={(n) => String(n)}
                />
              </Card>
            </div>
          )}
          {data.returns && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-text-dark">Retours</h2>
                <Link href="/app/retours" className="text-sm font-semibold text-deep-blue">
                  Analyse des retours →
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Commandes refusées"
                  value={data.returns.refusals}
                  hint={
                    <>
                      {formatDA(data.returns.refusedValue)} · taux{' '}
                      <Rate value={data.returns.refusalRate} />
                    </>
                  }
                />
                <Stat
                  label="Retours au déchargement"
                  value={formatDA(data.returns.returnedValue)}
                  hint={
                    <>
                      {data.returns.returnedQty} unités · taux{' '}
                      <Rate value={data.returns.returnRate} />
                    </>
                  }
                />
                <Stat label="Reventes en tournée" value={formatDA(data.returns.resoldValue)} />
                <Stat
                  label="Coût net des retours"
                  value={formatDA(data.returns.netCost)}
                  hint={`Écarts au déchargement : ${data.returns.gapQty} unités (${formatDA(data.returns.gapValue)})`}
                />
              </div>
              <BarChart
                format={formatDA}
                data={[
                  {
                    label: 'Refusé à la livraison',
                    value: data.returns.refusedValue,
                    tone: 'danger',
                  },
                  {
                    label: 'Retourné au dépôt',
                    value: data.returns.returnedValue,
                    tone: 'warning',
                  },
                  { label: 'Revendu en tournée', value: data.returns.resoldValue, tone: 'success' },
                  {
                    label: 'Écarts au déchargement',
                    value: data.returns.gapValue,
                    tone: 'primary',
                  },
                ]}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
