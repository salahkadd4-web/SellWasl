'use client';

import type { IncentiveDto, IncentiveRuleDto, ProductDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, INCENTIVE_KIND, INCENTIVE_STATUS, todayDate } from '@/lib/labels';
import { useEmployees } from '@/lib/payroll';

const ROLES = [
  { value: 'PRE_VENDEUR', label: 'Tous les pré-vendeurs' },
  { value: 'VENDEUR_CASH_VAN', label: 'Tous les vendeurs cash van' },
  { value: 'LIVREUR', label: 'Tous les livreurs' },
];

/** Description courte d'une règle : « 20 DA par carton », « 2 % du CA »… */
function ruleText(r: IncentiveRuleDto): string {
  const unit = r.unit?.name ?? 'unité';
  switch (r.kind) {
    case 'PER_UNIT':
      return `${formatDA(r.amount ?? 0)} par ${unit}`;
    case 'PERCENT_REVENUE':
      return `${(r.percentBp ?? 0) / 100} % du CA`;
    case 'THRESHOLD':
      return `${formatDA(r.amount ?? 0)} dès ${r.threshold} ${unit}(s)`;
    case 'REVENUE_TARGET':
      return `${formatDA(r.amount ?? 0)} si CA ≥ ${formatDA(r.threshold ?? 0)}`;
    case 'TIERED':
      return (r.tiers ?? []).map((t) => `${t.minQty}+ : ${formatDA(t.unitAmount)}`).join(' · ');
  }
}

/**
 * Primes (phase 21 bis) : règles configurées par l'administrateur ; en fin de semaine ou de
 * mois, le comptable lance le calcul sur les ventes livrées, vérifie et valide.
 */
