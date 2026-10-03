'use client';

import type { BonusRuleDto, ProductDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { CatalogTabs } from '@/components/catalog-tabs';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Modal,
  PageTitle,
  Select,
  Toggle,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDate } from '@/lib/labels';

interface CustomerType {
  id: string;
  name: string;
  isActive: boolean;
}

const MODE_LABELS: Record<BonusRuleDto['freeVariantMode'], string> = {
  AUTO_MOST_STOCK: 'le parfum le plus en stock',
  SELLER_CHOICE: 'au choix du vendeur',
  FIXED: 'parfum fixé',
};

function describe(r: BonusRuleDto): string {
  const buy = `${r.buyQty} ${r.buyUnit.name} de ${r.buyProduct.name}${r.buyVariant ? ` ${r.buyVariant.name}` : ''}`;
  const free = `${r.freeQty} ${r.freeUnit.name} de ${r.freeProduct.name}${r.freeVariant ? ` ${r.freeVariant.name}` : ''}`;
  return `Pour ${buy} : ${free} offert(s)`;
}

/** Règles de bonus cumulatives « pour Q de X, N de Y offert » (BR-CAT-06, BR-CAT-15). */
export default function BonusRulesPage() {
  const { can } = CompanyAuth.useAuth();
  const [rules, setRules] = useState<BonusRuleDto[] | null>(null);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BonusRuleDto | 'new' | null>(null);
  const editable = can('bonuses.update');

  const load = useCallback(async () => {
    try {
      setRules(await api<BonusRuleDto[]>('company', '/bonus-rules'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    void Promise.all([
      api<ProductDto[]>('company', '/products?status=ACTIVE'),
      api<CustomerType[]>('company', '/customer-types'),
    ])
      .then(([p, t]) => {
        setProducts(p);
        setTypes(t);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function remove(rule: BonusRuleDto) {
    if (!confirm(`Supprimer la règle « ${rule.name} » ?`)) return;
    try {
      await api('company', `/bonus-rules/${rule.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Règles de bonus"
        subtitle="Quantités offertes, cumulatives : 3 fois la quantité achetée donne 3 fois le bonus."
        action={
          editable && (
            <Button onClick={() => setEditing('new')} disabled={products.length === 0}>
              Nouvelle règle
            </Button>
          )
        }
      />
      <CatalogTabs />
      {error && <Alert>{error}</Alert>}
      {rules?.length === 0 && (
        <Card>
          <p className="text-muted">Aucune règle de bonus.</p>
        </Card>
      )}
      <div className="grid gap-3">
        {rules?.map((r) => (
          <Card
            key={r.id}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-text-dark">{r.name}</p>
              <p className="text-sm text-text-dark">{describe(r)}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {!r.isActive && <Badge tone="danger">Inactive</Badge>}
                <span>
                  Du {formatDate(r.validFrom)}
                  {r.validTo ? ` au ${formatDate(r.validTo)}` : ', sans fin'}
                </span>
                <span>·</span>
                <span>
                  {r.customerTypes.length > 0
                    ? r.customerTypes.map((c) => c.name).join(', ')
                    : 'Tous les types de clients'}
                </span>
                {!r.freeVariant && <span>· parfum offert : {MODE_LABELS[r.freeVariantMode]}</span>}
              </p>
            </div>
            {editable && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(r)}>
                  Modifier
                </Button>
                <Button variant="danger" onClick={() => void remove(r)}>
                  Supprimer
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {editing && (
        <BonusForm
          rule={editing === 'new' ? null : editing}
          products={products}
          types={types.filter((t) => t.isActive)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function BonusForm({
  rule,
  products,
  types,
  onClose,
  onSaved,
}: {
  rule: BonusRuleDto | null;
  products: ProductDto[];
  types: CustomerType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [buyProductId, setBuyProductId] = useState(rule?.buyProduct.id ?? products[0]!.id);
  const [freeProductId, setFreeProductId] = useState(rule?.freeProduct.id ?? products[0]!.id);
  const [mode, setMode] = useState<BonusRuleDto['freeVariantMode']>(
    rule?.freeVariantMode ?? 'AUTO_MOST_STOCK',
  );
  const [typeIds, setTypeIds] = useState<string[]>(rule?.customerTypes.map((c) => c.id) ?? []);
  const [active, setActive] = useState(rule?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const buy = products.find((p) => p.id === buyProductId);
  const free = products.find((p) => p.id === freeProductId);
  const flavorsOf = (p?: ProductDto) => p?.variants.filter((v) => !v.isDefault && v.isActive) ?? [];
  const unitsOf = (p?: ProductDto) =>
    p?.units.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.name })) ?? [];

  async function submit(form: FormData) {
    setError(null);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const body = {
      name: text('name'),
      buyProductId,
      buyVariantId: text('buyVariantId') || null,
      buyUnitId: text('buyUnitId'),
      buyQty: Number(text('buyQty')),
      freeProductId,
      freeVariantId: mode === 'FIXED' ? text('freeVariantId') || null : null,
      freeUnitId: text('freeUnitId'),
      freeQty: Number(text('freeQty')),
      freeVariantMode: mode,
      validFrom: text('validFrom'),
      validTo: text('validTo') || null,
      customerTypeIds: typeIds,
      isActive: active,
    };
    try {
      await api('company', rule ? `/bonus-rules/${rule.id}` : '/bonus-rules', {
        method: rule ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const productOptions = products.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.reference})`,
  }));

  return (
    <Modal title={rule ? 'Modifier la règle' : 'Nouvelle règle de bonus'} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <Field
          label="Nom"
          name="name"
          required
          defaultValue={rule?.name}
          placeholder="1 carton de thon tomate = 4 triplettes offertes"
        />
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-text-dark">Pour l'achat de</legend>
          <Select
            label="Produit acheté"
            value={buyProductId}
            onChange={(e) => setBuyProductId(e.target.value)}
            options={productOptions}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <Field
              label="Quantité"
              name="buyQty"
              type="number"
              min={1}
              required
              defaultValue={rule?.buyQty ?? 1}
            />
            <Select
              key={`buy-unit-${buyProductId}`}
              label="Unité"
              name="buyUnitId"
              defaultValue={rule?.buyUnit.id}
              options={unitsOf(buy)}
            />
            {flavorsOf(buy).length > 0 && (
              <Select
                key={`buy-variant-${buyProductId}`}
                label="Parfum"
                name="buyVariantId"
                defaultValue={rule?.buyVariant?.id ?? ''}
                options={[
                  { value: '', label: 'Tous parfums cumulés' },
                  ...flavorsOf(buy).map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            )}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-text-dark">Offert</legend>
          <Select
            label="Produit offert"
            value={freeProductId}
            onChange={(e) => setFreeProductId(e.target.value)}
            options={productOptions}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              label="Quantité"
              name="freeQty"
              type="number"
              min={1}
              required
              defaultValue={rule?.freeQty ?? 1}
            />
            <Select
              key={`free-unit-${freeProductId}`}
              label="Unité"
              name="freeUnitId"
              defaultValue={rule?.freeUnit.id}
              options={unitsOf(free)}
            />
          </div>
          {flavorsOf(free).length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                label="Parfum offert"
                value={mode}
                onChange={(e) => setMode(e.target.value as BonusRuleDto['freeVariantMode'])}
                options={[
                  { value: 'AUTO_MOST_STOCK', label: 'Automatique : le plus en stock' },
                  { value: 'SELLER_CHOICE', label: 'Au choix du vendeur' },
                  { value: 'FIXED', label: 'Parfum fixé' },
                ]}
              />
              {mode === 'FIXED' && (
                <Select
                  key={`free-variant-${freeProductId}`}
                  label="Parfum"
                  name="freeVariantId"
                  defaultValue={rule?.freeVariant?.id}
                  options={flavorsOf(free).map((v) => ({ value: v.id, label: v.name }))}
                />
              )}
            </div>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Valable du"
            name="validFrom"
            type="date"
            required
            defaultValue={rule?.validFrom ?? new Date().toISOString().slice(0, 10)}
          />
          <Field
            label="Au (facultatif)"
            name="validTo"
            type="date"
            defaultValue={rule?.validTo ?? ''}
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text-dark">Types de clients</legend>
          <p className="text-xs text-muted">Aucun coché : la règle vaut pour tous.</p>
          <div className="flex flex-wrap gap-3">
            {types.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[#001850]"
                  checked={typeIds.includes(t.id)}
                  onChange={(e) =>
                    setTypeIds((ids) =>
                      e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                    )
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Toggle label="Règle active" checked={active} onChange={setActive} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit">{rule ? 'Enregistrer' : 'Créer la règle'}</Button>
      </form>
    </Modal>
  );
}
