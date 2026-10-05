'use client';

import type { StockRowDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, PageTitle, Select } from '@/components/ui';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel } from '@/lib/labels';
import { useWarehouses, warehouseLabel } from '@/lib/stock';

/**
 * Stock par entrepôt (BR-STK-02) : physique, réservé, disponible, en unité de base. Les articles
 * sous leur seuil sont signalés ; le seuil se règle ici.
 */
export default function StockPage() {
  const { can } = CompanyAuth.useAuth();
  const { warehouses, error: warehousesError } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [rows, setRows] = useState<StockRowDto[] | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId && warehouses[0]) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setError(null);
    setSaved(false);
    try {
      const list = await api<StockRowDto[]>('company', `/stock?warehouseId=${warehouseId}`);
      setRows(list);
      setThresholds(
        Object.fromEntries(
          list.map((r) => [r.variantId, r.lowStockQty === null ? '' : String(r.lowStockQty)]),
        ),
      );
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = can('products.write');
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const isDepot = warehouse?.type === 'DEPOT';

  async function saveThresholds() {
    if (!rows) return;
    setError(null);
    const entries = rows.flatMap((r) => {
      const raw = thresholds[r.variantId] ?? '';
      const value = raw === '' ? null : Number(raw);
      return value === r.lowStockQty ? [] : [{ variantId: r.variantId, lowStockQty: value }];
    });
    if (
      entries.some(
        (e) => e.lowStockQty !== null && (!Number.isInteger(e.lowStockQty) || e.lowStockQty < 0),
      )
    )
      return setError('Les seuils doivent être des nombres entiers positifs.');
    if (entries.length === 0) return setError('Aucun seuil modifié.');
    setBusy(true);
    try {
      await api('company', '/stock/thresholds', {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const low = rows?.filter((r) => r.isLow).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Stock"
        subtitle="Quantités en unité de base : physique, réservé par les commandes, disponible."
        action={
          editable &&
          isDepot && (
            <Button onClick={() => void saveThresholds()} disabled={busy || !rows}>
              Enregistrer les seuils
            </Button>
          )
        }
      />
      <StockTabs />
      {(error ?? warehousesError) && <Alert>{error ?? warehousesError}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Seuils enregistrés.
        </p>
      )}
      <Card className="grid gap-3 sm:grid-cols-[2fr_1fr] sm:items-end">
        <Select
          label="Entrepôt"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={warehouses.map((w) => ({
            value: w.id,
            label: `${w.type === 'DEPOT' ? 'Dépôt' : 'Camion'} · ${warehouseLabel(w)}`,
          }))}
        />
        {isDepot && (
          <p className="text-sm text-muted">
            {low > 0 ? `${low} article(s) sous le seuil.` : 'Aucun article sous le seuil.'}
          </p>
        )}
      </Card>
      {rows && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Article</th>
                <th className="py-2 pr-3 font-medium">Physique</th>
                <th className="py-2 pr-3 font-medium">Réservé</th>
                <th className="py-2 pr-3 font-medium">Disponible</th>
                {isDepot && <th className="py-2 pr-3 font-medium">Seuil</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text-dark">
                    <span className="flex flex-wrap items-center gap-2">
                      {articleLabel(r)}
                      {r.isLow && <Badge tone="danger">Sous le seuil</Badge>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{r.physical}</td>
                  <td className="py-1.5 pr-3">{r.reserved}</td>
                  <td className="py-1.5 pr-3 font-semibold text-text-dark">{r.available}</td>
                  {isDepot && (
                    <td className="py-1.5 pr-3">
                      <input
                        aria-label={`Seuil de ${articleLabel(r)}`}
                        inputMode="numeric"
                        disabled={!editable}
                        value={thresholds[r.variantId] ?? ''}
                        placeholder="—"
                        onChange={(e) => {
                          setSaved(false);
                          setThresholds((t) => ({ ...t, [r.variantId]: e.target.value }));
                        }}
                        className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
