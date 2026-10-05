'use client';

import type { ProductDto } from '@sellwasl/validation';
import { Button, Field, Select } from '@/components/ui';

export interface StockLine {
  key: number;
  variantId: string;
  unitId: string;
  qty: string;
}

let nextKey = 1;
export const emptyLine = (): StockLine => ({ key: nextKey++, variantId: '', unitId: '', qty: '' });

/** Lignes prêtes à envoyer : article, unité et quantité entière positive ; null si une ligne est invalide. */
export function toPayload(lines: StockLine[]) {
  const filled = lines.filter((l) => l.variantId);
  if (filled.some((l) => !l.unitId || !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1))
    return null;
  return filled.map((l) => ({ variantId: l.variantId, unitId: l.unitId, qty: Number(l.qty) }));
}

/**
 * Saisie de lignes article + unité + quantité, comme les quotas ; l'unité de base est proposée
 * par défaut. `available` affiche le disponible de chaque article, en unité de base.
 */
export function StockLinesEditor({
  products,
  lines,
  onChange,
  available,
}: {
  products: ProductDto[];
  lines: StockLine[];
  onChange: (lines: StockLine[]) => void;
  available?: Map<string, number>;
}) {
  const articles = products
    .filter((p) => p.isActive)
    .flatMap((p) =>
      p.variants
        .filter((v) => v.isActive)
        .map((v) => ({
          id: v.id,
          product: p,
          label: p.hasFlavors ? `${p.name} ${v.name}` : p.name,
        })),
    );
  const update = (key: number, patch: Partial<StockLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border">
        {lines.map((l) => {
          const article = articles.find((a) => a.id === l.variantId);
          const units = article?.product.units.filter((u) => u.isActive) ?? [];
          return (
            <div
              key={l.key}
              className="grid gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
            >
              <Select
                label="Article"
                value={l.variantId}
                onChange={(e) => {
                  const chosen = articles.find((a) => a.id === e.target.value);
                  const base = chosen?.product.units.find((u) => u.isBase && u.isActive);
                  update(l.key, { variantId: e.target.value, unitId: base?.id ?? '' });
                }}
                options={[
                  { value: '', label: 'Choisir…' },
                  ...articles.map((a) => ({
                    value: a.id,
                    label: a.label,
                    disabled: a.id !== l.variantId && lines.some((x) => x.variantId === a.id),
                  })),
                ]}
              />
              <Select
                label="Unité"
                value={l.unitId}
                disabled={!article}
                onChange={(e) => update(l.key, { unitId: e.target.value })}
                options={units.map((u) => ({ value: u.id, label: u.name }))}
              />
              <Field
                label="Quantité"
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) => update(l.key, { qty: e.target.value })}
                hint={
                  available && l.variantId
                    ? `Disponible : ${available.get(l.variantId) ?? 0} (unité de base)`
                    : undefined
                }
              />
              <Button
                variant="secondary"
                onClick={() =>
                  onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyLine()])
                }
              >
                Retirer
              </Button>
            </div>
          );
        })}
      </div>
      <Button variant="secondary" onClick={() => onChange([...lines, emptyLine()])}>
        Ajouter un article
      </Button>
    </div>
  );
}
