'use client';

import type { ObjectiveDto, ProductRangeDto, TerritoryDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ObjectivesTabs } from '@/components/objectives-tabs';
import { Alert, Button, Card, Field, PageTitle, Select, Toggle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, todayDate } from '@/lib/labels';

interface Row {
  targetAmount: string;
  bonusAmount: string;
}

const key = (userId: string, rangeId: string) => `${userId}:${rangeId}`;

/**
 * Objectifs du mois par vendeur et par gamme (UC-56, BR-OBJ) : cible et prime de chacun, plafond
 * unique de l'entreprise ; réalisé sur le chiffre d'affaires livré et prime due.
 */
export default function ObjectivesPage() {
  const { can } = CompanyAuth.useAuth();
  const [sellers, setSellers] = useState<{ id: string; label: string }[]>([]);
  const [ranges, setRanges] = useState<ProductRangeDto[]>([]);
  const [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const [objectives, setObjectives] = useState<ObjectiveDto[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [cap, setCap] = useState('');
  const [uncapped, setUncapped] = useState(false);
  const [delay, setDelay] = useState<'0' | '1'>('0');
  const [commonBonus, setCommonBonus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<TerritoryDto[]>('company', '/territories'),
      api<ProductRangeDto[]>('company', '/product-ranges'),
    ])
      .then(([t, r]) => {
        setSellers(
          t
            .filter((x) => x.seller)
            .map((x) => ({ id: x.seller!.id, label: `${x.seller!.code} · ${x.seller!.name}` })),
        );
        setRanges(r.filter((x) => x.isActive));
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setSaved(false);
    try {
      const [list, companyCap, payment] = await Promise.all([
        api<ObjectiveDto[]>('company', `/objectives?month=${month}`),
        api<{ capPercent: number | null }>('company', '/objectives/cap'),
        api<{ delayMonths: 0 | 1 }>('company', '/objectives/payment'),
      ]);
      setDelay(String(payment.delayMonths) as '0' | '1');
      setObjectives(list);
      setUncapped(companyCap.capPercent === null);
      setCap(companyCap.capPercent === null ? '' : String(companyCap.capPercent));
      setRows(
        Object.fromEntries(
          list.map((o) => [
            key(o.user.id, o.range.id),
            {
              targetAmount: String(o.targetAmount),
              bonusAmount: String(o.bonusAmount),
            },
          ]),
        ),
      );
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    const entries = Object.entries(rows)
      .filter(([, r]) => r.targetAmount !== '')
      .map(([k, r]) => {
        const [userId, rangeId] = k.split(':') as [string, string];
        return {
          userId,
          rangeId,
          targetAmount: Number(r.targetAmount),
          bonusAmount: Number(r.bonusAmount || '0'),
        };
      });
    if (entries.length === 0) return setError('Saisissez au moins une cible.');
    setBusy(true);
    try {
      await api('company', '/objectives', {
        method: 'PUT',
        body: JSON.stringify({ month, entries }),
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Plafond unique de l'entreprise, appliqué au mois en cours et aux suivants (BR-OBJ-01). */
  async function saveCap() {
    setError(null);
    const value = uncapped ? null : Number(cap);
    if (value !== null && (!Number.isInteger(value) || value < 100 || value > 500))
      return setError('Le plafond doit être un nombre entier entre 100 et 500 %.');
    setBusy(true);
    try {
      await api('company', '/objectives/cap', {
        method: 'PUT',
        body: JSON.stringify({ capPercent: value }),
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Versement des primes à la fin du mois, ou à la fin du mois suivant. */
  async function savePaymentDelay(value: '0' | '1') {
    setError(null);
    setDelay(value);
    try {
      await api('company', '/objectives/payment', {
        method: 'PUT',
        body: JSON.stringify({ delayMonths: Number(value) }),
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /** Même prime pour tous les vendeurs d'une gamme : remplit leurs lignes. */
  function applyCommonBonus(rangeId: string) {
    const bonus = commonBonus[rangeId] ?? '';
    setRows((current) => {
      const next = { ...current };
      for (const s of sellers) {
        const k = key(s.id, rangeId);
        next[k] = { targetAmount: next[k]?.targetAmount ?? '', bonusAmount: bonus };
      }
      return next;
    });
  }

  const editable = can('objectives.update');
  const field = (k: string, name: keyof Row, label: string) => (
    <Field
      label={label}
      type="number"
      min={0}
      value={rows[k]?.[name] ?? ''}
      disabled={!editable}
      onChange={(e) =>
        setRows((r) => ({
          ...r,
          [k]: {
            targetAmount: '',
            bonusAmount: '',
            ...r[k],
            [name]: e.target.value,
          },
        }))
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Objectifs du mois"
        subtitle="Cible par vendeur et par gamme, sur le chiffre d'affaires livré ; prime plafonnée."
        action={
          editable && (
            <Button onClick={() => void save()} disabled={busy}>
              Enregistrer
            </Button>
          )
        }
      />
      <ObjectivesTabs />
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Objectifs enregistrés.
        </p>
      )}
      <Card className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field
          label="Mois"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <Field
            label="Plafond de l'entreprise (%)"
            type="number"
            min={100}
            max={500}
            value={uncapped ? '' : cap}
            disabled={!editable || uncapped}
            onChange={(e) => setCap(e.target.value)}
            hint="Le même pour tous les vendeurs ; appliqué au mois en cours et aux suivants."
          />
          <Toggle
            label="Sans plafond"
            description="La prime suit le taux sans limite."
            checked={uncapped}
            disabled={!editable}
            onChange={setUncapped}
          />
        </div>
        {editable && (
          <Button variant="secondary" onClick={() => void saveCap()} disabled={busy}>
            Enregistrer le plafond
          </Button>
        )}
        <Select
          label="Versement des primes"
          value={delay}
          disabled={!editable}
          onChange={(e) => void savePaymentDelay(e.target.value as '0' | '1')}
          options={[
            { value: '0', label: 'À la fin du mois' },
            { value: '1', label: 'À la fin du mois suivant' },
          ]}
        />
      </Card>
      {editable && ranges.length > 0 && sellers.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold text-text-dark">Prime commune par gamme</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ranges.map((r) => (
              <div key={r.id} className="flex items-end gap-2">
                <Field
                  label={`${r.name} : prime (DA)`}
                  type="number"
                  min={0}
                  value={commonBonus[r.id] ?? ''}
                  onChange={(e) => setCommonBonus((c) => ({ ...c, [r.id]: e.target.value }))}
                />
                <Button variant="secondary" onClick={() => applyCommonBonus(r.id)}>
                  Appliquer
                </Button>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">
            Remplit la prime de tous les vendeurs ; il ne reste qu'à saisir leurs cibles puis à
            enregistrer.
          </p>
        </Card>
      )}
      {sellers.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Aucun secteur n'a de vendeur : affectez les vendeurs dans la page Secteurs.
          </p>
        </Card>
      )}
      {objectives &&
        sellers.map((s) => (
          <Card key={s.id} className="flex flex-col gap-3">
            <h2 className="font-semibold text-text-dark">{s.label}</h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {ranges.map((r) => {
                const k = key(s.id, r.id);
                const o = objectives.find((x) => x.user.id === s.id && x.range.id === r.id);
                return (
                  <div
                    key={r.id}
                    className="grid gap-2 border-b border-border px-3 py-2 last:border-0 lg:grid-cols-[1fr_1fr_1fr_2fr] lg:items-end"
                  >
                    <span className="font-medium text-text-dark">{r.name}</span>
                    {field(k, 'targetAmount', 'Cible (DA)')}
                    {field(k, 'bonusAmount', 'Prime (DA)')}
                    <span className="text-sm text-muted">
                      {o
                        ? `Réalisé ${formatDA(o.realizedAmount)} · ${o.rate} % · prime due ${formatDA(o.estimatedBonus)} (${o.capPercent === null ? 'sans plafond' : `plafond ${o.capPercent} %`}) · versée le ${formatDate(o.paymentDate)}`
                        : 'Pas d’objectif'}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
    </div>
  );
}
