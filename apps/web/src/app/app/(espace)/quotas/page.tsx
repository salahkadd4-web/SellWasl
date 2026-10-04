'use client';

import type { ProductDto, QuotaDto, TerritoryDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDate, todayDate } from '@/lib/labels';

interface Row {
  unitId: string;
  qty: string;
}

/**
 * Quotas du jour (UC-55, BR-QUO-01) : une quantité par vendeur et par article, saisie dans l'unité
 * choisie et gardée en unité de base. Au-delà, la quantité commandée part en attente.
 */
export default function QuotasPage() {
  const { can } = CompanyAuth.useAuth();
  const [sellers, setSellers] = useState<{ id: string; label: string }[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [sellerId, setSellerId] = useState('');
  const [date, setDate] = useState(todayDate);
  const [quotas, setQuotas] = useState<QuotaDto[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<TerritoryDto[]>('company', '/territories'),
      api<ProductDto[]>('company', '/products?status=ACTIVE'),
    ])
      .then(([t, p]) => {
        const list = t
          .filter((x) => x.seller)
          .map((x) => ({ id: x.seller!.id, label: `${x.seller!.code} · ${x.seller!.name}` }));
        setSellers(list);
        setSellerId((current) => current || list[0]?.id || '');
        setProducts(p);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setSaved(false);
    try {
      const list = await api<QuotaDto[]>('company', `/quotas?date=${date}`);
      setQuotas(list);
      setRows(
        Object.fromEntries(
          list
            .filter((q) => q.user.id === sellerId)
            .map((q) => [
              q.productVariantId,
              { unitId: q.enteredUnit.id, qty: String(q.enteredQty) },
            ]),
        ),
      );
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date, sellerId]);

  useEffect(() => {
    if (sellerId) void load();
  }, [load, sellerId]);

  const existing = (variantId: string) =>
    quotas?.find((q) => q.user.id === sellerId && q.productVariantId === variantId);

  async function save() {
    setError(null);
    let invalid = false;
    const entries = products.flatMap((p) =>
      p.variants
        .filter((v) => v.isActive)
        .flatMap((v) => {
          const row = rows[v.id];
          const qty = Number(row?.qty || '0');
          if (!row && !existing(v.id)) return [];
          if (!Number.isInteger(qty) || qty < 0) {
            invalid = true;
            return [];
          }
          return [
            {
              userId: sellerId,
              productVariantId: v.id,
              unitId: row?.unitId ?? p.units.find((u) => u.isBase)!.id,
              qty,
            },
          ];
        }),
    );
    if (invalid) return setError('Les quantités doivent être des nombres entiers positifs.');
    if (entries.length === 0) return setError('Aucun quota à enregistrer.');
    setBusy(true);
    try {
      await api('company', '/quotas', { method: 'PUT', body: JSON.stringify({ date, entries }) });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const editable = can('quotas.update');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Quotas du jour"
        subtitle="Quantité maximale par vendeur et par article ; l'excédent commandé part en attente."
        action={
          editable && (
            <Button onClick={() => void save()} disabled={busy || !sellerId}>
              Enregistrer
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Quotas enregistrés.
        </p>
      )}
      <Card className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Select
          label="Vendeur"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          options={sellers.map((s) => ({ value: s.id, label: s.label }))}
        />
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </Card>
      {sellers.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Aucun secteur n'a de vendeur : affectez les vendeurs dans la page Secteurs.
          </p>
        </Card>
      )}
      {quotas && sellerId && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          <p className="text-sm text-muted">Quantité vide ou 0 : pas de quota pour cet article.</p>
          <div className="overflow-hidden rounded-xl border border-border">
            {products.flatMap((p) =>
              p.variants
                .filter((v) => v.isActive)
                .map((v) => {
                  const row = rows[v.id] ?? {
                    unitId: p.units.find((u) => u.isBase)?.id ?? p.units[0]!.id,
                    qty: '',
                  };
                  const q = existing(v.id);
                  return (
                    <div
                      key={v.id}
                      className="grid gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[2fr_1fr_1fr] sm:items-end"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium text-text-dark">
                          {p.name}
                          {p.hasFlavors ? ` ${v.name}` : ''}
                        </span>
                        <span className="text-xs text-muted">
                          {q
                            ? `Commandé : ${q.consumedQty} / ${q.qty} (unité de base)`
                            : 'Pas de quota'}
                        </span>
                      </span>
                      <Select
                        label="Unité"
                        value={row.unitId}
                        disabled={!editable}
                        onChange={(e) =>
                          setRows((r) => ({ ...r, [v.id]: { ...row, unitId: e.target.value } }))
                        }
                        options={p.units
                          .filter((u) => u.isActive)
                          .map((u) => ({ value: u.id, label: u.name }))}
                      />
                      <Field
                        label="Quantité"
                        type="number"
                        min={0}
                        value={row.qty}
                        disabled={!editable}
                        onChange={(e) =>
                          setRows((r) => ({ ...r, [v.id]: { ...row, qty: e.target.value } }))
                        }
                      />
                    </div>
                  );
                }),
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
