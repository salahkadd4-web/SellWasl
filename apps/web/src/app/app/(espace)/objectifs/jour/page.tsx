'use client';

import type { DailyObjectiveDto, ProductDto, TerritoryDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ObjectivesTabs } from '@/components/objectives-tabs';
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
import { formatDA, formatDate, todayDate } from '@/lib/labels';

/** « 10 cartons par jour · 500 DA · compté dès 4 · plafond 100 % ». */
function summary(o: DailyObjectiveDto): string {
  return [
    `${o.dailyTarget} ${o.unit.name} par jour`,
    `${formatDA(o.bonusAmount)} par jour`,
    o.minQty === null ? 'compté dès 1' : `compté dès ${o.minQty}`,
    o.capPercent === null ? 'sans plafond' : `plafond ${o.capPercent} %`,
  ].join(' · ');
}

/**
 * Objectifs du jour (BR-OBJ-06, BR-OBJ-07) : une quantité d'un produit par jour et par vendeur,
 * comptée chaque jour (0 sous le minimum) et payée à la semaine, après validation du comptable.
 */
export default function DailyObjectivesPage() {
  const { can } = CompanyAuth.useAuth();
  const [list, setList] = useState<DailyObjectiveDto[] | null>(null);
  const [editing, setEditing] = useState<DailyObjectiveDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<DailyObjectiveDto[]>('company', '/objectives/daily'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const editable = can('objectives.update');
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Objectifs du jour"
        subtitle="Quantité d'un produit par jour et par vendeur ; chaque jour compte à part, la prime est payée en fin de semaine."
        action={editable && <Button onClick={() => setEditing('new')}>Nouvel objectif</Button>}
      />
      <ObjectivesTabs />
      {error && <Alert>{error}</Alert>}
      <Card className="text-sm text-muted">
        Prime d&apos;un jour : 0 sous le minimum, sinon prime × réalisé ÷ cible, dans la limite du
        plafond. Exemple : cible 10, prime 500 DA, minimum 4 → 3 cartons : 0 DA ; 6 : 300 DA ; 12 :
        500 DA. Quantités livrées, au jour de la commande (ou de la vente du cash van).
      </Card>
      {list && list.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Aucun objectif du jour.</p>
        </Card>
      )}
      {list && list.length > 0 && (
        <Card className="flex flex-col divide-y divide-border p-0">
          {list.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-dark">
                  {o.user.code} · {o.user.name} — {o.product.name}
                </p>
                <p className="text-sm text-muted">
                  {summary(o)} · depuis le {formatDate(o.validFrom)}
                  {o.validTo ? ` jusqu'au ${formatDate(o.validTo)}` : ''}
                </p>
              </div>
              <Badge tone={o.isActive ? 'success' : 'neutral'}>
                {o.isActive ? 'Actif' : 'Inactif'}
              </Badge>
              {editable && (
                <Button variant="secondary" onClick={() => setEditing(o)}>
                  Modifier
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      {editing && (
        <DailyObjectiveForm
          objective={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DailyObjectiveForm({
  objective,
  onClose,
  onDone,
}: {
  objective: DailyObjectiveDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [sellers, setSellers] = useState<{ value: string; label: string }[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [form, setForm] = useState({
    userId: objective?.user.id ?? '',
    productId: objective?.product.id ?? '',
    unitId: objective?.unit.id ?? '',
    dailyTarget: objective ? String(objective.dailyTarget) : '',
    bonusAmount: objective ? String(objective.bonusAmount) : '',
    minQty: objective?.minQty ? String(objective.minQty) : '',
    capPercent: objective?.capPercent ? String(objective.capPercent) : '100',
    uncapped: objective ? objective.capPercent === null : false,
    validFrom: objective?.validFrom ?? todayDate(),
    validTo: objective?.validTo ?? '',
    isActive: objective?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const product = products.find((p) => p.id === form.productId);

  useEffect(() => {
    void Promise.all([
      api<TerritoryDto[]>('company', '/territories'),
      api<ProductDto[]>('company', '/products?status=ACTIVE'),
    ])
      .then(([territories, items]) => {
        const seen = new Map<string, string>();
        for (const t of territories)
          if (t.seller) seen.set(t.seller.id, `${t.seller.code} · ${t.seller.name}`);
        setSellers([...seen.entries()].map(([value, label]) => ({ value, label })));
        setProducts(items);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function submit() {
    setError(null);
    const minQty = form.minQty ? Number(form.minQty) : null;
    if (!form.userId || !form.productId || !form.unitId)
      return setError('Choisissez le vendeur, le produit et l’unité.');
    if (minQty !== null && minQty > Number(form.dailyTarget))
      return setError('Le minimum ne peut pas dépasser la cible du jour.');
    setBusy(true);
    try {
      await api('company', objective ? `/objectives/daily/${objective.id}` : '/objectives/daily', {
        method: objective ? 'PUT' : 'POST',
        body: JSON.stringify({
          userId: form.userId,
          productId: form.productId,
          unitId: form.unitId,
          dailyTarget: Number(form.dailyTarget),
          bonusAmount: Number(form.bonusAmount),
          minQty,
          capPercent: form.uncapped ? null : Number(form.capPercent),
          validFrom: form.validFrom,
          validTo: form.validTo || null,
          isActive: form.isActive,
        }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={objective ? 'Modifier l’objectif du jour' : 'Nouvel objectif du jour'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Vendeur"
          value={form.userId}
          onChange={(e) => set({ userId: e.target.value })}
          options={[{ value: '', label: 'Choisir…' }, ...sellers]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Produit"
            value={form.productId}
            onChange={(e) => {
              const next = products.find((p) => p.id === e.target.value);
              set({ productId: e.target.value, unitId: next?.units[0]?.id ?? '' });
            }}
            options={[
              { value: '', label: 'Choisir…' },
              ...products.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Unité"
            value={form.unitId}
            onChange={(e) => set({ unitId: e.target.value })}
            options={(product?.units ?? []).map((u) => ({ value: u.id, label: u.name }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Cible par jour"
            type="number"
            min={1}
            value={form.dailyTarget}
            onChange={(e) => set({ dailyTarget: e.target.value })}
          />
          <Field
            label="Prime par jour (DA)"
            type="number"
            min={1}
            value={form.bonusAmount}
            onChange={(e) => set({ bonusAmount: e.target.value })}
          />
          <Field
            label="Compté à partir de (quantité)"
            hint="Vide : pas de minimum"
            type="number"
            min={1}
            value={form.minQty}
            onChange={(e) => set({ minQty: e.target.value })}
          />
          <Field
            label="Plafond (%)"
            type="number"
            min={100}
            max={500}
            value={form.uncapped ? '' : form.capPercent}
            disabled={form.uncapped}
            onChange={(e) => set({ capPercent: e.target.value })}
          />
        </div>
        <Toggle
          label="Sans plafond"
          description="La prime d'un jour suit la quantité sans limite."
          checked={form.uncapped}
          onChange={(uncapped) => set({ uncapped })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="À partir du"
            type="date"
            value={form.validFrom}
            onChange={(e) => set({ validFrom: e.target.value })}
          />
          <Field
            label="Jusqu'au"
            hint="Vide : sans fin"
            type="date"
            value={form.validTo}
            onChange={(e) => set({ validTo: e.target.value })}
          />
        </div>
        <Toggle
          label="Actif"
          description="Inactif : plus compté à partir de la semaine suivante."
          checked={form.isActive}
          onChange={(isActive) => set({ isActive })}
        />
        {error && <Alert>{error}</Alert>}
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Modal>
  );
}
