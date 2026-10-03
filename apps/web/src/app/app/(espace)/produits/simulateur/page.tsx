'use client';

import type { ProductDto, SimulatedCart } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { CatalogTabs } from '@/components/catalog-tabs';
import { Alert, Button, Card, Field, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA } from '@/lib/labels';

interface Line {
  key: number;
  productId: string;
  variantId: string;
  unitId: string;
  qty: string;
}

const REASONS: Record<string, string> = {
  NO_PRICE: 'pas de prix pour ce type de client',
  INACTIVE: 'parfum inactif',
  UNKNOWN: 'article ou unité inconnus',
};

/** Simulateur : calcule un panier avec la grille en vigueur, comme le fera le téléphone. */
export default function SimulatorPage() {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [types, setTypes] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [customerTypeId, setCustomerTypeId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<SimulatedCart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<ProductDto[]>('company', '/products?status=ACTIVE'),
      api<{ id: string; name: string; isActive: boolean }[]>('company', '/customer-types'),
    ])
      .then(([p, t]) => {
        setProducts(p);
        setTypes(t.filter((x) => x.isActive));
        setCustomerTypeId(t.find((x) => x.isActive)?.id ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  function newLine(productId = products[0]?.id ?? ''): Line {
    const p = products.find((x) => x.id === productId);
    const articles = p?.variants.filter((v) => v.isActive) ?? [];
    const units = p?.units.filter((u) => u.isActive) ?? [];
    return {
      key: Date.now() + Math.random(),
      productId,
      variantId: articles[0]?.id ?? '',
      unitId: units[units.length - 1]?.id ?? '',
      qty: '1',
    };
  }

  function update(key: number, patch: Partial<Line>) {
    setResult(null);
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? patch.productId
            ? { ...newLine(patch.productId), key }
            : { ...l, ...patch }
          : l,
      ),
    );
  }

  async function run() {
    setError(null);
    try {
      setResult(
        await api<SimulatedCart>('company', '/pricing/simulate', {
          method: 'POST',
          body: JSON.stringify({
            customerTypeId,
            date,
            lines: lines.map((l) => ({
              variantId: l.variantId,
              unitId: l.unitId,
              qty: Number(l.qty),
            })),
          }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Simulateur de panier"
        subtitle="Vérifiez prix, paliers et bonus avant qu'un vendeur ne les applique. Le stock n'est pas pris en compte ici."
      />
      <CatalogTabs />
      <Card className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type de client"
            value={customerTypeId}
            onChange={(e) => {
              setCustomerTypeId(e.target.value);
              setResult(null);
            }}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Field
            label="Date de la commande"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setResult(null);
            }}
          />
        </div>
        {lines.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          const articles = p?.variants.filter((v) => v.isActive) ?? [];
          return (
            <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Select
                label="Produit"
                value={l.productId}
                onChange={(e) => update(l.key, { productId: e.target.value })}
                options={products.map((x) => ({ value: x.id, label: x.name }))}
              />
              {p?.hasFlavors ? (
                <Select
                  label="Parfum"
                  value={l.variantId}
                  onChange={(e) => update(l.key, { variantId: e.target.value })}
                  options={articles.map((v) => ({ value: v.id, label: v.name }))}
                />
              ) : (
                <span className="hidden sm:block" />
              )}
              <Select
                label="Unité"
                value={l.unitId}
                onChange={(e) => update(l.key, { unitId: e.target.value })}
                options={(p?.units ?? [])
                  .filter((u) => u.isActive)
                  .map((u) => ({ value: u.id, label: u.name }))}
              />
              <Field
                label="Quantité"
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) => update(l.key, { qty: e.target.value })}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setResult(null);
                  setLines((ls) => ls.filter((x) => x.key !== l.key));
                }}
              >
                Retirer
              </Button>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setLines((ls) => [...ls, newLine()])}
            disabled={products.length === 0}
          >
            Ajouter une ligne
          </Button>
          <Button onClick={() => void run()} disabled={lines.length === 0 || !customerTypeId}>
            Calculer
          </Button>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {result && (
        <Card className="flex flex-col gap-3">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Article</th>
                <th className="py-2 pr-3 text-right font-medium">Quantité</th>
                <th className="py-2 pr-3 text-right font-medium">Prix unitaire</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-3">
                    {l.productName}
                    {l.variantName ? ` · ${l.variantName}` : ''}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {l.qty} {l.unitName}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {l.tierMinQty !== null && (
                      <span className="mr-1 text-xs text-muted line-through">
                        {formatDA(l.basePrice)}
                      </span>
                    )}
                    {formatDA(l.unitPrice)}
                    {l.tierMinQty !== null && (
                      <span className="block text-xs text-synced">palier dès {l.tierMinQty}</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-medium">{formatDA(l.total)}</td>
                </tr>
              ))}
              {result.freeLines.map((l, i) => (
                <tr key={`free-${i}`} className="border-t border-border bg-synced/5">
                  <td className="py-2 pr-3">
                    <span className="mr-2 rounded bg-synced/15 px-1.5 py-0.5 text-xs font-bold text-synced">
                      GRATUIT
                    </span>
                    {l.productName}
                    {l.variantName ? ` · ${l.variantName}` : ''}
                    <span className="block text-xs text-muted">{l.ruleName}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {l.qty} {l.unitName}
                  </td>
                  <td className="py-2 pr-3 text-right">0 DA</td>
                  <td className="py-2 text-right">0 DA</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-primary">
                <td colSpan={3} className="py-2 pr-3 font-semibold text-text-dark">
                  Total TTC
                </td>
                <td className="py-2 text-right text-lg font-bold text-primary">
                  {formatDA(result.total)}
                </td>
              </tr>
            </tfoot>
          </table>
          {result.unpriced.length > 0 && (
            <Alert>
              Non proposé à ce client :{' '}
              {result.unpriced
                .map(
                  (u) =>
                    `${u.productName}${u.variantName ? ` ${u.variantName}` : ''} en ${u.unitName} (${REASONS[u.reason] ?? u.reason})`,
                )
                .join(' ; ')}
              .
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
