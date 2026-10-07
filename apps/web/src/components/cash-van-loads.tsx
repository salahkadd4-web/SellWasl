'use client';

import type { LoadDto, ProductDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Select } from '@/components/ui';
import { emptyLine, type StockLine, StockLinesEditor, toPayload } from '@/components/stock-lines';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDate, LOAD_KIND, todayDate } from '@/lib/labels';
import { type StockWarehouse, warehouseLabel } from '@/lib/stock';

/**
 * Chargements cash van (UC-62, BR-CV-01) : le superviseur les prépare, le magasinier les valide
 * avec les quantités réellement chargées.
 */
export function CashVanLoads({
  warehouses,
  products,
  onChanged,
}: {
  warehouses: StockWarehouse[];
  products: ProductDto[];
  onChanged: () => void;
}) {
  const { can } = CompanyAuth.useAuth();
  const [planned, setPlanned] = useState<LoadDto[]>([]);
  const [planning, setPlanning] = useState(false);
  const [validating, setValidating] = useState<LoadDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlanned(await api<LoadDto[]>('company', '/loads/planned'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = () => {
    setPlanning(false);
    setValidating(null);
    void load();
    onChanged();
  };

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {can('loads.plan') && !planning && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setPlanning(true)}>
            Préparer un chargement cash van
          </Button>
        </div>
      )}
      {planning && (
        <PlanLoad
          warehouses={warehouses}
          products={products}
          onCancel={() => setPlanning(false)}
          onDone={done}
        />
      )}
      {validating && (
        <ValidateLoad load={validating} onCancel={() => setValidating(null)} onDone={done} />
      )}
      {planned.length > 0 && !validating && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Chargements préparés à valider</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            {planned.map((l) => (
              <div
                key={l.id}
                className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {warehouseLabel(l.truck)} · {l.user.name}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDate(l.date)} · {l.lines.length} article(s)
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">{LOAD_KIND[l.kind] ?? l.kind}</Badge>
                  {can('loads.load') && (
                    <Button variant="secondary" onClick={() => setValidating(l)}>
                      Valider le chargement
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function PlanLoad({
  warehouses,
  products,
  onCancel,
  onDone,
}: {
  warehouses: StockWarehouse[];
  products: ProductDto[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const trucks = warehouses.filter((w) => w.type === 'TRUCK' && w.assignedUser);
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [date, setDate] = useState(todayDate);
  const [lines, setLines] = useState<StockLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Repartir du dernier chargement du camion, en unité de base (UC-62). */
  async function fromLast() {
    setError(null);
    try {
      const last = await api<LoadDto | null>('company', `/loads/last?truckId=${truckId}`);
      if (!last) return setError("Ce camion n'a pas encore de chargement.");
      setLines(
        last.lines.map((l) => {
          const product = products.find((p) => p.variants.some((v) => v.id === l.variantId));
          const base = product?.units.find((u) => u.isBase);
          return {
            ...emptyLine(),
            variantId: l.variantId,
            unitId: base?.id ?? '',
            qty: String(l.qty),
          };
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function submit() {
    setError(null);
    const payload = toPayload(lines);
    if (!truckId) return setError('Choisissez le camion.');
    if (!payload)
      return setError('Chaque article doit avoir une unité et une quantité entière positive.');
    if (payload.length === 0) return setError('Ajoutez au moins un article.');
    setBusy(true);
    try {
      await api('company', '/loads/plan', {
        method: 'POST',
        headers: idempotencyKey(`load-plan:${truckId}:${date}`),
        body: JSON.stringify({ truckId, date, lines: payload }),
      });
      idempotencyDone(`load-plan:${truckId}:${date}`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">Préparer un chargement cash van</h2>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Select
          label="Camion"
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          options={trucks.map((t) => ({
            value: t.id,
            label: `${warehouseLabel(t)} · ${t.assignedUser!.firstName} ${t.assignedUser!.lastName}`,
          }))}
        />
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Button variant="secondary" onClick={() => void fromLast()} disabled={!truckId}>
          Reprendre le dernier
        </Button>
      </div>
      <StockLinesEditor products={products} lines={lines} onChange={setLines} />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          Enregistrer la préparation
        </Button>
      </div>
    </Card>
  );
}

/** Le magasinier saisit ce qui est réellement chargé, en unité de base. */
function ValidateLoad({
  load,
  onCancel,
  onDone,
}: {
  load: LoadDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [loaded, setLoaded] = useState<Record<string, string>>(() =>
    Object.fromEntries(load.lines.map((l) => [l.variantId, String(l.qty)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const lines = load.lines.map((l) => ({
      variantId: l.variantId,
      loadedQty: Number(loaded[l.variantId] ?? ''),
    }));
    if (lines.some((l) => !Number.isInteger(l.loadedQty) || l.loadedQty < 0))
      return setError('Les quantités chargées doivent être des nombres entiers positifs.');
    setError(null);
    setBusy(true);
    try {
      await api('company', `/loads/${load.id}/validate`, {
        method: 'POST',
        headers: idempotencyKey(`load:${load.id}`),
        body: JSON.stringify({ lines }),
      });
      idempotencyDone(`load:${load.id}`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">
        Valider · {warehouseLabel(load.truck)} · {load.user.name}
      </h2>
      <p className="text-sm text-muted">Quantités réellement chargées, en unité de base.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Article</th>
              <th className="py-2 pr-3 font-medium">Prévu</th>
              <th className="py-2 pr-3 font-medium">Chargé</th>
            </tr>
          </thead>
          <tbody>
            {load.lines.map((l) => (
              <tr key={l.variantId} className="border-t border-border">
                <td className="py-1.5 pr-3 text-text-dark">{articleLabel(l)}</td>
                <td className="py-1.5 pr-3">{l.qty}</td>
                <td className="py-1.5 pr-3">
                  <input
                    aria-label={`Chargé pour ${articleLabel(l)}`}
                    inputMode="numeric"
                    value={loaded[l.variantId] ?? ''}
                    onChange={(e) => setLoaded((x) => ({ ...x, [l.variantId]: e.target.value }))}
                    className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          Valider le chargement
        </Button>
      </div>
    </Card>
  );
}