export default function IncentivesPage() {
  const { can } = CompanyAuth.useAuth();
  const [rules, setRules] = useState<IncentiveRuleDto[] | null>(null);
  const [incentives, setIncentives] = useState<IncentiveDto[] | null>(null);
  const [date, setDate] = useState(todayDate);
  const [frequency, setFrequency] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [editing, setEditing] = useState<IncentiveRuleDto | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      setRules(await api<IncentiveRuleDto[]>('company', '/incentive-rules'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void loadRules();
    api<IncentiveDto[]>('company', '/incentives')
      .then(setIncentives)
      .catch(() => setIncentives([]));
  }, [loadRules]);

  /** Désactive ou réactive une règle : les primes déjà calculées restent. */
  async function toggle(r: IncentiveRuleDto) {
    if (
      r.isActive &&
      !confirm(`Désactiver « ${r.name} » ? Plus aucune prime ne sera calculée avec elle.`)
    )
      return;
    setError(null);
    try {
      await api('company', `/incentive-rules/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...ruleBody(r), isActive: !r.isActive }),
      });
      await loadRules();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function calculate() {
    setError(null);
    setBusy(true);
    try {
      setIncentives(
        await api<IncentiveDto[]>('company', '/incentives/calculate', {
          method: 'POST',
          body: JSON.stringify({ date, frequency }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(i: IncentiveDto, action: 'validate' | 'reject') {
    setError(null);
    try {
      const updated = await api<IncentiveDto>('company', `/incentives/${i.id}/${action}`, {
        method: 'POST',
      });
      setIncentives((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Primes"
        subtitle="Primes calculées sur les ventes livrées, validées avant d'entrer dans la paie."
        action={
          can('incentives.manage') && (
            <Button onClick={() => setEditing('new')}>Nouvelle règle</Button>
          )
        }
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}

      {rules && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Règles</h2>
          {rules.length === 0 && <p className="text-sm text-muted">Aucune règle de prime.</p>}
          {rules.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">{r.name}</span>
                    <span className="text-xs text-muted">
                      {INCENTIVE_KIND[r.kind]} · {ruleText(r)}
                      {r.product ? ` · ${r.product.name}` : ''} ·{' '}
                      {r.frequency === 'WEEKLY' ? 'chaque semaine' : 'chaque mois'} ·{' '}
                      {r.user ? r.user.name : ROLES.find((x) => x.value === r.roleCode)?.label} ·
                      depuis le {formatDate(r.validFrom)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>
                      {r.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {can('incentives.manage') && (
                      <>
                        <Button variant="secondary" onClick={() => setEditing(r)}>
                          Modifier
                        </Button>
                        <Button variant="secondary" onClick={() => void toggle(r)}>
                          {r.isActive ? 'Désactiver' : 'Réactiver'}
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-dark">Calcul et validation</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field
            label="Une date de la période"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Select
            label="Période"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as 'WEEKLY' | 'MONTHLY')}
            options={[
              { value: 'WEEKLY', label: 'Semaine' },
              { value: 'MONTHLY', label: 'Mois' },
            ]}
          />
          {can('incentives.validate') && (
            <Button disabled={busy} onClick={() => void calculate()}>
              Calculer la période
            </Button>
          )}
        </div>
        {incentives?.length === 0 && <p className="text-sm text-muted">Aucune prime calculée.</p>}
        {incentives && incentives.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border">
            {incentives.map((i) => {
              const s = INCENTIVE_STATUS[i.status]!;
              return (
                <div
                  key={i.id}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0"
                >
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <span className="flex flex-col">
                      <span className="font-medium text-text-dark">
                        {i.user.name} · {i.rule.name}
                      </span>
                      <span className="text-xs text-muted">
                        Du {formatDate(i.periodStart)} au {formatDate(i.periodEnd)} · {i.quantity}{' '}
                        {i.unitName ?? 'unité(s)'}
                        {i.unitAmount !== null ? ` × ${formatDA(i.unitAmount)}` : ''} · CA{' '}
                        {formatDA(i.revenue)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text-dark">
                        {formatDA(i.amount)}
                      </span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <Button
                        variant="secondary"
                        onClick={() => setOpen(open === i.id ? null : i.id)}
                      >
                        Ventes
                      </Button>
                      {can('incentives.validate') && i.status === 'CALCULATED' && (
                        <>
                          <Button onClick={() => void decide(i, 'validate')}>Valider</Button>
                          <Button variant="secondary" onClick={() => void decide(i, 'reject')}>
                            Refuser
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  {open === i.id && (
                    <ul className="flex flex-col gap-0.5 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                      {i.details.map((d, k) => (
                        <li key={k}>
                          Commande {d.orderNumber} · bon {d.deliveryNumber} · {d.qty} ·{' '}
                          {formatDA(d.amount)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {editing && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void loadRules();
          }}
        />
      )}
    </div>
  );
}

/** Corps d'une règle existante, pour la renvoyer telle quelle ou modifiée. */
function ruleBody(r: IncentiveRuleDto) {
  return {
    name: r.name,
    kind: r.kind,
    frequency: r.frequency,
    productId: r.product?.id ?? null,
    unitId: r.unit?.id ?? null,
    amount: r.amount,
    percentBp: r.percentBp,
    threshold: r.threshold,
    tiers: r.tiers,
    userId: r.user?.id ?? null,
    roleCode: r.roleCode,
    isActive: r.isActive,
    validFrom: r.validFrom,
    validTo: r.validTo,
  };
}

function RuleForm({
  rule,
  onClose,
  onDone,
}: {
  rule: IncentiveRuleDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const employees = useEmployees();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    kind: (rule?.kind ?? 'PER_UNIT') as string,
    frequency: (rule?.frequency ?? 'WEEKLY') as string,
    productId: rule?.product?.id ?? '',
    unitId: rule?.unit?.id ?? '',
    amount: rule?.amount ? String(rule.amount) : '',
    percent: rule?.percentBp ? String(rule.percentBp / 100) : '',
    threshold: rule?.threshold ? String(rule.threshold) : '',
    tiers: (rule?.tiers ?? []).map((t) => `${t.minQty}:${t.unitAmount}`).join(', '),
    target: rule?.user?.id ?? rule?.roleCode ?? 'LIVREUR',
    validFrom: rule?.validFrom ?? todayDate(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const product = products.find((p) => p.id === form.productId);

  useEffect(() => {
    api<ProductDto[]>('company', '/products?status=ACTIVE')
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  async function submit() {
    // « 50:10, 100:20 » : 10 DA par unité dès 50, 20 DA dès 100
    const tiers = form.tiers
      .split(',')
      .map((t) => t.split(':').map((x) => Number(x.trim())))
      .filter((t) => t.length === 2 && t.every(Number.isFinite))
      .map(([minQty, unitAmount]) => ({ minQty: minQty!, unitAmount: unitAmount! }));
    const isRole = ROLES.some((r) => r.value === form.target);
    setError(null);
    setBusy(true);
    try {
      await api('company', rule ? `/incentive-rules/${rule.id}` : '/incentive-rules', {
        method: rule ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          kind: form.kind,
          frequency: form.frequency,
          productId: form.productId || null,
          unitId: form.unitId || null,
          amount: form.amount ? Number(form.amount) : null,
          percentBp: form.percent ? Math.round(Number(form.percent) * 100) : null,
          threshold: form.threshold ? Number(form.threshold) : null,
          tiers: form.kind === 'TIERED' ? tiers : null,
          userId: isRole ? null : form.target,
          roleCode: isRole ? form.target : null,
          validFrom: form.validFrom,
          validTo: rule?.validTo ?? null,
          isActive: rule?.isActive ?? true,
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
      title={rule ? 'Modifier la règle de prime' : 'Nouvelle règle de prime'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Field label="Nom" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value })}
            options={Object.entries(INCENTIVE_KIND).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Fréquence"
            value={form.frequency}
            onChange={(e) => set({ frequency: e.target.value })}
            options={[
              { value: 'WEEKLY', label: 'Chaque semaine' },
              { value: 'MONTHLY', label: 'Chaque mois' },
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Produit compté"
            value={form.productId}
            onChange={(e) => set({ productId: e.target.value, unitId: '' })}
            options={[
              { value: '', label: 'Tous les produits (CA)' },
              ...products.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Unité"
            value={form.unitId}
            disabled={!product}
            onChange={(e) => set({ unitId: e.target.value })}
            options={[
              { value: '', label: 'Unité de base' },
              ...(product?.units ?? []).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </div>
        {(form.kind === 'PER_UNIT' ||
          form.kind === 'THRESHOLD' ||
          form.kind === 'REVENUE_TARGET') && (
          <Field
            label={form.kind === 'PER_UNIT' ? 'Prime par unité (DA)' : 'Prime (DA)'}
            type="number"
            min={1}
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        )}
        {form.kind === 'PERCENT_REVENUE' && (
          <Field
            label="Pourcentage du CA"
            type="number"
            min={0.01}
            step={0.01}
            value={form.percent}
            onChange={(e) => set({ percent: e.target.value })}
          />
        )}
        {(form.kind === 'THRESHOLD' || form.kind === 'REVENUE_TARGET') && (
          <Field
            label={form.kind === 'THRESHOLD' ? 'Seuil (quantité)' : 'Seuil de CA (DA)'}
            type="number"
            min={1}
            value={form.threshold}
            onChange={(e) => set({ threshold: e.target.value })}
          />
        )}
        {form.kind === 'TIERED' && (
          <Field
            label="Paliers"
            hint="Quantité minimale : prime par unité, séparés par des virgules (ex. 0:0, 50:10, 100:20)"
            value={form.tiers}
            onChange={(e) => set({ tiers: e.target.value })}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Pour"
            value={form.target}
            onChange={(e) => set({ target: e.target.value })}
            options={[
              ...ROLES,
              ...employees.map((e) => ({
                value: e.user.id,
                label: `${e.user.name} (${e.user.code})`,
              })),
            ]}
          />
          <Field
            label="À partir du"
            type="date"
            value={form.validFrom}
            onChange={(e) => e.target.value && set({ validFrom: e.target.value })}
          />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {rule ? 'Enregistrer' : 'Créer la règle'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
