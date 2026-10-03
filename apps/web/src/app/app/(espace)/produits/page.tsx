'use client';

import type { ProductCategoryDto, ProductDto, ProductRangeDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CatalogTabs } from '@/components/catalog-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';

interface Filters {
  q: string;
  rangeId: string;
  categoryId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ALL';
}

/** Catalogue (UC-81) : produits, gammes et catégories. */
export default function ProductsPage() {
  const { can } = CompanyAuth.useAuth();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({
    q: '',
    rangeId: '',
    categoryId: '',
    status: 'ACTIVE',
  });
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [ranges, setRanges] = useState<ProductRangeDto[]>([]);
  const [categories, setCategories] = useState<ProductCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);

  const loadReferences = useCallback(async () => {
    const [r, c] = await Promise.all([
      api<ProductRangeDto[]>('company', '/product-ranges'),
      api<ProductCategoryDto[]>('company', '/product-categories'),
    ]);
    setRanges(r);
    setCategories(c);
  }, []);

  useEffect(() => {
    void loadReferences().catch((err) => setError(errorMessage(err)));
  }, [loadReferences]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status: filters.status });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.rangeId) params.set('rangeId', filters.rangeId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    try {
      setProducts(await api<ProductDto[]>('company', `/products?${params}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Produits"
        subtitle={products ? `${products.length} produit(s)` : 'Catalogue, parfums et prix'}
        action={
          can('products.write') && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setManaging(true)}>
                Gammes et catégories
              </Button>
              <Button onClick={() => setCreating(true)} disabled={ranges.length === 0}>
                Nouveau produit
              </Button>
            </div>
          )
        }
      />
      <CatalogTabs />

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Recherche"
          placeholder="Nom, référence, parfum…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Gamme"
          value={filters.rangeId}
          onChange={(e) => setFilters((f) => ({ ...f, rangeId: e.target.value }))}
          options={[
            { value: '', label: 'Toutes' },
            ...ranges.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        <Select
          label="Catégorie"
          value={filters.categoryId}
          onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
          options={[
            { value: '', label: 'Toutes' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Statut"
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({ ...f, status: e.target.value as Filters['status'] }))
          }
          options={[
            { value: 'ACTIVE', label: 'Actifs' },
            { value: 'INACTIVE', label: 'Inactifs' },
            { value: 'ALL', label: 'Tous' },
          ]}
        />
      </Card>

      {error && <Alert>{error}</Alert>}
      {!products && !error && <p className="text-muted">Chargement…</p>}
      {products?.length === 0 && (
        <Card>
          <p className="text-muted">Aucun produit ne correspond.</p>
        </Card>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        {products?.map((p) => {
          const flavors = p.variants.filter((v) => !v.isDefault);
          const packagings = p.units.filter((u) => !u.isBase && u.isActive);
          const base = p.units.find((u) => u.isBase);
          return (
            <Link
              key={p.id}
              href={`/app/produits/${p.id}`}
              className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex flex-col">
                <span className="font-semibold text-text-dark">
                  {p.name}{' '}
                  <span className="font-mono text-sm font-normal text-muted">{p.reference}</span>
                </span>
                <span className="text-sm text-muted">
                  {p.range.name}
                  {p.category ? ` · ${p.category.name}` : ''} · {base?.name}
                  {packagings.map((u) => ` · ${u.name} de ${u.baseQty}`).join('')}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {!p.isActive && <Badge tone="danger">Inactif</Badge>}
                {flavors.length > 0 && (
                  <Badge>
                    {flavors.length} parfum{flavors.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      {creating && (
        <ProductForm
          ranges={ranges.filter((r) => r.isActive)}
          categories={categories.filter((c) => c.isActive)}
          onClose={() => setCreating(false)}
          onSaved={(p) => router.push(`/app/produits/${p.id}`)}
        />
      )}
      {managing && (
        <RangesDialog
          ranges={ranges}
          categories={categories}
          onClose={() => setManaging(false)}
          onChanged={() => void loadReferences()}
        />
      )}
    </div>
  );
}

/** Saisie d'une liste « nom = nombre » : conditionnements ou parfums. */
function parsePackagings(text: string): { name: string; baseQty: number }[] | string {
  const result: { name: string; baseQty: number }[] = [];
  for (const part of text.split(/[\n,|]/).map((p) => p.trim())) {
    if (!part) continue;
    const match = /^(.+?)\s*[=:]\s*(\d+)$/.exec(part);
    if (!match) return `« ${part} » : écrivez nom = nombre, par exemple carton = 24.`;
    result.push({ name: match[1]!.trim(), baseQty: Number(match[2]) });
  }
  return result;
}

function ProductForm({
  ranges,
  categories,
  onClose,
  onSaved,
}: {
  ranges: ProductRangeDto[];
  categories: ProductCategoryDto[];
  onClose: () => void;
  onSaved: (p: ProductDto) => void;
}) {
  const [withFlavors, setWithFlavors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setError(null);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const packagings = parsePackagings(text('packagings'));
    if (typeof packagings === 'string') return setError(packagings);
    const flavors = withFlavors
      ? text('flavors')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [reference, ...name] = l.split(/\s*[;:]\s*/);
            return { reference: reference ?? '', name: name.join(' ') };
          })
      : [];
    if (flavors.some((f) => !f.reference || !f.name)) {
      return setError('Parfums : une ligne par parfum, « référence ; nom ».');
    }
    setBusy(true);
    try {
      onSaved(
        await api<ProductDto>('company', '/products', {
          method: 'POST',
          body: JSON.stringify({
            reference: text('reference'),
            name: text('name'),
            rangeId: text('rangeId'),
            categoryId: text('categoryId') || null,
            baseUnitName: text('baseUnitName'),
            packagings,
            variants: flavors,
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
    <Modal title="Nouveau produit" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label="Référence" name="reference" required placeholder="BIMO" />
          <Field label="Nom" name="name" required placeholder="Biscuit Bimo" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Gamme"
            name="rangeId"
            options={ranges.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Select
            label="Catégorie"
            name="categoryId"
            options={[
              { value: '', label: 'Aucune' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <Field
          label="Unité de base"
          name="baseUnitName"
          required
          placeholder="paquet"
          hint="La plus petite unité vendue ; le stock est tenu dans cette unité."
        />
        <Field
          label="Conditionnements"
          name="packagings"
          placeholder="carton = 24, pack = 6"
          hint="Nombre d'unités de base par conditionnement. Vous pourrez en ajouter ensuite."
        />
        <label className="flex items-center gap-2 text-sm font-medium text-text-dark">
          <input
            type="checkbox"
            className="size-5 accent-[#001850]"
            checked={withFlavors}
            onChange={(e) => setWithFlavors(e.target.checked)}
          />
          Ce produit a des parfums
        </label>
        {withFlavors && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-dark">Parfums</span>
            <textarea
              name="flavors"
              rows={4}
              placeholder={'BIMO-CHOC ; Chocolat\nBIMO-FRA ; Fraise'}
              className="rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-text-dark outline-none focus:border-deep-blue focus:ring-2 focus:ring-deep-blue/20"
            />
            <span className="text-xs text-muted">Une ligne par parfum : « référence ; nom ».</span>
          </label>
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Création…' : 'Créer le produit'}
        </Button>
      </form>
    </Modal>
  );
}

function RangesDialog({
  ranges,
  categories,
  onClose,
  onChanged,
}: {
  ranges: ProductRangeDto[];
  categories: ProductCategoryDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
    setError(null);
    try {
      await api('company', path, { method, body: JSON.stringify(body) });
      onChanged();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  return (
    <Modal title="Gammes et catégories" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {error && <Alert>{error}</Alert>}
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-text-dark">Gammes</h3>
          <p className="text-xs text-muted">Les objectifs du mois sont fixés par gamme.</p>
          {ranges.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className={r.isActive ? '' : 'text-muted line-through'}>
                <span className="font-mono text-muted">{r.code}</span> · {r.name}
              </span>
              <Button
                variant="secondary"
                onClick={() =>
                  void send(`/product-ranges/${r.id}`, 'PATCH', { isActive: !r.isActive })
                }
              >
                {r.isActive ? 'Désactiver' : 'Réactiver'}
              </Button>
            </div>
          ))}
          <form
            className="grid grid-cols-[1fr_2fr_auto] items-end gap-2 [&_input]:w-full [&_input]:min-w-0 [&>label]:min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              void send('/product-ranges', 'POST', {
                code: data.get('code'),
                name: data.get('name'),
              }).then((ok) => ok && form.reset());
            }}
          >
            <Field label="Code" name="code" required placeholder="BIMO" />
            <Field label="Nom" name="name" required placeholder="Bimo" />
            <Button type="submit">Ajouter</Button>
          </form>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-text-dark">Catégories</h3>
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className={c.isActive ? '' : 'text-muted line-through'}>{c.name}</span>
              <Button
                variant="secondary"
                onClick={() =>
                  void send(`/product-categories/${c.id}`, 'PATCH', { isActive: !c.isActive })
                }
              >
                {c.isActive ? 'Désactiver' : 'Réactiver'}
              </Button>
            </div>
          ))}
          <form
            className="grid grid-cols-[1fr_auto] items-end gap-2 [&_input]:w-full [&_input]:min-w-0 [&>label]:min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void send('/product-categories', 'POST', {
                name: new FormData(form).get('name'),
              }).then((ok) => ok && form.reset());
            }}
          >
            <Field label="Nom" name="name" required placeholder="Conserves" />
            <Button type="submit">Ajouter</Button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
