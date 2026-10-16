'use client';

import type {
  CommercialReportDto,
  CompanyUser,
  DeliveryReportDto,
  PresalesReportDto,
  ProductDto,
  ReturnsTrendDto,
  SalesTrendDto,
  TerritoryDto,
} from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { LocalTabs, monthToDate, type Period, PeriodFields } from '@/components/analytics';
import { BarChart, TrendChart } from '@/components/charts';
import { Alert, Button, Card, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatRate, trendLabel } from '@/lib/labels';

type Chart = 'sales' | 'ranking' | 'top' | 'returns';
type Filter = 'territoryId' | 'sellerId' | 'driverId' | 'productId';
type Filters = Record<Filter, string>;

/** Filtres de chaque graphique ; leurs valeurs sont gardées d'un graphique à l'autre. */
const CHART_FILTERS: Record<Chart, Filter[]> = {
  sales: ['territoryId', 'sellerId', 'productId'],
  ranking: ['territoryId'],
  top: ['territoryId', 'sellerId'],
  returns: ['territoryId', 'sellerId', 'driverId', 'productId'],
};
const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];

/** Adresse de l'API d'un graphique, avec ses seuls filtres, sous les noms qu'elle attend. */
function chartPath(chart: Chart, sub: string, period: Period, f: Filters): string {
  const params = new URLSearchParams({ from: period.from, to: period.to });
  const set = (name: string, value: string) => value && params.set(name, value);
  set('territoryId', f.territoryId);
  if (chart === 'sales' || chart === 'top') set('userId', f.sellerId);
  if (chart === 'sales' || chart === 'returns') set('productId', f.productId);
  if (chart === 'returns') {
    set('sellerId', f.sellerId);
    set('driverId', f.driverId);
  }
  const path = {
    sales: '/reports/sales-trend',
    ranking: sub === 'drivers' ? '/reports/delivery' : '/reports/presales',
    top: '/reports/commercial',
    returns: '/returns/trend',
  }[chart];
  return `${path}?${params.toString()}`;
}

/** Choix d'une variante d'un graphique : boutons, comme les raccourcis de période. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          key={o.value}
          variant={o.value === value ? 'primary' : 'secondary'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Statistiques en graphiques (module ANALYTICS) : ventes, classement, top 10, retours. */
