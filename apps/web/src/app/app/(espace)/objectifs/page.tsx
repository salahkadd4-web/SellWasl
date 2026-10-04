'use client';

import type { ObjectiveDto, ProductRangeDto, TerritoryDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, todayDate } from '@/lib/labels';

interface Row {
  targetAmount: string;
  bonusAmount: string;
  capPercent: string;
}

const key = (userId: string, rangeId: string) => `${userId}:${rangeId}`;

/**
 * Objectifs du mois par vendeur et par gamme (UC-56, BR-OBJ) : cible, prime et plafond ; réalisé
 * sur le chiffre d'affaires livré et prime due.
 */
export default function ObjectivesPage() {
  const { can } = CompanyAuth.useAuth();
  const [sellers, setSellers] = useState<{ id: string; label: string }[]>([]);
  const [ranges, setRanges] = useState<ProductRangeDto[]>([]);
  const [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const [objectives, setObjectives] = useState<ObjectiveDto[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
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
      const list = await api<ObjectiveDto[]>('company', `/objectives?month=${month}`);
      setObjectives(list);
      setRows(
        Object.fromEntries(
          list.map((o) => [
            key(o.user.id, o.range.id),
            {
              targetAmount: String(o.targetAmount),
              bonusAmount: String(o.bonusAmount),
              capPercent: String(o.capPercent),
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
          capPercent: Number(r.capPercent || '120'),
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
            capPercent: '120',
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
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Objectifs enregistrés.
        </p>
      )}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Mois"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </Card>
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
                    className="grid gap-2 border-b border-border px-3 py-2 last:border-0 lg:grid-cols-[1fr_1fr_1fr_1fr_2fr] lg:items-end"
                  >
                    <span className="font-medium text-text-dark">{r.name}</span>
                    {field(k, 'targetAmount', 'Cible (DA)')}
                    {field(k, 'bonusAmount', 'Prime (DA)')}
                    {field(k, 'capPercent', 'Plafond (%)')}
                    <span className="text-sm text-muted">
                      {o
                        ? `Réalisé ${formatDA(o.realizedAmount)} · ${o.rate} % · prime due ${formatDA(o.estimatedBonus)}`
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
