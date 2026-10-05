'use client';

import type { DriverObjectiveDto, DriverObjectivesSettings } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ObjectivesTabs } from '@/components/objectives-tabs';
import { Alert, Button, Card, Field, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, todayDate } from '@/lib/labels';

interface Row {
  bonusAmount: string;
  ratings: Record<string, string>;
}

/**
 * Objectifs des livreurs : paliers du taux de retour et critères notés sur 10, pondérés, réglés
 * par l'admin ou le superviseur ; chaque mois, prime et notes de chaque livreur, et prime due.
 */
export default function DriverObjectivesPage() {
  const { can } = CompanyAuth.useAuth();
  const editable = can('objectives.update');
  const [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const [rules, setRules] = useState<DriverObjectivesSettings | null>(null);
  const [objectives, setObjectives] = useState<DriverObjectiveDto[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [settings, list] = await Promise.all([
        api<DriverObjectivesSettings>('company', '/driver-objectives/settings'),
        api<DriverObjectiveDto[]>('company', `/driver-objectives?month=${month}`),
      ]);
      setRules(settings);
      setObjectives(list);
      setRows(
        Object.fromEntries(
          list.map((o) => [
            o.user.id,
            {
              bonusAmount: o.bonusAmount ? String(o.bonusAmount) : '',
              ratings: Object.fromEntries(
                Object.entries(o.ratings).map(([id, v]) => [id, String(v)]),
              ),
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

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await action();
      await load();
      setSaved(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const totalWeight = rules
    ? rules.returnWeight + rules.criteria.reduce((sum, c) => sum + c.weight, 0)
    : 0;

  function saveRules() {
    if (!rules) return;
    if (totalWeight !== 100) return setError('La somme des poids doit faire 100.');
    if (rules.criteria.some((c) => !c.name.trim())) return setError('Nommez chaque critère.');
    void run(
      () =>
        api('company', '/driver-objectives/settings', {
          method: 'PUT',
          body: JSON.stringify(rules),
        }),
      'Règles enregistrées.',
    );
  }

  function saveObjectives() {
    const entries = Object.entries(rows).map(([userId, r]) => ({
      userId,
      bonusAmount: Number(r.bonusAmount || '0'),
      ratings: Object.fromEntries(
        Object.entries(r.ratings)
          .filter(([, v]) => v !== '')
          .map(([id, v]) => [id, Number(v)]),
      ),
    }));
    if (
      entries.some(
        (e) =>
          !Number.isInteger(e.bonusAmount) ||
          e.bonusAmount < 0 ||
          Object.values(e.ratings).some((v) => !Number.isInteger(v) || v < 0 || v > 10),
      )
    )
      return setError('Les primes sont des montants entiers, les notes vont de 0 à 10.');
    if (entries.length === 0) return setError('Aucun livreur actif.');
    void run(
      () =>
        api('company', '/driver-objectives', {
          method: 'PUT',
          body: JSON.stringify({ month, entries }),
        }),
      'Objectifs enregistrés.',
    );
  }

  const setRow = (userId: string, patch: Partial<Row>) =>
    setRows((r) => ({
      ...r,
      [userId]: { bonusAmount: '', ratings: {}, ...r[userId], ...patch },
    }));

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Objectifs des livreurs"
        subtitle="Taux de retour et critères notés par le superviseur ; prime selon le score du mois."
        action={
          editable && (
            <Button onClick={saveObjectives} disabled={busy}>
              Enregistrer
            </Button>
          )
        }
      />
      <ObjectivesTabs />
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          {saved}
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

      {rules && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold text-text-dark">Règles de l'objectif</h2>
          <p className="text-sm text-muted">
            Taux de retour = quantité revenue au déchargement ÷ quantité chargée, sur le mois.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Poids du taux de retour (%)"
              type="number"
              min={0}
              max={100}
              value={rules.returnWeight}
              disabled={!editable}
              onChange={(e) => setRules({ ...rules, returnWeight: Number(e.target.value) })}
            />
          </div>
          <h3 className="text-sm font-semibold text-text-dark">Paliers du taux de retour</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            {rules.returnTiers.map((tier, i) => (
              <div
                key={i}
                className="grid gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                <Field
                  label="Retour au plus (%)"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={tier.maxRate}
                  disabled={!editable}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      returnTiers: rules.returnTiers.map((t, j) =>
                        j === i ? { ...t, maxRate: Number(e.target.value) } : t,
                      ),
                    })
                  }
                />
                <Field
                  label="Part de l'objectif (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={tier.score}
                  disabled={!editable}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      returnTiers: rules.returnTiers.map((t, j) =>
                        j === i ? { ...t, score: Number(e.target.value) } : t,
                      ),
                    })
                  }
                />
                {editable && rules.returnTiers.length > 1 && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRules({
                        ...rules,
                        returnTiers: rules.returnTiers.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Retirer
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">Au-delà du dernier palier : 0 %.</p>
          <h3 className="text-sm font-semibold text-text-dark">Critères notés sur 10</h3>
          {rules.criteria.length === 0 && (
            <p className="text-sm text-muted">Aucun critère : seul le taux de retour compte.</p>
          )}
          {rules.criteria.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {rules.criteria.map((c, i) => (
                <div
                  key={c.id}
                  className="grid gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
                >
                  <Field
                    label="Critère"
                    value={c.name}
                    disabled={!editable}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        criteria: rules.criteria.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Field
                    label="Poids (%)"
                    type="number"
                    min={1}
                    max={100}
                    value={c.weight}
                    disabled={!editable}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        criteria: rules.criteria.map((x, j) =>
                          j === i ? { ...x, weight: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                  {editable && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setRules({ ...rules, criteria: rules.criteria.filter((_, j) => j !== i) })
                      }
                    >
                      Retirer
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className={`text-sm ${totalWeight === 100 ? 'text-muted' : 'text-error'}`}>
            Somme des poids : {totalWeight} % (doit faire 100 %).
          </p>
          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  setRules({
                    ...rules,
                    returnTiers: [
                      ...rules.returnTiers,
                      { maxRate: (rules.returnTiers.at(-1)?.maxRate ?? 0) + 5, score: 0 },
                    ],
                  })
                }
              >
                Ajouter un palier
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setRules({
                    ...rules,
                    criteria: [
                      ...rules.criteria,
                      { id: crypto.randomUUID(), name: '', weight: 10 },
                    ],
                  })
                }
              >
                Ajouter un critère
              </Button>
              <Button onClick={saveRules} disabled={busy}>
                Enregistrer les règles
              </Button>
            </div>
          )}
        </Card>
      )}

      {objectives && objectives.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Aucun livreur actif.</p>
        </Card>
      )}
      {objectives?.map((o) => (
        <Card key={o.user.id} className="flex flex-col gap-3">
          <h2 className="font-semibold text-text-dark">
            {o.user.code} · {o.user.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Prime du mois (DA)"
              type="number"
              min={0}
              value={rows[o.user.id]?.bonusAmount ?? ''}
              disabled={!editable}
              onChange={(e) => setRow(o.user.id, { bonusAmount: e.target.value })}
            />
            {rules?.criteria.map((c) => (
              <Field
                key={c.id}
                label={`${c.name} (sur 10)`}
                type="number"
                min={0}
                max={10}
                value={rows[o.user.id]?.ratings[c.id] ?? ''}
                disabled={!editable}
                onChange={(e) =>
                  setRow(o.user.id, {
                    ratings: { ...rows[o.user.id]?.ratings, [c.id]: e.target.value },
                  })
                }
              />
            ))}
          </div>
          <p className="text-sm text-muted">
            {o.returnRate === null
              ? 'Aucun chargement ce mois-ci'
              : `Taux de retour ${o.returnRate} % (chargé ${o.loaded}, revenu ${o.returned})`}{' '}
            · score du taux {o.returnScore} % · score total {o.score} % · prime due{' '}
            {formatDA(o.estimatedBonus)} · versée le {formatDate(o.paymentDate)}
          </p>
        </Card>
      ))}
    </div>
  );
}