export default function StatisticsPage() {
  const { me, can } = CompanyAuth.useAuth();
  const returnsModule = !!me?.modules.includes('RETURNS_ANALYSIS') && can('returns.read');
  const [chart, setChart] = useState<Chart>('sales');
  const [period, setPeriod] = useState<Period>(monthToDate);
  const [filters, setFilters] = useState<Filters>({
    territoryId: '',
    sellerId: '',
    driverId: '',
    productId: '',
  });
  const [measure, setMeasure] = useState<'revenue' | 'orders'>('revenue');
  const [ranking, setRanking] = useState<'sellers' | 'drivers'>('sellers');
  const [top, setTop] = useState<'products' | 'customers'>('products');
  const [territories, setTerritories] = useState<TerritoryDto[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [result, setResult] = useState<{ path: string; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = chartPath(chart, ranking, period, filters);

  useEffect(() => {
    api<TerritoryDto[]>('company', '/territories')
      .then(setTerritories)
      .catch(() => setTerritories([]));
    api<CompanyUser[]>('company', '/users')
      .then(setUsers)
      .catch(() => setUsers([]));
    api<ProductDto[]>('company', '/products?status=ACTIVE')
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    setError(null);
    api<unknown>('company', path)
      .then((data) => setResult({ path, data }))
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [path]);

  const tabs: { value: Chart; label: string }[] = [
    { value: 'sales', label: 'Ventes' },
    { value: 'ranking', label: 'Classement' },
    { value: 'top', label: 'Top 10' },
    ...(returnsModule ? [{ value: 'returns' as const, label: 'Retours' }] : []),
  ];
  const active = (u: CompanyUser) => u.status === 'ACTIVE';
  const person = (u: CompanyUser) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName} (${u.code})`,
  });
  const lists: Record<
    Filter,
    { label: string; all: string; options: { value: string; label: string }[] }
  > = {
    territoryId: {
      label: 'Secteur',
      all: 'Tous les secteurs',
      options: territories.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` })),
    },
    sellerId: {
      label: 'Vendeur',
      all: 'Tous les vendeurs',
      options: users.filter((u) => active(u) && SELLER_ROLES.includes(u.role.code)).map(person),
    },
    driverId: {
      label: 'Livreur',
      all: 'Tous les livreurs',
      options: users.filter((u) => active(u) && u.role.code === 'LIVREUR').map(person),
    },
    productId: {
      label: 'Produit',
      all: 'Tous les produits',
      options: products.map((p) => ({ value: p.id, label: p.name })),
    },
  };
  // Une liste inaccessible (droit absent) ou vide n'est pas proposée
  const shown = CHART_FILTERS[chart].filter((f) => lists[f].options.length > 0);
  const data = result?.path === path ? result.data : null;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Statistiques"
        subtitle="Ventes, vendeurs, produits et retours d'une période, en graphiques."
      />
      <Card className="flex flex-col gap-3">
        <PeriodFields value={period} onChange={setPeriod} />
        {shown.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((f) => (
              <Select
                key={f}
                label={lists[f].label}
                value={filters[f]}
                onChange={(e) => setFilters({ ...filters, [f]: e.target.value })}
                options={[{ value: '', label: lists[f].all }, ...lists[f].options]}
              />
            ))}
          </div>
        )}
      </Card>
      {error && <Alert>{error}</Alert>}
      <LocalTabs tabs={tabs} value={chart} onChange={setChart} />

      {chart === 'sales' && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Ventes dans le temps</h2>
          <Choice
            value={measure}
            onChange={setMeasure}
            options={[
              { value: 'revenue', label: "Chiffre d'affaires" },
              { value: 'orders', label: 'Commandes' },
            ]}
          />
          {data !== null && <SalesChart data={data as SalesTrendDto} measure={measure} />}
        </Card>
      )}

      {chart === 'ranking' && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Classement</h2>
          <Choice
            value={ranking}
            onChange={setRanking}
            options={[
              { value: 'sellers', label: 'Vendeurs' },
              { value: 'drivers', label: 'Livreurs' },
            ]}
          />
          {data !== null &&
            (ranking === 'sellers' ? (
              <Bars
                format={formatDA}
                rows={(data as PresalesReportDto).bySeller.map((r) => ({
                  label: `${r.label} · ${count(r.visits, 'visite', 'visites')} · conversion ${formatRate(r.conversion)}`,
                  value: r.revenue,
                }))}
              />
            ) : (
              <Bars
                format={(n) => count(n, 'livrée', 'livrées')}
                rows={(data as DeliveryReportDto).byDriver
                  .map((r) => ({
                    label: `${r.label} · ${count(r.partial, 'partielle', 'partielles')} · ${count(r.failed, 'échec', 'échecs')}`,
                    value: r.delivered,
                  }))
                  .sort((a, b) => b.value - a.value)}
              />
            ))}
        </Card>
      )}

      {chart === 'top' && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Top 10</h2>
          <Choice
            value={top}
            onChange={setTop}
            options={[
              { value: 'products', label: 'Produits' },
              { value: 'customers', label: 'Clients' },
            ]}
          />
          {data !== null && (
            <Bars
              format={formatDA}
              rows={(top === 'products'
                ? (data as CommercialReportDto).byProduct
                : (data as CommercialReportDto).byCustomer
              )
                .slice(0, 10)
                .map((r) => ({ label: r.label, value: r.revenue }))}
            />
          )}
        </Card>
      )}

      {chart === 'returns' && returnsModule && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Retours dans le temps</h2>
          {data !== null && <ReturnsChart data={data as ReturnsTrendDto} />}
        </Card>
      )}
    </div>
  );
}

function SalesChart({ data, measure }: { data: SalesTrendDto; measure: 'revenue' | 'orders' }) {
  const revenue = measure === 'revenue';
  const label = revenue ? "Chiffre d'affaires" : 'Commandes';
  return (
    <TrendChart
      title={label}
      labels={data.points.map((p) => trendLabel(p.start, data.unit))}
      series={[
        {
          key: measure,
          label,
          tone: 'primary',
          values: data.points.map((p) => (revenue ? p.revenue : p.orders)),
        },
      ]}
      format={revenue ? formatDA : (n) => count(n, 'commande', 'commandes')}
    />
  );
}

function ReturnsChart({ data }: { data: ReturnsTrendDto }) {
  return (
    <TrendChart
      title="Retours"
      labels={data.points.map((p) => trendLabel(p.start, data.unit))}
      series={[
        {
          key: 'refused',
          label: 'Refusé à la livraison',
          tone: 'danger',
          values: data.points.map((p) => p.refusedValue),
        },
        {
          key: 'returned',
          label: 'Retourné au dépôt',
          tone: 'warning',
          dash: 'dashed',
          values: data.points.map((p) => p.returnedValue),
        },
        {
          key: 'resold',
          label: 'Revendu en tournée',
          tone: 'success',
          dash: 'dotted',
          values: data.points.map((p) => p.resoldValue),
        },
      ]}
      format={formatDA}
      detail={(i) => `Taux de refus : ${formatRate(data.points[i]!.refusalRate)}`}
    />
  );
}

/** Barres classées ; rien sur la période : même message que les tableaux des rapports. */
function Bars({
  rows,
  format,
}: {
  rows: { label: string; value: number }[];
  format: (value: number) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">Rien sur la période.</p>;
  return <BarChart data={rows} format={format} />;
}
