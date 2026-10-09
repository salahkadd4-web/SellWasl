'use client';

import type { Page, ProductDto, ReceiptDto, SupplierDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { type Listed, ShowMore } from '@/components/show-more';
import { emptyLine, type StockLine, StockLinesEditor, toPayload } from '@/components/stock-lines';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDate, formatDateTime } from '@/lib/labels';
import { useWarehouses, warehouseLabel } from '@/lib/stock';

/** Entrées au dépôt (UC-40) : réception d'un fournisseur, convertie en unité de base. */
export default function ReceiptsPage() {
  const { can } = CompanyAuth.useAuth();
  const { warehouses, error: warehousesError } = useWarehouses();
  const depots = warehouses.filter((w) => w.type === 'DEPOT');
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [receiptsList, setReceiptsList] = useState<Listed<ReceiptDto> | null>(null);
  const receipts = receiptsList?.page.data ?? null;
  const [detail, setDetail] = useState<ReceiptDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProductDto[]>('company', '/products?status=ACTIVE')
      .then(setProducts)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v !== ''));
    try {
      const path = `/stock/receipts?${params}`;
      setReceiptsList({ path, page: await api<Page<ReceiptDto>>('company', path) });
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Entrées au dépôt"
        subtitle="Marchandise reçue des fournisseurs ; le stock du dépôt augmente aussitôt."
        action={
          can('stock.receive') &&
          !creating && <Button onClick={() => setCreating(true)}>Nouvelle entrée</Button>
        }
      />
      <StockTabs />
      {(error ?? warehousesError) && <Alert>{error ?? warehousesError}</Alert>}
      {creating && (
        <NewReceipt
          depots={depots}
          products={products}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Du"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          hint="Vide : les 30 derniers jours."
        />
        <Field label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Card>
      {receipts && (
        <Card className="flex flex-col gap-3">
          {receipts.length === 0 && <p className="text-sm text-muted">Aucune entrée.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {receipts.map((r) => (
              <button
                key={r.id}
                onClick={() => setDetail(r)}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {r.supplierRef?.name ?? r.supplier ?? 'Fournisseur non précisé'}
                    {r.reference ? ` · ${r.reference}` : ''}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDateTime(r.receivedAt)} · {warehouseLabel(r.warehouse)}
                    {r.user ? ` · ${r.user}` : ''}
                  </span>
                </span>
                <span className="text-sm text-muted">{r.lines.length} article(s)</span>
              </button>
            ))}
          </div>
          <ShowMore list={receiptsList} onChange={setReceiptsList} />
        </Card>
      )}
      {detail && (
        <Modal title="Entrée au dépôt" onClose={() => setDetail(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {formatDateTime(detail.receivedAt)} · {warehouseLabel(detail.warehouse)}
              {(detail.supplierRef?.name ?? detail.supplier)
                ? ` · ${detail.supplierRef?.name ?? detail.supplier}`
                : ''}
              {detail.reference ? ` · ${detail.reference}` : ''}
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {detail.lines.map((l) => (
                <div
                  key={l.variantId}
                  className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
                >
                  <span className="text-text-dark">
                    {articleLabel(l)}
                    {l.lotNumber && (
                      <span className="block text-xs text-muted">
                        Lot {l.lotNumber}
                        {l.expiresAt ? ` · péremption ${formatDate(l.expiresAt)}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="text-muted">
                    {l.enteredQty} {l.unitName} · {l.qty}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewReceipt({
  depots,
  products,
  onCancel,
  onDone,
}: {
  depots: { id: string; code: string; name: string }[];
  products: ProductDto[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(depots[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<StockLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SupplierDto[]>('company', '/suppliers')
      .then((list) => setSuppliers(list.filter((s) => s.isActive)))
      .catch(() => setSuppliers([]));
  }, []);

  async function submit() {
    setError(null);
    const payload = toPayload(lines);
    if (!warehouseId) return setError('Choisissez le dépôt.');
    if (!payload)
      return setError('Chaque article doit avoir une unité et une quantité entière positive.');
    if (payload.length === 0) return setError('Ajoutez au moins un article.');
    setBusy(true);
    try {
      await api('company', '/stock/receipts', {
        method: 'POST',
        headers: idempotencyKey('stock-receipt'),
        body: JSON.stringify({
          warehouseId,
          supplierId: supplierId || undefined,
          reference: reference.trim() || undefined,
          lines: payload,
        }),
      });
      idempotencyDone('stock-receipt');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-dark">Nouvelle entrée</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Dépôt"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={depots.map((d) => ({ value: d.id, label: warehouseLabel(d) }))}
        />
        <Select
          label="Fournisseur"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          options={[
            { value: '', label: 'Non précisé' },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Field
          label="Référence du bon"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <StockLinesEditor products={products} lines={lines} onChange={setLines} withLots />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          Enregistrer l’entrée
        </Button>
      </div>
    </Card>
  );
}
