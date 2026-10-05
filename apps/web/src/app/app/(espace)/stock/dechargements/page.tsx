'use client';

import type { PendingUnloadDto, UnloadDto, UnloadPreviewLine } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle } from '@/components/ui';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { articleLabel, formatDate, formatDateTime, todayDate } from '@/lib/labels';
import { warehouseLabel } from '@/lib/stock';

interface Reason {
  id: string;
  kind: string;
  label: string;
  isActive: boolean;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Déchargement des camions (UC-43, BR-STK-07) après la clôture de la journée du conducteur :
 * comptage, écart signé avec motif, retour au dépôt ou stock gardé selon P-06.
 */
export default function UnloadsPage() {
  const { can } = CompanyAuth.useAuth();
  const [pending, setPending] = useState<PendingUnloadDto[] | null>(null);
  const [counting, setCounting] = useState<PendingUnloadDto | null>(null);
  const [date, setDate] = useState(todayDate);
  const [unloads, setUnloads] = useState<UnloadDto[] | null>(null);
  const [detail, setDetail] = useState<UnloadDto | null>(null);
  const [done, setDone] = useState<UnloadDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, u] = await Promise.all([
        api<PendingUnloadDto[]>('company', '/unloads/pending'),
        api<UnloadDto[]>('company', `/unloads?date=${date}`),
      ]);
      setPending(p);
      setUnloads(u);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Déchargements"
        subtitle="Comptage du camion après la clôture de la journée ; l'écart est signalé au superviseur."
      />
      <StockTabs />
      {error && <Alert>{error}</Alert>}
      {done && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          {warehouseLabel(done.truck)} déchargé
          {done.hasGap ? ', avec écart' : ', sans écart'}
          {done.keepsStockInTruck
            ? ' ; le stock reste dans le camion.'
            : ' ; le stock est rentré au dépôt.'}
        </p>
      )}
      {counting ? (
        <UnloadCount
          pendingUnload={counting}
          editable={can('unloads.validate')}
          onClose={() => setCounting(null)}
          onDone={(u) => {
            setCounting(null);
            setDone(u);
            setDate(u.date);
            void load();
          }}
        />
      ) : (
        pending && (
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text-dark">À décharger</h2>
            {pending.length === 0 && (
              <p className="text-sm text-muted">Aucun camion à décharger.</p>
            )}
            <div className="overflow-hidden rounded-xl border border-border">
              {pending.map((p) => (
                <div
                  key={p.workdayId}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">
                      {warehouseLabel(p.truck)} · {p.user.name}
                    </span>
                    <span className="text-xs text-muted">Journée du {formatDate(p.date)}</span>
                  </span>
                  {can('unloads.validate') && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDone(null);
                        setCounting(p);
                      }}
                    >
                      Décharger
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      )}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Déchargements du"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </Card>
      {unloads && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          {unloads.length === 0 && <p className="text-sm text-muted">Aucun déchargement.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {unloads.map((u) => (
              <button
                key={u.id}
                onClick={() => setDetail(u)}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {warehouseLabel(u.truck)} · {u.user.name}
                  </span>
                  <span className="text-xs text-muted">
                    {u.validatedAt ? formatDateTime(u.validatedAt) : '—'}
                    {u.keepsStockInTruck ? ' · stock gardé dans le camion' : ''}
                  </span>
                </span>
                <Badge tone={u.hasGap ? 'warning' : 'success'}>
                  {u.hasGap ? 'Écart' : 'Sans écart'}
                </Badge>
              </button>
            ))}
          </div>
        </Card>
      )}
      {detail && (
        <Modal
          title={`Déchargement · ${warehouseLabel(detail.truck)}`}
          onClose={() => setDetail(null)}
        >
          <div className="overflow-hidden rounded-xl border border-border">
            {detail.lines.map((l) => (
              <div
                key={l.variantId}
                className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
              >
                <span className="text-text-dark">{articleLabel(l)}</span>
                <span className={l.gap === 0 ? 'text-muted' : 'font-semibold text-error'}>
                  {l.theoretical} → {l.counted}
                  {l.gap !== 0 ? ` (${signed(l.gap)})` : ''}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Comptage du camion : le compté part du théorique ; un écart demande un motif. */
function UnloadCount({
  pendingUnload,
  editable,
  onClose,
  onDone,
}: {
  pendingUnload: PendingUnloadDto;
  editable: boolean;
  onClose: () => void;
  onDone: (unload: UnloadDto) => void;
}) {
  const [lines, setLines] = useState<UnloadPreviewLine[] | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasonOf, setReasonOf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<UnloadPreviewLine[]>('company', `/unloads/preview?workdayId=${pendingUnload.workdayId}`),
      api<Reason[]>('company', '/reasons'),
    ])
      .then(([preview, all]) => {
        setLines(preview);
        setCounted(Object.fromEntries(preview.map((l) => [l.variantId, String(l.theoretical)])));
        setReasons(all.filter((r) => r.kind === 'ADJUSTMENT' && r.isActive));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [pendingUnload.workdayId]);

  const gapOf = (l: UnloadPreviewLine) => {
    const value = counted[l.variantId] ?? '';
    return value === '' ? null : Number(value) - l.theoretical;
  };

  async function submit() {
    if (!lines) return;
    setError(null);
    const body = lines.map((l) => ({
      variantId: l.variantId,
      countedQty: Number(counted[l.variantId] ?? ''),
      reasonId: gapOf(l) ? reasonOf[l.variantId] || undefined : undefined,
    }));
    if (
      body.some(
        (b) => counted[b.variantId] === '' || !Number.isInteger(b.countedQty) || b.countedQty < 0,
      )
    )
      return setError('Comptez chaque article : quantités entières positives.');
    if (lines.some((l) => gapOf(l) && !reasonOf[l.variantId]))
      return setError('Choisissez le motif de chaque écart.');
    setBusy(true);
    try {
      onDone(
        await api<UnloadDto>('company', '/unloads', {
          method: 'POST',
          body: JSON.stringify({ workdayId: pendingUnload.workdayId, lines: body }),
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
          {warehouseLabel(pendingUnload.truck)} · {pendingUnload.user.name}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
      <p className="text-sm text-muted">
        Journée du {formatDate(pendingUnload.date)} · quantités en unité de base. Théorique = chargé
        − livré − offert.
      </p>
      {lines && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Article</th>
                <th className="py-2 pr-3 font-medium">Chargé</th>
                <th className="py-2 pr-3 font-medium">Livré</th>
                <th className="py-2 pr-3 font-medium">Théorique</th>
                <th className="py-2 pr-3 font-medium">Compté</th>
                <th className="py-2 pr-3 font-medium">Écart</th>
                <th className="py-2 pr-3 font-medium">Motif</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const gap = gapOf(l);
                return (
                  <tr key={l.variantId} className="border-t border-border">
                    <td className="py-1.5 pr-3 text-text-dark">{articleLabel(l)}</td>
                    <td className="py-1.5 pr-3">{l.loaded}</td>
                    <td className="py-1.5 pr-3">{l.delivered}</td>
                    <td className="py-1.5 pr-3">{l.theoretical}</td>
                    <td className="py-1.5 pr-3">
                      <input
                        aria-label={`Compté pour ${articleLabel(l)}`}
                        inputMode="numeric"
                        disabled={!editable}
                        value={counted[l.variantId] ?? ''}
                        onChange={(e) =>
                          setCounted((c) => ({ ...c, [l.variantId]: e.target.value }))
                        }
                        className="w-24 rounded-md border border-border px-2 py-1.5 text-right outline-none focus:border-deep-blue disabled:bg-surface"
                      />
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-semibold ${
                        !gap ? 'text-muted' : gap > 0 ? 'text-synced' : 'text-error'
                      }`}
                    >
                      {gap === null ? '—' : signed(gap)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {gap ? (
                        <select
                          aria-label={`Motif de l'écart pour ${articleLabel(l)}`}
                          value={reasonOf[l.variantId] ?? ''}
                          disabled={!editable}
                          onChange={(e) =>
                            setReasonOf((r) => ({ ...r, [l.variantId]: e.target.value }))
                          }
                          className="rounded-md border border-border bg-white px-2 py-1.5 outline-none focus:border-deep-blue disabled:bg-surface"
                        >
                          <option value="">Choisir…</option>
                          {reasons.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !lines}>
            Valider le déchargement
          </Button>
        </div>
      )}
    </Card>
  );
}
