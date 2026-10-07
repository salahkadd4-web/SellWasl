'use client';

import {
  type CompanyUser,
  LAUNCH_BLOCKER_LABELS,
  type RouteCandidateDto,
} from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, nextDate, ROUTE_STATUS, todayDate } from '@/lib/labels';
import { warehouseLabel } from '@/lib/stock';

/**
 * Tournées d'une date de livraison (UC-61, BR-PRE-01, BR-PRE-02) : commandes figées regroupées
 * par livreur ; le lancement de la préparation attend que rien ne bloque.
 */
export default function RoutesPage() {
  const { can } = CompanyAuth.useAuth();
  const [date, setDate] = useState(() => nextDate(todayDate()));
  const [routes, setRoutes] = useState<RouteCandidateDto[] | null>(null);
  const [drivers, setDrivers] = useState<CompanyUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!can('users.read')) return;
    api<CompanyUser[]>('company', '/users')
      .then((users) =>
        setDrivers(users.filter((u) => u.status === 'ACTIVE' && u.role.code === 'LIVREUR')),
      )
      .catch((err) => setError(errorMessage(err)));
  }, [can]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRoutes(await api<RouteCandidateDto[]>('company', `/routes?date=${date}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const launch = (r: RouteCandidateDto) =>
    run(() =>
      api('company', '/routes/launch', {
        method: 'POST',
        headers: idempotencyKey(`launch:${date}:${r.driver!.id}`),
        body: JSON.stringify({ date, driverId: r.driver!.id }),
      }).then((result) => {
        idempotencyDone(`launch:${date}:${r.driver!.id}`);
        return result;
      }),
    );

  /** Changer le livreur d'un secteur avant le lancement (BR-PRE-01). */
  const changeDriver = (territoryId: string, deliveryUserId: string) =>
    run(() =>
      api('company', `/territories/${territoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryUserId: deliveryUserId || null }),
      }),
    );

  const canLaunch = can('preparation.launch');
  const canAssign = can('territories.update') && drivers.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Tournées"
        subtitle="Commandes figées d'une date de livraison, regroupées par livreur ; lancement de la préparation."
      />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Date de livraison"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </Card>
      {routes && (
        <>
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          {routes.length === 0 && (
            <Card>
              <p className="text-sm text-muted">Aucune commande à livrer ce jour-là.</p>
            </Card>
          )}
          {routes.map((r) => {
            const status = ROUTE_STATUS[r.status]!;
            return (
              <Card
                key={r.routeId ?? r.driver?.id ?? 'sans-livreur'}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-semibold text-text-dark">
                      {r.driver ? `${r.driver.name} · ${r.driver.code}` : 'Sans livreur'}
                    </span>
                    <span className="text-xs text-muted">
                      {r.truck ? warehouseLabel(r.truck) : 'Pas de camion'} · {r.ordersCount}{' '}
                      commande(s), {formatDA(r.totalAmount)}
                      {r.stockouts > 0 ? ` · ${r.stockouts} ligne(s) en rupture` : ''}
                    </span>
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div className="overflow-hidden rounded-xl border border-border">
                  {r.territories.map((territory) => (
                    <div
                      key={territory.id}
                      className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 sm:flex-row sm:items-end sm:justify-between"
                    >
                      <span className="text-sm text-text-dark">
                        {territory.code} · {territory.name}
                      </span>
                      {canAssign && !r.routeId && (
                        <Select
                          label="Livreur du secteur"
                          value={r.driver?.id ?? ''}
                          disabled={busy}
                          onChange={(e) => void changeDriver(territory.id, e.target.value)}
                          options={[
                            { value: '', label: 'Aucun' },
                            ...drivers.map((d) => ({
                              value: d.id,
                              label: `${d.firstName} ${d.lastName} · ${d.code}`,
                            })),
                          ]}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {r.progress && (
                  <p className="text-sm text-muted">
                    Livrées {r.progress.delivered} · partielles {r.progress.partial} · échecs{' '}
                    {r.progress.failed} · à livrer {r.progress.pending} · encaissé{' '}
                    {formatDA(r.progress.collected)}
                  </p>
                )}
                {r.blockers.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm text-error">
                    {r.blockers.map((b) => (
                      <li key={b}>{LAUNCH_BLOCKER_LABELS[b]}</li>
                    ))}
                  </ul>
                )}
                {canLaunch && !r.routeId && r.driver && (
                  <div className="flex justify-end">
                    <Button onClick={() => void launch(r)} disabled={busy || r.blockers.length > 0}>
                      Lancer la préparation
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
