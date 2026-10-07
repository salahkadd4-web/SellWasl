'use client';

import type { LotDto, PendingUnloadDto, UnloadDto, UnloadPreviewLine } from '@sellwasl/validation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle } from '@/components/ui';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import {
  articleLabel,
  CONDITION_LABELS,
  formatDA,
  formatDate,
  formatDateTime,
  todayDate,
} from '@/lib/labels';
import { warehouseLabel } from '@/lib/stock';

interface Reason {
  id: string;
  kind: string;
  label: string;
  isActive: boolean;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** États hors stock d'un article compté (phase 21) ; le reste est remis en stock. */
const LOSSES = ['DEFECTIVE', 'EXPIRED', 'BROKEN'] as const;
type Loss = (typeof LOSSES)[number];
interface Split {
  qty: Record<Loss, string>;
  lotId: string;
  photoKey: string | null;
}
const emptySplit = (): Split => ({
  qty: { DEFECTIVE: '', EXPIRED: '', BROKEN: '' },
  lotId: '',
  photoKey: null,
});
const lossOf = (s: Split | undefined) =>
  s ? LOSSES.reduce((sum, c) => sum + (Number(s.qty[c]) || 0), 0) : 0;

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
          <p className="mb-2 text-sm text-muted">
            Contrôlé par {detail.validatedBy ?? '—'} le {formatDateTime(detail.validatedAt)} · écart
            total {formatDA(detail.lines.reduce((sum, l) => sum + l.gapValue, 0))}
          </p>
          <div className="overflow-hidden rounded-xl border border-border">
            {detail.lines.map((l) => (
              <div
                key={l.variantId}
                className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
              >
                <span className="text-text-dark">
                  {articleLabel(l)}
                  {l.conditions
                    .filter((c) => c.condition !== 'RESTOCK')
                    .map((c) => (
                      <span key={c.condition} className="block text-xs text-muted">
                        {CONDITION_LABELS[c.condition]} : {c.qty}
                        {c.lot ? ` · lot ${c.lot}` : ''}
                        {c.photoUrl && (
                          <>
                            {' · '}
                            <a
                              href={c.photoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-deep-blue"
                            >
                              photo
                            </a>
                          </>
                        )}
                      </span>
                    ))}
                </span>
                <span className={l.gap === 0 ? 'text-muted' : 'font-semibold text-error'}>
                  {l.theoretical} → {l.counted}
                  {l.gap !== 0 ? ` (${signed(l.gap)} · ${formatDA(l.gapValue)})` : ''}
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
  const [split, setSplit] = useState<Record<string, Split>>({});
  const [open, setOpen] = useState<string | null>(null);
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
    // Répartition par état : le reste du compté est remis en stock
    const conditions = [];
    for (const l of lines) {
      const s = split[l.variantId];
      const loss = lossOf(s);
      if (!s || loss === 0) continue;
      const total = Number(counted[l.variantId] ?? '');
      if (loss > total) return setError(`${articleLabel(l)} : la répartition dépasse le compté.`);
      if (Number(s.qty.DEFECTIVE) > 0 && !s.photoKey)
        return setError(`${articleLabel(l)} : ajoutez la photo du produit défectueux.`);
      if (total > loss)
        conditions.push({ variantId: l.variantId, condition: 'RESTOCK', qty: total - loss });
      for (const c of LOSSES) {
        const qty = Number(s.qty[c]) || 0;
        if (qty > 0)
          conditions.push({
            variantId: l.variantId,
            condition: c,
            qty,
            ...(s.lotId && { lotId: s.lotId }),
            ...(c === 'DEFECTIVE' && s.photoKey && { photoKey: s.photoKey }),
          });
      }
    }
    setBusy(true);
    try {
      onDone(
        await api<UnloadDto>('company', '/unloads', {
          method: 'POST',
          headers: idempotencyKey(`unload:${pendingUnload.workdayId}`),
          body: JSON.stringify({ workdayId: pendingUnload.workdayId, lines: body, conditions }),
        }),
      );
      idempotencyDone(`unload:${pendingUnload.workdayId}`);
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
                <th className="py-2 pr-3 font-medium">État</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const gap = gapOf(l);
                const loss = lossOf(split[l.variantId]);
                return (
                  <Fragment key={l.variantId}>
                    <tr className="border-t border-border">
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
                        {gap ? (
                          <span className="block text-xs font-normal">
                            {formatDA(gap * l.unitValue)}
                          </span>
                        ) : null}
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
                      <td className="py-1.5 pr-3">
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => setOpen(open === l.variantId ? null : l.variantId)}
                          className="text-sm font-semibold text-deep-blue disabled:text-muted"
                        >
                          {loss > 0 ? `${loss} hors stock` : 'Répartir'}
                        </button>
                      </td>
                    </tr>
                    {open === l.variantId && (
                      <tr>
                        <td colSpan={8} className="pb-3">
                          <ConditionEditor
                            line={l}
                            value={split[l.variantId] ?? emptySplit()}
                            onChange={(s) => setSplit((x) => ({ ...x, [l.variantId]: s }))}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

/**
 * Répartition d'un article compté par état constaté (phase 21) : défectueux (avec photo), périmé,
 * cassé ; le reste est remis en stock. Le lot est facultatif.
 */
function ConditionEditor({
  line,
  value,
  onChange,
}: {
  line: UnloadPreviewLine;
  value: Split;
  onChange: (value: Split) => void;
}) {
  const [lots, setLots] = useState<LotDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LotDto[]>('company', `/lots?variantId=${line.variantId}`)
      .then(setLots)
      .catch(() => setLots([]));
  }, [line.variantId]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const saved = await api<{ key: string }>('company', '/unloads/photos', {
        method: 'POST',
        body: form,
      });
      onChange({ ...value, photoKey: saved.key });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
      <p className="text-sm text-muted">
        {articleLabel(line)} : quantités hors stock, en unité de base. Elles sortent du stock en
        perte ; le reste du compté est remis en stock.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        {LOSSES.map((c) => (
          <Field
            key={c}
            label={CONDITION_LABELS[c]!}
            type="number"
            min={0}
            value={value.qty[c]}
            onChange={(e) => onChange({ ...value, qty: { ...value.qty, [c]: e.target.value } })}
          />
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-dark">Lot</span>
          <select
            value={value.lotId}
            onChange={(e) => onChange({ ...value, lotId: e.target.value })}
            className="min-h-11 rounded-lg border border-border bg-white px-3 text-text-dark outline-none focus:border-deep-blue focus:ring-2 focus:ring-deep-blue/20"
          >
            <option value="">Non précisé</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.number}
                {l.expiresAt ? ` · ${formatDate(l.expiresAt)}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {Number(value.qty.DEFECTIVE) > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-dark">
            Photo du produit défectueux {value.photoKey ? '· envoyée' : '(obligatoire)'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => void upload(e.target.files?.[0])}
            className="text-sm"
          />
        </label>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
