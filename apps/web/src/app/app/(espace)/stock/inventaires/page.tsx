'use client';

import type {
  InventoryDto,
  InventoryResult,
  Page,
  ProductDto,
  StockRowDto,
} from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Modal, PageTitle, Select } from '@/components/ui';
import { type Listed, ShowMore } from '@/components/show-more';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDateTime } from '@/lib/labels';
import { useWarehouses, warehouseLabel } from '@/lib/stock';

/**
 * Inventaire du dépôt (UC-44, BR-STK-06) : comptage enregistré au fur et à mesure, puis validation.
 * Chaque écart devient un ajustement ; un article non compté ne change pas.
 */
export default function InventoriesPage() {
  const { can } = CompanyAuth.useAuth();
  const canCount = can('inventory.count');
  const { warehouses, error: warehousesError } = useWarehouses();
  const depots = warehouses.filter((w) => w.type === 'DEPOT');
  const [inventoriesList, setInventoriesList] = useState<Listed<InventoryDto> | null>(null);
  const inventories = inventoriesList?.page.data ?? null;
  const [open, setOpen] = useState<InventoryDto | null>(null);
  const [detail, setDetail] = useState<InventoryDto | null>(null);
  const [result, setResult] = useState<InventoryResult | null>(null);
  const [depotId, setDepotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!depotId && depots[0]) setDepotId(depots[0].id);
  }, [depots, depotId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const path = '/inventories';
      setInventoriesList({ path, page: await api<Page<InventoryDto>>('company', path) });
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const created = await api<InventoryDto>('company', '/inventories', {
        method: 'POST',
        body: JSON.stringify({ warehouseId: depotId }),
      });
      setOpen(created);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Inventaires"
        subtitle="Le compté devient le stock réel du dépôt ; chaque écart est ajusté et audité."
      />
      <StockTabs />
      {(error ?? warehousesError) && <Alert>{error ?? warehousesError}</Alert>}
      {result && (
        <div className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          <p>Inventaire validé : {result.adjustments} ajustement(s).</p>
          {result.releasedLines.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {result.releasedLines.map((l) => (
                <li key={`${l.orderNumber}-${l.variantId}`}>
                  Commande {l.orderNumber} ({l.customerName}) : {l.released} en rupture
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canCount && !open && (
        <Card className="grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
          <Select
            label="Dépôt à compter"
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
            options={depots.map((d) => ({ value: d.id, label: warehouseLabel(d) }))}
          />
          <Button onClick={() => void start()} disabled={busy || !depotId}>
            Nouvel inventaire
          </Button>
        </Card>
      )}
      {open && (
        <DraftCount
          inventory={open}
          editable={canCount}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
          onValidated={(r) => {
            setOpen(null);
            setResult(r);
            void load();
          }}
        />
      )}
      {inventories && (
        <Card className="flex flex-col gap-3">
          {inventories.length === 0 && <p className="text-sm text-muted">Aucun inventaire.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {inventories.map((i) => (
              <button
                key={i.id}
                onClick={() => (i.status === 'DRAFT' ? setOpen(i) : setDetail(i))}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">{warehouseLabel(i.warehouse)}</span>
                  <span className="text-xs text-muted">
                    Commencé {formatDateTime(i.createdAt)}
                    {i.validatedAt ? ` · validé ${formatDateTime(i.validatedAt)}` : ''} ·{' '}
                    {i.lines.length} article(s) compté(s)
                  </span>
                </span>
                <Badge tone={i.status === 'DRAFT' ? 'warning' : 'success'}>
                  {i.status === 'DRAFT' ? 'Brouillon' : 'Validé'}
                </Badge>
              </button>
            ))}
          </div>
          <ShowMore list={inventoriesList} onChange={setInventoriesList} />
        </Card>
      )}
      {detail && (
        <Modal title="Inventaire validé" onClose={() => setDetail(null)}>
          <div className="overflow-hidden rounded-xl border border-border">
            {detail.lines.map((l) => (
              <div
                key={l.variantId}
                className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
              >
                <span className="text-text-dark">{articleLabel(l)}</span>
                <span className={l.gapQty === 0 ? 'text-muted' : 'font-semibold text-error'}>
                  {l.expectedQty} → {l.countedQty}
                  {l.gapQty !== 0 ? ` (${l.gapQty > 0 ? '+' : ''}${l.gapQty})` : ''}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Comptage d'un brouillon, en unité de base ; un champ vide : article non compté. */
function DraftCount({
  inventory,
  editable,
  onClose,
  onChanged,
  onValidated,
}: {
  inventory: InventoryDto;
  editable: boolean;
  onClose: () => void;
  onChanged: () => void;
  onValidated: (result: InventoryResult) => void;
}) {
  const [rows, setRows] = useState<StockRowDto[]>([]);
  const [baseUnits, setBaseUnits] = useState<Map<string, string>>(new Map());
  const [counted, setCounted] = useState<Record<string, string>>(() =>
    Object.fromEntries(inventory.lines.map((l) => [l.variantId, String(l.countedQty)])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<StockRowDto[]>('company', `/stock?warehouseId=${inventory.warehouse.id}`),
      api<ProductDto[]>('company', '/products?status=ACTIVE'),
    ])
      .then(([stock, products]) => {
        setRows(stock);
        setBaseUnits(
          new Map(
            products.flatMap((p) => {
              const base = p.units.find((u) => u.isBase)!;
              return p.variants.map((v) => [v.id, base.id] as const);
            }),
          ),
        );
      })
      .catch((err) => setError(errorMessage(err)));
  }, [inventory.warehouse.id]);

  async function save() {
    const lines = Object.entries(counted)
      .filter(([, v]) => v !== '')
      .map(([variantId, v]) => ({ variantId, unitId: baseUnits.get(variantId)!, qty: Number(v) }));
    if (lines.some((l) => !Number.isInteger(l.qty) || l.qty < 0)) {
      setError('Les quantités comptées doivent être des nombres entiers positifs.');
      return false;
    }
    await api('company', `/inventories/${inventory.id}/lines`, {
      method: 'PUT',
      body: JSON.stringify({ lines }),
    });
    return true;
  }

  async function run(action: 'save' | 'validate' | 'delete') {
    setError(null);
    setSaved(false);
    if (
      action === 'validate' &&
      !confirm('Valider l’inventaire ? Le stock prendra les quantités comptées.')
    )
      return;
    if (action === 'delete' && !confirm('Supprimer ce brouillon d’inventaire ?')) return;
    setBusy(true);
    try {
      if (action === 'delete') {
        await api('company', `/inventories/${inventory.id}`, { method: 'DELETE' });
        onChanged();
        onClose();
        return;
      }
      if (!(await save())) return;
      if (action === 'save') {
        setSaved(true);
        onChanged();
        return;
      }
      onValidated(
        await api<InventoryResult>('company', `/inventories/${inventory.id}/validate`, {
          method: 'POST',
          headers: idempotencyKey(`inventory:${inventory.id}`),
        }),
      );
      idempotencyDone(`inventory:${inventory.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-dark">
          Inventaire · {warehouseLabel(inventory.warehouse)}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
      <p className="text-sm text-muted">
        Quantités en unité de base. L’attendu est le stock actuel ; il est relu à la validation.
      </p>
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Comptage enregistré.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Article</th>
              <th className="py-2 pr-3 font-medium">Attendu</th>
              <th className="py-2 pr-3 font-medium">Compté</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variantId} className="border-t border-border">
                <td className="py-1.5 pr-3 text-text-dark">{articleLabel(r)}</td>
                <td className="py-1.5 pr-3">{r.physical}</td>
                <td className="py-1.5 pr-3">
                  <input
                    aria-label={`Compté pour ${articleLabel(r)}`}
                    inputMode="numeric"
                    disabled={!editable}
                    value={counted[r.variantId] ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      setSaved(false);
                      setCounted((c) => ({ ...c, [r.variantId]: e.target.value }));
                    }}
                    className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Alert>{error}</Alert>}
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="danger" onClick={() => void run('delete')} disabled={busy}>
            Supprimer
          </Button>
          <Button variant="secondary" onClick={() => void run('save')} disabled={busy}>
            Enregistrer
          </Button>
          <Button onClick={() => void run('validate')} disabled={busy}>
            Valider l’inventaire
          </Button>
        </div>
      )}
    </Card>
  );
}
