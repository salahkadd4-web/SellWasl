'use client';

import type {
  RefusalDto,
  ReturnAxis,
  ReturnFactDto,
  ReturnFactKindCode,
  ReturnsAxisDto,
  ReturnsCrossDto,
} from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { LocalTabs, monthToDate, type Period, PeriodFields, Rate } from '@/components/analytics';
import {
  Alert,
  Badge,
  Button,
  Card,
  FullPageMessage,
  Modal,
  PageTitle,
  Select,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import {
  CONDITION_LABELS,
  FACT_KIND_LABELS,
  formatDA,
  formatDate,
  formatDateTime,
} from '@/lib/labels';

const AXES: { value: ReturnAxis; label: string }[] = [
  { value: 'product', label: 'Produit' },
  { value: 'lot', label: 'Lot' },
  { value: 'supplier', label: 'Fournisseur' },
  { value: 'seller', label: 'Pré-vendeur' },
  { value: 'driver', label: 'Livreur' },
  { value: 'customer', label: 'Client' },
  { value: 'territory', label: 'Secteur' },
  { value: 'route', label: 'Tournée' },
  { value: 'reason', label: 'Motif de refus' },
  { value: 'condition', label: 'État constaté' },
];
const KINDS: ReturnFactKindCode[] = ['REFUSAL', 'RETURN', 'RESALE', 'GAP'];

type Tab = 'axis' | 'cross' | 'contests';

/** Ce qui ouvre la liste des faits : un type, et une valeur d'un ou deux axes. */
interface Drill {
  kind: ReturnFactKindCode;
  axis: ReturnAxis;
  value: string | null;
  label: string;
}

/** Analyse des retours (module RETURNS_ANALYSIS, phase 21). */
export default function ReturnsPage() {
  const { me, can } = CompanyAuth.useAuth();
  const [tab, setTab] = useState<Tab>('axis');
  const [period, setPeriod] = useState<Period>(monthToDate);
  const [drill, setDrill] = useState<Drill | null>(null);

  if (!me) return null;
  if (!me.modules.includes('RETURNS_ANALYSIS') || !can('returns.read'))
    return <FullPageMessage>Le module d'analyse des retours n'est pas actif.</FullPageMessage>;

  const query = `from=${period.from}&to=${period.to}`;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'axis', label: 'Par axe' },
    { value: 'cross', label: 'Vue croisée' },
    ...(can('returns.decide') ? [{ value: 'contests' as const, label: 'Contestations' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Analyse des retours"
        subtitle="Refus à la livraison, retours au déchargement, reventes en tournée et écarts."
      />
      <Card>
        <PeriodFields value={period} onChange={setPeriod} />
      </Card>
      <LocalTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'axis' && <ByAxis query={query} onDrill={setDrill} />}
      {tab === 'cross' && <Cross query={query} />}
      {tab === 'contests' && <Contests />}
      {drill && <Facts query={query} drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function ByAxis({ query, onDrill }: { query: string; onDrill: (d: Drill) => void }) {
  const [axis, setAxis] = useState<ReturnAxis>('product');
  const [data, setData] = useState<ReturnsAxisDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<ReturnsAxisDto>('company', `/returns/axis/${axis}?${query}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [axis, query]);

  const cell = (value: number, kind: ReturnFactKindCode, row: ReturnsAxisDto['rows'][number]) =>
    value === 0 ? (
      '—'
    ) : (
      <button
        type="button"
        className="font-medium text-deep-blue hover:underline"
        onClick={() => onDrill({ kind, axis, value: row.key, label: row.label })}
      >
        {formatDA(value)}
      </button>
    );

  return (
    <Card className="flex flex-col gap-3">
      <Select
        label="Axe"
        value={axis}
        onChange={(e) => setAxis(e.target.value as ReturnAxis)}
        options={AXES}
      />
      {error && <Alert>{error}</Alert>}
      {data && data.rows.length === 0 && (
        <p className="text-sm text-muted">Aucun refus ni retour sur la période.</p>
      )}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">
                  {AXES.find((a) => a.value === axis)?.label}
                </th>
                <th className="py-2 pr-3 font-medium">Refus</th>
                <th className="py-2 pr-3 font-medium">Valeur refusée</th>
                <th className="py-2 pr-3 font-medium">Retourné</th>
                <th className="py-2 pr-3 font-medium">Revendu</th>
                <th className="py-2 pr-3 font-medium">Coût net</th>
                <th className="py-2 pr-3 font-medium">Écarts</th>
                <th className="py-2 pr-3 font-medium">{data.rateLabel}</th>
                {data.rows.some((r) => r.defectiveShare) && (
                  <th className="py-2 pr-3 font-medium">Part défectueuse</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key ?? 'none'} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text-dark">{r.label}</td>
                  <td className="py-1.5 pr-3">{r.refusals}</td>
                  <td className="py-1.5 pr-3">{cell(r.refusedValue, 'REFUSAL', r)}</td>
                  <td className="py-1.5 pr-3">{cell(r.returnedValue, 'RETURN', r)}</td>
                  <td className="py-1.5 pr-3">{cell(r.resoldValue, 'RESALE', r)}</td>
                  <td className="py-1.5 pr-3">{formatDA(r.netCost)}</td>
                  <td className="py-1.5 pr-3">
                    {r.gapQty === 0 ? '—' : `${r.gapQty} (${formatDA(r.gapValue)})`}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Rate value={r.rate} />
                  </td>
                  {r.defectiveShare && (
                    <td className="py-1.5 pr-3">
                      <Rate value={r.defectiveShare} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Cross({ query }: { query: string }) {
  const [rows, setRows] = useState<ReturnAxis>('product');
  const [cols, setCols] = useState<ReturnAxis>('driver');
  const [kind, setKind] = useState<ReturnFactKindCode>('RETURN');
  const [data, setData] = useState<ReturnsCrossDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rows === cols) return setError('Choisissez deux axes différents.');
    setError(null);
    api<ReturnsCrossDto>(
      'company',
      `/returns/cross?${query}&rows=${rows}&cols=${cols}&kind=${kind}`,
    )
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [rows, cols, kind, query]);

  const valueOf = (row: string | null, col: string | null) =>
    data?.cells.find((c) => c.row === row && c.col === col);

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Lignes"
          value={rows}
          onChange={(e) => setRows(e.target.value as ReturnAxis)}
          options={AXES}
        />
        <Select
          label="Colonnes"
          value={cols}
          onChange={(e) => setCols(e.target.value as ReturnAxis)}
          options={AXES}
        />
        <Select
          label="Faits"
          value={kind}
          onChange={(e) => setKind(e.target.value as ReturnFactKindCode)}
          options={KINDS.map((k) => ({ value: k, label: FACT_KIND_LABELS[k]! }))}
        />
      </div>
      {error && <Alert>{error}</Alert>}
      {!error && data && data.cells.length === 0 && (
        <p className="text-sm text-muted">Rien sur la période.</p>
      )}
      {!error && data && data.cells.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium" />
                {data.cols.map((c) => (
                  <th key={c.key ?? 'none'} className="py-2 pr-3 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key ?? 'none'} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text-dark">{r.label}</td>
                  {data.cols.map((c) => {
                    const v = valueOf(r.key, c.key);
                    return (
                      <td key={c.key ?? 'none'} className="py-1.5 pr-3">
                        {v ? (
                          <>
                            {formatDA(v.value)}
                            <span className="block text-xs text-muted">{v.qty} unités</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Contests() {
  const [rows, setRows] = useState<RefusalDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<RefusalDto[]>('company', '/refusals/contested'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: RefusalDto, upheld: boolean) {
    setError(null);
    setBusy(r.deliveryId);
    try {
      await api('company', `/refusals/${r.deliveryId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ upheld }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">Refus contestés par les pré-vendeurs</h2>
      <p className="text-sm text-muted">
        Le motif déclaré par le livreur est un indice, pas une preuve. Retenue, la contestation
        retire le refus des indicateurs du client.
      </p>
      {error && <Alert>{error}</Alert>}
      {rows?.length === 0 && <p className="text-sm text-muted">Aucune contestation à trancher.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          {rows.map((r) => (
            <div
              key={r.deliveryId}
              className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
            >
              <span className="flex flex-col">
                <span className="font-medium text-text-dark">
                  {r.customer.name}{' '}
                  <span className="font-mono text-xs text-muted">{r.order.number}</span>
                </span>
                <span className="text-xs text-muted">
                  {formatDate(r.date)} · livreur {r.driver} · pré-vendeur {r.seller} · motif{' '}
                  {r.reason ?? '—'} · {formatDA(r.refusedValue)}
                </span>
                <span className="text-sm text-text-dark">« {r.contestComment} »</span>
                <span className="text-xs text-muted">
                  Contesté le {formatDateTime(r.contestedAt)}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <Button disabled={busy === r.deliveryId} onClick={() => void decide(r, true)}>
                  Retenir la contestation
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === r.deliveryId}
                  onClick={() => void decide(r, false)}
                >
                  Confirmer le refus
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Facts({ query, drill, onClose }: { query: string; drill: Drill; onClose: () => void }) {
  const [rows, setRows] = useState<ReturnFactDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = drill.value ?? 'none';
    api<ReturnFactDto[]>(
      'company',
      `/returns/facts?${query}&kind=${drill.kind}&axis=${drill.axis}&value=${encodeURIComponent(value)}`,
    )
      .then(setRows)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [query, drill]);

  return (
    <Modal title={`${FACT_KIND_LABELS[drill.kind]} · ${drill.label}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {rows?.length === 0 && <p className="text-sm text-muted">Aucun fait.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          {rows.map((f) => (
            <div
              key={f.id}
              className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text-dark">{f.article}</span>
                {f.condition && <Badge>{CONDITION_LABELS[f.condition]}</Badge>}
                <span className="text-sm text-text-dark">
                  {f.qty} unités · {formatDA(f.value)}
                </span>
              </span>
              <span className="text-xs text-muted">
                {[
                  formatDate(f.date),
                  f.customer,
                  f.driver && `livreur ${f.driver}`,
                  f.seller && `pré-vendeur ${f.seller}`,
                  f.reason && `motif ${f.reason}`,
                  f.lot && `lot ${f.lot}`,
                  f.supplier,
                  f.order && `commande ${f.order.number}`,
                  f.delivery && `bon ${f.delivery.number}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
