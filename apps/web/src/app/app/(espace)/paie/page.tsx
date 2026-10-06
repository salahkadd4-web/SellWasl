'use client';

import type { PayrollEntryDto, PayrollPeriodDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Stat } from '@/components/analytics';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import {
  formatDA,
  formatDate,
  formatDateTime,
  formatMonth,
  PAY_LINE_KIND,
  PAYROLL_STATUS,
} from '@/lib/labels';
import { currentMonth, useEmployees } from '@/lib/payroll';

/**
 * Paie mensuelle (phase 21 bis) : calcul par le serveur (salaire, primes, objectifs, ajustements,
 * acomptes, retenues), approbation, paiement des échéances, clôture. Chaque ligne garde sa source.
 */
export default function PayrollPage() {
  const { can } = CompanyAuth.useAuth();
  const manage = can('payroll.manage');
  const [periods, setPeriods] = useState<PayrollPeriodDto[] | null>(null);
  const [selected, setSelected] = useState<PayrollPeriodDto | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [open, setOpen] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (keep?: string) => {
    try {
      const list = await api<PayrollPeriodDto[]>('company', '/payroll/periods');
      setPeriods(list);
      const id = keep ?? list[0]?.id;
      setSelected(id ? await api<PayrollPeriodDto>('company', `/payroll/periods/${id}`) : null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(path: string, question: string | null, body?: object) {
    if (question && !confirm(question)) return;
    setError(null);
    setBusy(true);
    try {
      const period = await api<PayrollPeriodDto>('company', path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      await load(period.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const status = selected ? PAYROLL_STATUS[selected.status]! : null;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Paie"
        subtitle="Calculée par le serveur ; chaque montant remonte à sa source."
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Select
          label="Paie"
          value={selected?.id ?? ''}
          onChange={(e) => void load(e.target.value)}
          options={(periods ?? []).map((p) => ({
            value: p.id,
            label: `${formatMonth(p.month)} · ${PAYROLL_STATUS[p.status]!.label}`,
          }))}
        />
        {manage && (
          <>
            <Field
              label="Nouveau mois"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
            <Button disabled={busy} onClick={() => void run('/payroll/periods', null, { month })}>
              Créer la paie
            </Button>
          </>
        )}
      </Card>
      {periods?.length === 0 && (
        <p className="text-sm text-muted">Aucune paie : créez celle du mois.</p>
      )}

      {selected && status && (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-text-dark">
                {formatMonth(selected.month)} <Badge tone={status.tone}>{status.label}</Badge>
              </h2>
              {manage && (
                <span className="flex flex-wrap gap-2">
                  {(selected.status === 'OPEN' || selected.status === 'CALCULATED') && (
                    <>
                      <Button variant="secondary" onClick={() => setAdjusting(true)}>
                        Ajustement
                      </Button>
                      <Button
                        disabled={busy}
                        variant="secondary"
                        onClick={() => void run(`/payroll/periods/${selected.id}/calculate`, null)}
                      >
                        {selected.status === 'OPEN' ? 'Calculer' : 'Recalculer'}
                      </Button>
                    </>
                  )}
                  {selected.status === 'CALCULATED' && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          `/payroll/periods/${selected.id}/approve`,
                          `Approuver la paie de ${formatMonth(selected.month)} (${formatDA(selected.totals.net)}) ? Elle ne pourra plus être recalculée.`,
                        )
                      }
                    >
                      Approuver
                    </Button>
                  )}
                  {selected.status === 'PAID' && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          `/payroll/periods/${selected.id}/close`,
                          'Clôturer la paie ? Plus aucune modification ne sera possible.',
                        )
                      }
                    >
                      Clôturer
                    </Button>
                  )}
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Employés" value={selected.totals.employees} />
              <Stat label="Salaires" value={formatDA(selected.totals.baseSalary)} />
              <Stat label="Primes et objectifs" value={formatDA(selected.totals.earnings)} />
              <Stat label="Acomptes" value={formatDA(selected.totals.advances)} />
              <Stat label="Retenues" value={formatDA(selected.totals.deductions)} />
              <Stat
                label="Net à payer"
                value={formatDA(selected.totals.net)}
                hint={`Payé : ${formatDA(selected.totals.paid)}`}
              />
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            {selected.entries.length === 0 && (
              <p className="text-sm text-muted">
                {selected.status === 'OPEN'
                  ? 'Calculez la paie pour voir les fiches.'
                  : 'Aucun employé rémunéré ce mois-là.'}
              </p>
            )}
            {selected.entries.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border">
                {selected.entries.map((e) => (
                  <Entry
                    key={e.id}
                    entry={e}
                    open={open === e.id}
                    onToggle={() => setOpen(open === e.id ? null : e.id)}
                    canPay={manage && selected.status === 'APPROVED'}
                    busy={busy}
                    onPay={(paymentId, amount) =>
                      void run(
                        `/payroll/payments/${paymentId}/pay`,
                        `Enregistrer le paiement de ${formatDA(amount)} à ${e.user.name} ?`,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
      {adjusting && selected && (
        <AdjustmentForm
          month={selected.month}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            void run(`/payroll/periods/${selected.id}/calculate`, null);
          }}
        />
      )}
    </div>
  );
}

function Entry({
  entry,
  open,
  onToggle,
  canPay,
  busy,
  onPay,
}: {
  entry: PayrollEntryDto;
  open: boolean;
  onToggle: () => void;
  canPay: boolean;
  busy: boolean;
  onPay: (paymentId: string, amount: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-col gap-1 text-left lg:flex-row lg:items-center lg:justify-between"
      >
        <span className="flex flex-col">
          <span className="font-medium text-text-dark">
            {entry.user.name}{' '}
            <span className="font-mono text-xs text-muted">{entry.user.code}</span>
          </span>
          <span className="text-xs text-muted">
            {entry.user.role} · salaire {formatDA(entry.baseSalary)} · gains{' '}
            {formatDA(entry.earnings)} · acomptes {formatDA(entry.advances)} · retenues{' '}
            {formatDA(entry.deductions)}
          </span>
        </span>
        <span className="text-base font-bold text-primary">{formatDA(entry.net)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface px-3 py-2">
          <table className="w-full text-left text-sm">
            <tbody>
              {entry.lines.map((l) => (
                <tr key={l.id} className="border-t border-border first:border-0">
                  <td className="py-1 pr-3 text-muted">{PAY_LINE_KIND[l.kind]}</td>
                  <td className="py-1 pr-3 text-text-dark">{l.label}</td>
                  <td
                    className={`py-1 text-right font-medium ${l.amount < 0 ? 'text-error' : 'text-text-dark'}`}
                  >
                    {formatDA(l.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <td className="py-1 pr-3" colSpan={2}>
                  Net à payer
                </td>
                <td className="py-1 text-right">{formatDA(entry.net)}</td>
              </tr>
            </tbody>
          </table>
          {entry.payments.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-text-dark">Échéances</p>
              {entry.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {formatDate(p.dueDate)} · {p.percent} % · {formatDA(p.amount)}
                  </span>
                  {p.paidAt ? (
                    <Badge tone="success">
                      Payée le {formatDateTime(p.paidAt)}
                      {p.paidBy ? ` par ${p.paidBy}` : ''}
                    </Badge>
                  ) : canPay ? (
                    <Button disabled={busy} onClick={() => onPay(p.id, p.amount)}>
                      Enregistrer le paiement
                    </Button>
                  ) : (
                    <Badge tone="warning">À payer</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdjustmentForm({
  month,
  onClose,
  onDone,
}: {
  month: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const employees = useEmployees().filter((e) => e.current);
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = Number(amount);
    if (!userId) return setError("Choisissez l'employé.");
    if (!Number.isInteger(value) || value === 0)
      return setError('Montant entier, positif (gain) ou négatif (déduction).');
    if (reason.trim().length < 3) return setError('Indiquez le motif.');
    setError(null);
    setBusy(true);
    try {
      await api('company', '/payroll/adjustments', {
        method: 'POST',
        body: JSON.stringify({ userId, month, amount: value, reason: reason.trim() }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ajustement · ${formatMonth(month)}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Select
          label="Employé"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[
            { value: '', label: 'Choisir…' },
            ...employees.map((e) => ({
              value: e.user.id,
              label: `${e.user.name} (${e.user.code})`,
            })),
          ]}
        />
        <Field
          label="Montant (DA)"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="Positif : gain ; négatif : déduction. La paie est recalculée."
        />
        <Field label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Ajouter
          </Button>
        </div>
      </div>
    </Modal>
  );
}
