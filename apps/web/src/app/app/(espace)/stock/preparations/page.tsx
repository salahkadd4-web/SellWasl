'use client';

import type { PrepareResult, RoutePreparationDto, RouteSummaryDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, PageTitle } from '@/components/ui';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDA, formatDate, ROUTE_STATUS } from '@/lib/labels';
import { warehouseLabel } from '@/lib/stock';

/**
 * Préparation des tournées (UC-41, BR-PRE-03) : liste de chargement par article et détail par
 * commande ; une quantité plus basse réduit la ligne, paliers et bonus sont recalculés (P-04).
 */
export default function PreparationsPage() {
  const { can } = CompanyAuth.useAuth();
  const [routes, setRoutes] = useState<RouteSummaryDto[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRoutes(await api<RouteSummaryDto[]>('company', '/routes/preparing'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Préparations"
        subtitle="Tournées lancées par le superviseur : quantités préparées, puis chargement du camion."
      />
      <StockTabs />
      {error && <Alert>{error}</Alert>}
      {result && (
        <div className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          <p>Préparation validée : la tournée est prête à charger.</p>
          <ul className="mt-2 list-disc pl-5">
            {result.orders.map((o) => (
              <li key={o.orderId}>
                Commande {o.number} : {formatDA(o.totalAmount)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open ? (
        <RoutePreparation
          routeId={open}
          editable={can('preparation.do')}
          onClose={() => setOpen(null)}
          onDone={(r) => {
            setOpen(null);
            setResult(r);
            void load();
          }}
        />
      ) : (
        routes && (
          <Card className="flex flex-col gap-3">
            {routes.length === 0 && (
              <p className="text-sm text-muted">Aucune tournée à préparer ou à charger.</p>
            )}
            <div className="overflow-hidden rounded-xl border border-border">
              {routes.map((r) => {
                const status = ROUTE_STATUS[r.status]!;
                return (
                  <div
                    key={r.id}
                    className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-text-dark">
                        {r.driver.name} · {r.driver.code}
                      </span>
                      <span className="text-xs text-muted">
                        Livraison du {formatDate(r.deliveryDate)} ·{' '}
                        {r.truck ? warehouseLabel(r.truck) : 'Pas de camion'} · {r.ordersCount}{' '}
                        commande(s)
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {r.status === 'PREPARING' && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setResult(null);
                            setOpen(r.id);
                          }}
                        >
                          Préparer
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )
      )}
    </div>
  );
}

/** Saisie des quantités préparées, dans l'unité de chaque ligne. */
function RoutePreparation({
  routeId,
  editable,
  onClose,
  onDone,
}: {
  routeId: string;
  editable: boolean;
  onClose: () => void;
  onDone: (result: PrepareResult) => void;
}) {
  const [view, setView] = useState<RoutePreparationDto | null>(null);
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RoutePreparationDto>('company', `/routes/${routeId}/preparation`)
      .then((v) => {
        setView(v);
        setPrepared(
          Object.fromEntries(
            v.orders.flatMap((o) => o.lines.map((l) => [l.lineId, String(l.defaultPrepared)])),
          ),
        );
      })
      .catch((err) => setError(errorMessage(err)));
  }, [routeId]);

  async function submit() {
    if (!view) return;
    setError(null);
    const lines = view.orders.flatMap((o) =>
      o.lines.map((l) => ({ lineId: l.lineId, preparedQty: Number(prepared[l.lineId] ?? '') })),
    );
    if (lines.some((l) => !Number.isInteger(l.preparedQty) || l.preparedQty < 0))
      return setError('Les quantités préparées doivent être des nombres entiers positifs.');
    if (!confirm('Valider la préparation ? Les commandes passeront « Prêtes ».')) return;
    setBusy(true);
    try {
      onDone(
        await api<PrepareResult>('company', `/routes/${routeId}/prepare`, {
          method: 'POST',
          body: JSON.stringify({ lines }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-dark">
          {view
            ? `${view.route.driver.name} · livraison du ${formatDate(view.route.deliveryDate)}`
            : 'Préparation'}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
      {view && (
        <>
          <h3 className="font-semibold text-text-dark">Liste de chargement</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Article</th>
                  <th className="py-2 pr-3 font-medium">Commandé</th>
                  <th className="py-2 pr-3 font-medium">Réservé</th>
                  <th className="py-2 pr-3 font-medium">Disponible au dépôt</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((i) => (
                  <tr key={i.variantId} className="border-t border-border">
                    <td className="py-1.5 pr-3 text-text-dark">{articleLabel(i)}</td>
                    <td className="py-1.5 pr-3">{i.orderedBase}</td>
                    <td className="py-1.5 pr-3">
                      {i.reservedBase < i.orderedBase ? (
                        <span className="font-semibold text-error">{i.reservedBase}</span>
                      ) : (
                        i.reservedBase
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{i.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Quantités en unité de base.</p>
          <h3 className="font-semibold text-text-dark">Détail par commande</h3>
          {view.orders.map((o) => (
            <div key={o.orderId} className="overflow-hidden rounded-xl border border-border">
              <p className="border-b border-border bg-surface px-3 py-2 text-sm font-medium text-text-dark">
                {o.number} · {o.customerName}
              </p>
              {o.lines.map((l) => (
                <div
                  key={l.lineId}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex flex-wrap items-center gap-2 text-text-dark">
                    {articleLabel(l)}
                    {l.kind === 'BONUS' && <Badge tone="success">Offert</Badge>}
                    <span className="text-xs text-muted">
                      commandé {l.enteredQty} {l.unitName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      aria-label={`Préparé pour ${articleLabel(l)}, commande ${o.number}`}
                      inputMode="numeric"
                      disabled={!editable}
                      value={prepared[l.lineId] ?? ''}
                      onChange={(e) => setPrepared((p) => ({ ...p, [l.lineId]: e.target.value }))}
                      className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                    />
                    <span className="text-muted">{l.unitName}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      {error && <Alert>{error}</Alert>}
      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !view}>
            Valider la préparation
          </Button>
        </div>
      )}
    </Card>
  );
}
