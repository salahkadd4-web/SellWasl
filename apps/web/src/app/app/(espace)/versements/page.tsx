'use client';

import type { SettlementDetailDto, SettlementRowDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { CompanyAuth } from '@/lib/auth';
import {
  DISCREPANCY_STATUS,
  formatDA,
  formatDate,
  formatDateTime,
  todayDate,
  WORKDAY_STATUS,
} from '@/lib/labels';

/**
 * Versements au comptable (UC-70, BR-PAY-08) : pour chaque journée où de l'argent a été encaissé,
 * le montant attendu, le montant remis et l'écart. Un seul versement par journée.
 */
export default function SettlementsPage() {
  const { can } = CompanyAuth.useAuth();
  const canSettle = can('settlements.create');
  const [date, setDate] = useState(todayDate);
  const [rows, setRows] = useState<SettlementRowDto[] | null>(null);
  const [remitted, setRemitted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<SettlementDetailDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api<SettlementRowDto[]>('company', `/settlements?date=${date}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function settle(row: SettlementRowDto) {
    const value = Number(remitted[row.workdayId] ?? '');
    if (!Number.isInteger(value) || value < 0)
      return setError('Saisissez le montant remis, en dinars entiers.');
    if (
      value !== row.expected &&
      !confirm(
        `Écart de ${formatDA(value - row.expected)} pour ${row.user.name}. Enregistrer le versement ?`,
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      await api('company', '/settlements', {
        method: 'POST',
        headers: idempotencyKey(`settlement:${row.workdayId}`),
        body: JSON.stringify({
          workdayId: row.workdayId,
          remittedAmount: value,
          note: notes[row.workdayId]?.trim() || undefined,
        }),
      });
      idempotencyDone(`settlement:${row.workdayId}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openSummary(row: SettlementRowDto) {
    setError(null);
    try {
      setSummary(await api<SettlementDetailDto>('company', `/settlements/${row.workdayId}/detail`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const gaps = rows?.filter((r) => r.gap !== null && r.gap !== 0) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Versements"
        subtitle="Argent remis par les vendeurs et les livreurs : attendu, remis, écart."
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Journée du"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        {gaps.length > 0 && (
          <p className="text-sm font-semibold text-error sm:self-end">
            {gaps.length} versement(s) avec écart ce jour-là.
          </p>
        )}
      </Card>
      {rows && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          {rows.length === 0 && (
            <p className="text-sm text-muted">Aucun encaissement ce jour-là.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border">
            {rows.map((r) => {
              const status = WORKDAY_STATUS[r.workdayStatus];
              return (
                <div
                  key={r.workdayId}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">
                      {r.user.name}{' '}
                      <span className="font-mono text-xs text-muted">{r.user.code}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {r.user.role} · attendu {formatDA(r.expected)}
                      {r.remitted !== null
                        ? ` · remis ${formatDA(r.remitted)} le ${formatDateTime(r.validatedAt)}`
                        : ''}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-end gap-2">
                    {status && <Badge tone={status.tone}>{status.label}</Badge>}
                    {r.gap !== null ? (
                      <Badge tone={r.gap === 0 ? 'success' : 'danger'}>
                        {r.gap === 0
                          ? 'Sans écart'
                          : `Écart ${r.gap > 0 ? '+' : ''}${formatDA(r.gap)}`}
                      </Badge>
                    ) : (
                      canSettle &&
                      r.workdayStatus === 'CLOSED' && (
                        <>
                          <Field
                            label="Montant remis (DA)"
                            type="number"
                            min={0}
                            value={remitted[r.workdayId] ?? ''}
                            onChange={(e) =>
                              setRemitted((m) => ({ ...m, [r.workdayId]: e.target.value }))
                            }
                          />
                          <Field
                            label="Justification (facultatif)"
                            value={notes[r.workdayId] ?? ''}
                            onChange={(e) =>
                              setNotes((m) => ({ ...m, [r.workdayId]: e.target.value }))
                            }
                          />
                          <Button disabled={busy} onClick={() => void settle(r)}>
                            Enregistrer
                          </Button>
                        </>
                      )
                    )}
                    <Button variant="secondary" onClick={() => void openSummary(r)}>
                      Détail
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {summary && (
        <Modal title={`Versement · ${summary.user.name}`} onClose={() => setSummary(null)}>
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted">{formatDate(summary.date)}</p>
            <p>Bons : {summary.receipts}</p>
            <p>Total livré ou vendu : {formatDA(summary.sales)}</p>
            <p>Espèces sur les livraisons et ventes : {formatDA(summary.cashSales)}</p>
            <p>Espèces sur les dettes : {formatDA(summary.cashDebts)}</p>
            <p>Crédits accordés : {formatDA(summary.credit)}</p>
            <p>Retours au déchargement : {formatDA(summary.returnedValue)}</p>
            <p className="font-semibold text-text-dark">
              Montant attendu : {formatDA(summary.expected)}
            </p>
            {summary.remitted !== null && (
              <p className="font-semibold text-text-dark">
                Remis : {formatDA(summary.remitted)} · écart{' '}
                <span className={summary.gap === 0 ? 'text-synced' : 'text-error'}>
                  {formatDA(summary.gap ?? 0)}
                </span>
              </p>
            )}
            {summary.note && <p className="text-muted">« {summary.note} »</p>}
            {(summary.stockDiscrepancies.length > 0 || summary.financialDiscrepancy) && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <p className="font-semibold text-text-dark">Écarts de la journée</p>
                {[
                  ...summary.stockDiscrepancies,
                  ...(summary.financialDiscrepancy ? [summary.financialDiscrepancy] : []),
                ].map((d) => (
                  <p key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {d.kind === 'STOCK' ? `${d.article} : ${d.qty}` : 'Caisse'} ·{' '}
                      {formatDA(d.amount)}
                      {d.cause ? ` · ${d.cause}` : ''}
                    </span>
                    <Badge tone={DISCREPANCY_STATUS[d.status]!.tone}>
                      {DISCREPANCY_STATUS[d.status]!.label}
                    </Badge>
                  </p>
                ))}
                <Link href="/app/ecarts" className="font-semibold text-deep-blue">
                  Analyser les écarts →
                </Link>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
