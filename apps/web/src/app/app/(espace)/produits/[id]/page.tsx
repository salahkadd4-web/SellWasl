'use client';

import type {
  PriceGrid,
  PriceTierDto,
  ProductCategoryDto,
  ProductDto,
  ProductRangeDto,
  ProductVariantDto,
} from '@sellwasl/validation';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogTabs } from '@/components/catalog-tabs';
import { Alert, Badge, Button, Card, Field, Modal, Select, Toggle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA } from '@/lib/labels';

/** Fiche produit (UC-81) : informations, conditionnements, parfums, prix et paliers. */
export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = CompanyAuth.useAuth();
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProduct(await api<ProductDto>('company', `/products/${id}`));
    } catch (err) {
      setError(errorMessage(err, 'Produit introuvable.'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <CatalogTabs />
        {error ? <Alert>{error}</Alert> : <p className="text-muted">Chargement…</p>}
      </div>
    );
  }

  const writable = can('products.write');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/app/produits" className="text-sm font-semibold text-deep-blue">
            ← Catalogue
          </Link>
          <h1 className="text-2xl font-bold text-primary">{product.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted">
            <span className="font-mono">{product.reference}</span>· {product.range.name}
            {product.category ? ` · ${product.category.name}` : ''}
            {!product.isActive && <Badge tone="danger">Inactif</Badge>}
          </p>
        </div>
        {writable && <Button onClick={() => setEditing(true)}>Modifier le produit</Button>}
      </div>
      <CatalogTabs />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Units product={product} writable={writable} onChanged={setProduct} />
        <Flavors product={product} writable={writable} onChanged={setProduct} />
      </div>
      {can('prices.read') && (
        <>
          <Prices product={product} editable={can('prices.update')} />
          <Tiers product={product} editable={can('price_tiers.update')} />
        </>
      )}

      {editing && (
        <ProductEditDialog
          product={product}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setProduct(p);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function ProductEditDialog({
  product,
  onClose,
  onSaved,
}: {
  product: ProductDto;
  onClose: () => void;
  onSaved: (p: ProductDto) => void;
}) {
  const [ranges, setRanges] = useState<ProductRangeDto[]>([]);
  const [categories, setCategories] = useState<ProductCategoryDto[]>([]);
  const [active, setActive] = useState(product.isActive);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<ProductRangeDto[]>('company', '/product-ranges'),
      api<ProductCategoryDto[]>('company', '/product-categories'),
    ]).then(([r, c]) => {
      setRanges(r);
      setCategories(c);
    });
  }, []);

  async function submit(form: FormData) {
    setError(null);
    try {
      onSaved(
        await api<ProductDto>('company', `/products/${product.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            reference: form.get('reference'),
            name: form.get('name'),
            rangeId: form.get('rangeId'),
            categoryId: form.get('categoryId') || null,
            isActive: active,
          }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title="Modifier le produit" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label="Référence" name="reference" required defaultValue={product.reference} />
          <Field label="Nom" name="name" required defaultValue={product.name} />
        </div>
        {ranges.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Gamme"
              name="rangeId"
              defaultValue={product.range.id}
              options={ranges.map((r) => ({ value: r.id, label: r.name }))}
            />
            <Select
              label="Catégorie"
              name="categoryId"
              defaultValue={product.category?.id ?? ''}
              options={[
                { value: '', label: 'Aucune' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
        )}
        <Toggle
          label="Produit actif"
          description="Un produit inactif n'est plus proposé à la vente ; son historique reste."
          checked={active}
          onChange={setActive}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Enregistrer</Button>
      </form>
    </Modal>
  );
}

function Units({
  product,
  writable,
  onChanged,
}: {
  product: ProductDto;
  writable: boolean;
  onChanged: (p: ProductDto) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const base = product.units.find((u) => u.isBase);

  async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
    setError(null);
    try {
      onChanged(await api<ProductDto>('company', path, { method, body: JSON.stringify(body) }));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-text-dark">Unités et conditionnements</h2>
      <p className="text-xs text-muted">
        Le stock est tenu en {base?.name}. Le nombre d'unités d'un conditionnement ne change pas :
        créez-en un autre si le carton change.
      </p>
      {error && <Alert>{error}</Alert>}
      {product.units.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-2 text-sm">
          <span className={u.isActive ? 'text-text-dark' : 'text-muted line-through'}>
            {u.name}{' '}
            {u.isBase ? (
              <Badge>unité de base</Badge>
            ) : (
              <span className="text-muted">
                = {u.baseQty} {base?.name}
              </span>
            )}
          </span>
          {writable && !u.isBase && (
            <Button
              variant="secondary"
              onClick={() =>
                void send(`/products/${product.id}/units/${u.id}`, 'PATCH', {
                  isActive: !u.isActive,
                })
              }
            >
              {u.isActive ? 'Désactiver' : 'Réactiver'}
            </Button>
          )}
        </div>
      ))}
      {writable && (
        <form
          className="grid grid-cols-[2fr_1fr_auto] items-end gap-2 [&_input]:w-full [&_input]:min-w-0 [&>label]:min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            void send(`/products/${product.id}/units`, 'POST', {
              name: data.get('name'),
              baseQty: Number(data.get('baseQty')),
            }).then((ok) => ok && form.reset());
          }}
        >
          <Field label="Conditionnement" name="name" required placeholder="carton" />
          <Field label={`Nb de ${base?.name}`} name="baseQty" type="number" min={2} required />
          <Button type="submit">Ajouter</Button>
        </form>
      )}
    </Card>
  );
}

function Flavors({
  product,
  writable,
  onChanged,
}: {
  product: ProductDto;
  writable: boolean;
  onChanged: (p: ProductDto) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProductVariantDto | null>(null);
  const flavors = product.variants.filter((v) => !v.isDefault);

  async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
    setError(null);
    try {
      onChanged(await api<ProductDto>('company', path, { method, body: JSON.stringify(body) }));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-text-dark">Parfums</h2>
      {flavors.length === 0 ? (
        <p className="text-sm text-muted">
          Ce produit n'a pas de parfum. Si vous en ajoutez, son stock et son historique actuels
          seront rattachés au premier parfum.
        </p>
      ) : (
        <p className="text-xs text-muted">
          Stock, quotas et lignes de commande sont tenus par parfum ; les conditionnements sont ceux
          du produit (BR-CAT-13).
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {flavors.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
          <span className={v.isActive ? 'text-text-dark' : 'text-muted line-through'}>
            {v.name} <span className="font-mono text-muted">{v.reference}</span>
          </span>
          {writable && (
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setRenaming(v)}>
                Modifier
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void send(`/products/${product.id}/variants/${v.id}`, 'PATCH', {
                    isActive: !v.isActive,
                  })
                }
              >
                {v.isActive ? 'Désactiver' : 'Réactiver'}
              </Button>
            </span>
          )}
        </div>
      ))}
      {writable && (
        <form
          className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 [&_input]:w-full [&_input]:min-w-0 [&>label]:min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            void send(`/products/${product.id}/variants`, 'POST', {
              reference: data.get('reference'),
              name: data.get('name'),
            }).then((ok) => ok && form.reset());
          }}
        >
          <Field label="Référence" name="reference" required placeholder="BIMO-CHOC" />
          <Field label="Parfum" name="name" required placeholder="Chocolat" />
          <Button type="submit">Ajouter</Button>
        </form>
      )}
      {renaming && (
        <Modal title={`Modifier ${renaming.name}`} onClose={() => setRenaming(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void send(`/products/${product.id}/variants/${renaming.id}`, 'PATCH', {
                reference: data.get('reference'),
                name: data.get('name'),
              }).then((ok) => ok && setRenaming(null));
            }}
          >
            <Field label="Référence" name="reference" required defaultValue={renaming.reference} />
            <Field label="Parfum" name="name" required defaultValue={renaming.name} />
            <Button type="submit">Enregistrer</Button>
          </form>
        </Modal>
      )}
    </Card>
  );
}

const cellKey = (variantId: string | null, customerTypeId: string, unitId: string) =>
  `${variantId ?? '-'}|${customerTypeId}|${unitId}`;

/** Grille des prix TTC en DA : une ligne par article et unité, une colonne par type de client. */
function Prices({ product, editable }: { product: ProductDto; editable: boolean }) {
  const [grid, setGrid] = useState<PriceGrid | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await api<PriceGrid>('company', `/products/${product.id}/prices`);
      setGrid(g);
      setValues(
        Object.fromEntries(
          g.prices.map((p) => [cellKey(p.variantId, p.customerTypeId, p.unitId), String(p.price)]),
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [product.id]);

  // La grille dépend des unités et des parfums du produit
  useEffect(() => {
    void load();
  }, [load, product.units.length, product.variants.length]);

  const rows = useMemo(() => {
    if (!grid) return [];
    const units = grid.units.filter((u) => u.isActive);
    const articles: { variantId: string | null; label: string }[] = [
      { variantId: null, label: grid.flavors.length > 0 ? 'Tous parfums' : product.name },
      ...grid.flavors.filter((f) => f.isActive).map((f) => ({ variantId: f.id, label: f.name })),
    ];
    return articles.flatMap((a) => units.map((u) => ({ ...a, unit: u })));
  }, [grid, product.name]);

  if (!grid) return error ? <Alert>{error}</Alert> : null;
  const types = grid.customerTypes.filter((t) => t.isActive);

  async function save() {
    setError(null);
    setSaved(false);
    const prices: PriceGrid['prices'] = [];
    for (const [key, text] of Object.entries(values)) {
      if (text.trim() === '') continue;
      const price = Number(text.replace(/\s/g, ''));
      if (!Number.isInteger(price) || price < 0) {
        setError('Les prix sont des montants entiers en DA.');
        return;
      }
      const [variant, customerTypeId, unitId] = key.split('|') as [string, string, string];
      prices.push({ variantId: variant === '-' ? null : variant, customerTypeId, unitId, price });
    }
    setBusy(true);
    try {
      await api('company', `/products/${product.id}/prices`, {
        method: 'PUT',
        body: JSON.stringify({ prices }),
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-text-dark">Prix TTC (DA)</h2>
      <p className="text-xs text-muted">
        Un article sans prix pour un type de client ne lui est pas proposé (BR-CAT-04).
        {grid.flavors.length > 0 &&
          ' Un parfum laissé vide a le prix « Tous parfums » ; rempli, il a son propre prix (BR-CAT-14).'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Article</th>
              <th className="py-2 pr-3 font-medium">Unité</th>
              {types.map((t) => (
                <th key={t.id} className="py-2 pr-3 font-medium">
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.variantId}-${r.unit.id}`} className="border-t border-border">
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 pr-3 text-muted">{r.unit.name}</td>
                {types.map((t) => {
                  const key = cellKey(r.variantId, t.id, r.unit.id);
                  const inherited = r.variantId ? values[cellKey(null, t.id, r.unit.id)] : '';
                  return (
                    <td key={t.id} className="py-1.5 pr-3">
                      <input
                        aria-label={`${r.label} ${r.unit.name} ${t.name}`}
                        inputMode="numeric"
                        disabled={!editable}
                        value={values[key] ?? ''}
                        placeholder={inherited || '—'}
                        onChange={(e) => {
                          setSaved(false);
                          setValues((v) => ({ ...v, [key]: e.target.value }));
                        }}
                        className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Alert>{error}</Alert>}
      {editable ? (
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer les prix'}
          </Button>
          {saved && <span className="text-sm text-synced">Prix enregistrés.</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Les prix sont fixés par l'administrateur (paramètre P-10).
        </p>
      )}
    </Card>
  );
}

/** Paliers « à partir de Q, le prix devient P » (BR-CAT-05, BR-CAT-15). */
function Tiers({ product, editable }: { product: ProductDto; editable: boolean }) {
  const [tiers, setTiers] = useState<PriceTierDto[] | null>(null);
  const [types, setTypes] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const flavors = product.variants.filter((v) => !v.isDefault && v.isActive);

  const load = useCallback(async () => {
    try {
      setTiers(await api<PriceTierDto[]>('company', `/price-tiers?productId=${product.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [product.id]);

  useEffect(() => {
    void load();
    void api<{ id: string; name: string; isActive: boolean }[]>('company', '/customer-types').then(
      setTypes,
    );
  }, [load]);

  async function remove(id: string) {
    if (!confirm('Supprimer ce palier ?')) return;
    try {
      await api('company', `/price-tiers/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function add(form: HTMLFormElement) {
    setError(null);
    const data = new FormData(form);
    try {
      await api('company', '/price-tiers', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          variantId: data.get('variantId') || null,
          customerTypeId: data.get('customerTypeId'),
          unitId: data.get('unitId'),
          minQty: Number(data.get('minQty')),
          unitPrice: Number(String(data.get('unitPrice')).replace(/\s/g, '')),
          thresholdScope: data.get('thresholdScope') ?? 'ALL_VARIANTS',
        }),
      });
      form.reset();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-text-dark">Paliers</h2>
      <p className="text-xs text-muted">
        À partir d'une quantité saisie dans l'unité du palier, le prix unitaire baisse ; le plus
        haut palier atteint s'applique.
        {flavors.length > 0 &&
          ' Par défaut, le seuil se calcule sur le total des parfums au prix du produit.'}
      </p>
      {error && <Alert>{error}</Alert>}
      {tiers?.length === 0 && <p className="text-sm text-muted">Aucun palier.</p>}
      {tiers?.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
          <span>
            {t.customerType.name} · à partir de {t.minQty} {t.unit.name} :{' '}
            <strong>{formatDA(t.unitPrice)}</strong>
            {t.variant ? ` · ${t.variant.name}` : ''}
            {flavors.length > 0 && !t.variant && (
              <span className="text-muted">
                {' '}
                · {t.thresholdScope === 'PER_VARIANT' ? 'chaque parfum' : 'total des parfums'}
              </span>
            )}
          </span>
          {editable && (
            <Button variant="danger" onClick={() => void remove(t.id)}>
              Supprimer
            </Button>
          )}
        </div>
      ))}
      {editable && (
        <form
          className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            void add(e.currentTarget);
          }}
        >
          <Select
            label="Type de client"
            name="customerTypeId"
            options={types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            label="Unité"
            name="unitId"
            options={product.units
              .filter((u) => u.isActive)
              .map((u) => ({ value: u.id, label: u.name }))}
          />
          {flavors.length > 0 ? (
            <Select
              label="Article"
              name="variantId"
              options={[
                { value: '', label: 'Tous parfums' },
                ...flavors.map((f) => ({ value: f.id, label: `${f.name} (prix propre)` })),
              ]}
            />
          ) : null}
          {flavors.length > 0 ? (
            <Select
              label="Seuil"
              name="thresholdScope"
              options={[
                { value: 'ALL_VARIANTS', label: 'Total des parfums' },
                { value: 'PER_VARIANT', label: 'Chaque parfum' },
              ]}
            />
          ) : null}
          <Field label="À partir de" name="minQty" type="number" min={2} required />
          <Field label="Prix (DA)" name="unitPrice" inputMode="numeric" required />
          <Button type="submit">Ajouter</Button>
        </form>
      )}
    </Card>
  );
}
