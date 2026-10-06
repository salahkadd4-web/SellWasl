'use client';

import type {
  CommercialReportDto,
  DeliveryReportDto,
  KeyLabel,
  LostSalesReportDto,
  PresalesReportDto,
  TerritoryDto,
} from '@sellwasl/validation';
import { type ReactNode, useEffect, useState } from 'react';
import {
  downloadCsv,
  LocalTabs,
  monthToDate,
  type Period,
  PeriodFields,
  Rate,
} from '@/components/analytics';
import { Alert, Button, Card, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate } from '@/lib/labels';

type Tab = 'commercial' | 'presales' | 'delivery' | 'lost-sales';
const TABS: { value: Tab; label: string }[] = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'presales', label: 'Prévente' },
  { value: 'delivery', label: 'Livraison' },
  { value: 'lost-sales', label: 'Ventes perdues' },
];

const EXPORTS: { type: string; label: string; returns?: boolean }[] = [
  { type: 'sales', label: 'Ventes' },
  { type: 'visits', label: 'Visites' },
  { type: 'objectives', label: 'Objectifs' },
  { type: 'debts', label: 'Dettes' },
  { type: 'settlements', label: 'Versements' },
  { type: 'refusals', label: 'Refus', returns: true },
  { type: 'returns', label: 'Retours', returns: true },
  { type: 'resales', label: 'Reventes', returns: true },
  { type: 'gaps', label: 'Écarts', returns: true },
];

type Report = CommercialReportDto | PresalesReportDto | DeliveryReportDto | LostSalesReportDto;

/** Rapports et exports (module ANALYTICS, phase 21). */
export default function ReportsPage() {
  const { me, can } = CompanyAuth.useAuth();
  const [tab, setTab] = useState<Tab>('commercial');
  const [period, setPeriod] = useState<Period>(monthToDate);
  const [territoryId, setTerritoryId] = useState('');
  const [territories, setTerritories] = useState<TerritoryDto[]>([]);
  const [report, setReport] = useState<{ tab: Tab; data: Report } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = `from=${period.from}&to=${period.to}${territoryId ? `&territoryId=${territoryId}` : ''}`;
  const returnsModule = !!me?.modules.includes('RETURNS_ANALYSIS');

  useEffect(() => {
    api<TerritoryDto[]>('company', '/territories')
      .then(setTerritories)
      .catch(() => setTerritories([]));
  }, []);

  useEffect(() => {
    setError(null);
    api<Report>('company', `/reports/${tab}?${query}`)
      .then((data) => setReport({ tab, data }))
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [tab, query]);

  async function exportCsv(type: string) {
    setError(null);
    const ok = await downloadCsv(
      `/exports/${type}?${query}`,
      `${type}-${period.from}-${period.to}.csv`,
    );
    if (!ok) setError('Export impossible.');
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Rapports"
        subtitle="Ventes, prévente, livraison et ventes perdues d'une période."
      />
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
      <LocalTabs tabs={TABS} value={tab} onChange={setTab} />
      {report?.tab === 'commercial' && <Commercial data={report.data as CommercialReportDto} />}
      {report?.tab === 'presales' && <Presales data={report.data as PresalesReportDto} />}
      {report?.tab === 'delivery' && <Delivery data={report.data as DeliveryReportDto} />}
      {report?.tab === 'lost-sales' && <LostSales data={report.data as LostSalesReportDto} />}

      {can('reports.export') && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Exports CSV</h2>
          <p className="text-sm text-muted">Période et secteur ci-dessus ; séparateur « ; ».</p>
          <div className="flex flex-wrap gap-2">
            {EXPORTS.filter((e) => !e.returns || returnsModule).map((e) => (
              <Button key={e.type} variant="secondary" onClick={() => void exportCsv(e.type)}>
                {e.label}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Tableau simple : en-têtes, lignes. */
function Table({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: (KeyLabel & { cells: ReactNode[] })[];
}) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Rien sur la période.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key ?? 'none'} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text-dark">{r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="py-1.5 pr-3">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Commercial({ data }: { data: CommercialReportDto }) {
  return (
    <>
      <Table
        title="Par jour"
        headers={['Jour', 'Commandes', 'CA']}
        rows={data.byDay.map((d) => ({
          key: d.date,
          label: formatDate(d.date),
          cells: [d.orders, formatDA(d.revenue)],
        }))}
      />
      <Table
        title="Par produit"
        headers={['Produit', 'Quantité (unité de base)', 'CA']}
        rows={data.byProduct.map((p) => ({ ...p, cells: [p.qty, formatDA(p.revenue)] }))}
      />
      <Table
        title="Par client"
        headers={['Client', 'Commandes', 'CA']}
        rows={data.byCustomer.map((c) => ({ ...c, cells: [c.orders, formatDA(c.revenue)] }))}
      />
    </>
  );
}

function Presales({ data }: { data: PresalesReportDto }) {
  const cells = (r: PresalesReportDto['bySeller'][number]) => [
    r.visits,
    r.orders,
    <Rate key="rate" value={r.conversion} />,
    formatDA(r.revenue),
  ];
  return (
    <>
      <Table
        title="Par pré-vendeur"
        headers={['Pré-vendeur', 'Visites', 'Commandes', 'Conversion', 'CA']}
        rows={data.bySeller.map((r) => ({ ...r, cells: cells(r) }))}
      />
      <Table
        title="Par secteur"
        headers={['Secteur', 'Visites', 'Commandes', 'Conversion', 'CA']}
        rows={data.byTerritory.map((r) => ({ ...r, cells: cells(r) }))}
      />
    </>
  );
}

function Delivery({ data }: { data: DeliveryReportDto }) {
  return (
    <>
      <Table
        title="Par livreur"
        headers={['Livreur', 'Livraisons', 'Livrées', 'Partielles', 'Échecs', 'Délai moyen']}
        rows={data.byDriver.map((r) => ({
          ...r,
          cells: [
            r.deliveries,
            r.delivered,
            r.partial,
            r.failed,
            r.averageDelayDays === null ? '—' : `${r.averageDelayDays} j`,
          ],
        }))}
      />
      <Table
        title="Échecs par motif"
        headers={['Motif', 'Échecs']}
        rows={data.failuresByReason.map((r) => ({ ...r, cells: [r.count] }))}
      />
    </>
  );
}

function LostSales({ data }: { data: LostSalesReportDto }) {
  const cells = (r: LostSalesReportDto['byProduct'][number]) => [r.lostSales, r.lostDemand];
  const headers = ['Ventes perdues', 'Demandes perdues'];
  return (
    <>
      <Table
        title="Par article"
        headers={['Article', ...headers]}
        rows={data.byProduct.map((r) => ({ ...r, cells: cells(r) }))}
      />
      <Table
        title="Par client"
        headers={['Client', ...headers]}
        rows={data.byCustomer.map((r) => ({ ...r, cells: cells(r) }))}
      />
      <Table
        title="Par vendeur"
        headers={['Vendeur', ...headers]}
        rows={data.bySeller.map((r) => ({ ...r, cells: cells(r) }))}
      />
    </>
  );
}
