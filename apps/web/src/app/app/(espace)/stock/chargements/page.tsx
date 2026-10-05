'use client';

import type { LoadDto, ProductDto, RouteSummaryDto, StockRowDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { emptyLine, type StockLine, StockLinesEditor, toPayload } from '@/components/stock-lines';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDate, formatDateTime, LOAD_KIND, todayDate } from '@/lib/labels';
import { type StockWarehouse, useWarehouses, warehouseLabel } from '@/lib/stock';

/**
 * Chargement des camions (UC-42) : transfert du dépôt vers le camion, pris sur le disponible. La
 * réception par le livreur ou le vendeur arrive avec son application (phase 20).
 */
export default function LoadsPage() {
  const { can } = CompanyAuth.useAuth();
  const { warehouses, error: warehousesError } = useWarehouses();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [date, setDate] = useState(todayDate);
  const [loads, setLoads] = useState<LoadDto[] | null>(null);
  const [detail, setDetail] = useState<LoadDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [readyRoutes, setReadyRoutes] = useState<RouteSummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRoutes = can('preparation.do');

  useEffect(() => {
    api<ProductDto[]>('company', '/products?status=ACTIVE')
      .then(setProducts)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLoads(await api<LoadDto[]>('company', `/loads?date=${date}`));
      if (canRoutes)
        setReadyRoutes(
          (await api<RouteSummaryDto[]>('company', '/routes/preparing')).filter(
            (r) => r.status === 'READY',
          ),
        );
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date, canRoutes]);

  /** Tournée préparée : le préparé part vers le camion du livreur (BR-PRE-04). */
  async function loadRoute(route: RouteSummaryDto) {
    if (!confirm(`Charger le camion de ${route.driver.name} avec les quantités préparées ?`))
      return;
    setError(null);
    setBusy(true);
    try {
      const created = await api<LoadDto>('company', `/routes/${route.id}/load`, { method: 'POST' });
      setDate(created.date);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Chargements"
        subtitle="Marchandise transférée du dépôt vers les camions des livreurs et des vendeurs cash van."
        action={
          can('loads.load') &&
          !creating && <Button onClick={() => setCreating(true)}>Nouveau chargement</Button>
        }
      />
      <StockTabs />
      {(error ?? warehousesError) && <Alert>{error ?? warehousesError}</Alert>}
      {readyRoutes.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Tournées prêtes à charger</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            {readyRoutes.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {r.driver.name} · {r.truck ? warehouseLabel(r.truck) : 'Pas de camion'}
                  </span>
                  <span className="text-xs text-muted">
                    Livraison du {formatDate(r.deliveryDate)} · {r.ordersCount} commande(s)
                  </span>
                </span>
                {can('loads.load') && (
                  <Button variant="secondary" disabled={busy} onClick={() => void loadRoute(r)}>
                    Charger le camion
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {creating && (
        <NewLoad
          warehouses={warehouses}
          products={products}
          defaultDate={date}
          onCancel={() => setCreating(false)}
          onDone={(created) => {
            setCreating(false);
            setDate(created.date);
            void load();
          }}
        />
      )}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </Card>
      {loads && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          {loads.length === 0 && <p className="text-sm text-muted">Aucun chargement ce jour-là.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {loads.map((l) => (
              <button
                key={l.id}
                onClick={() => setDetail(l)}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {warehouseLabel(l.truck)} · {l.user.name}
                  </span>
                  <span className="text-xs text-muted">
                    {l.loadedAt ? formatDateTime(l.loadedAt) : '—'} · {l.lines.length} article(s)
                  </span>
                </span>
                <Badge tone="neutral">{LOAD_KIND[l.kind] ?? l.kind}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}
      {detail && (
        <Modal
          title={`Chargement · ${warehouseLabel(detail.truck)}`}
          onClose={() => setDetail(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {detail.user.name} · {LOAD_KIND[detail.kind]} · quantités en unité de base
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {detail.lines.map((l) => (
                <div
                  key={l.variantId}
                  className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
                >
                  <span className="text-text-dark">{articleLabel(l)}</span>
                  <span className="text-muted">{l.qty}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewLoad({
  warehouses,
  products,
  defaultDate,
  onCancel,
  onDone,
}: {
  warehouses: StockWarehouse[];
  products: ProductDto[];
  defaultDate: string;
  onCancel: () => void;
  onDone: (created: LoadDto) => void;
}) {
  const trucks = warehouses.filter((w) => w.type === 'TRUCK' && w.assignedUser);
  const depots = warehouses.filter((w) => w.type === 'DEPOT');
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [depotId, setDepotId] = useState(depots[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [lines, setLines] = useState<StockLine[]>([emptyLine()]);
  const [available, setAvailable] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!depotId) return;
    api<StockRowDto[]>('company', `/stock?warehouseId=${depotId}`)
      .then((rows) => setAvailable(new Map(rows.map((r) => [r.variantId, r.available]))))
      .catch((err) => setError(errorMessage(err)));
  }, [depotId]);

  async function submit() {
    setError(null);
    const payload = toPayload(lines);
    if (!truckId) return setError('Choisissez le camion.');
    if (!payload)
      return setError('Chaque article doit avoir une unité et une quantité entière positive.');
    if (payload.length === 0) return setError('Ajoutez au moins un article.');
    setBusy(true);
    try {
      onDone(
        await api<LoadDto>('company', '/loads', {
          method: 'POST',
          body: JSON.stringify({
            truckId,
            date,
            fromWarehouseId: depotId || undefined,
            lines: payload,
          }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">Nouveau chargement</h2>
      {trucks.length === 0 && (
        <p className="text-sm text-muted">
          Aucun camion n’a de conducteur : affectez-les dans Paramètres, Dépôts et camions.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Camion"
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          options={trucks.map((t) => ({
            value: t.id,
            label: `${warehouseLabel(t)} · ${t.assignedUser!.firstName} ${t.assignedUser!.lastName}`,
          }))}
        />
        <Select
          label="Depuis le dépôt"
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
          options={depots.map((d) => ({ value: d.id, label: warehouseLabel(d) }))}
        />
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>
      <StockLinesEditor
        products={products}
        lines={lines}
        onChange={setLines}
        available={available}
      />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={() => void submit()} disabled={busy || trucks.length === 0}>
          Valider le chargement
        </Button>
      </div>
    </Card>
  );
}
