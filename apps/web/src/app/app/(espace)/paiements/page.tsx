'use client';

import type { DebtorDto, PaymentRowDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, PageTitle } from '@/components/ui';
import { api, errorMessage, getAccessToken } from '@/lib/api';
import { formatDA, formatDateTime, todayDate } from '@/lib/labels';

/** Dettes des clients et paiements d'une période, avec export CSV (UC-71). */
export default function PaymentsPage() {
  const [from, setFrom] = useState(() => `${todayDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayDate);
  const [debtors, setDebtors] = useState<DebtorDto[] | null>(null);
  const [payments, setPayments] = useState<PaymentRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DebtorDto[]>('company', '/debtors')
      .then(setDebtors)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPayments(await api<PaymentRowDto[]>('company', `/payments?from=${from}&to=${to}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    // L'export demande une session : téléchargement par l'API, puis enregistrement local
    const response = await fetch(`/api/v1/payments/export?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${getAccessToken('company') ?? ''}` },
    });
    if (!response.ok) return setError('Export impossible.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `paiements-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalDebt = debtors?.reduce((sum, d) => sum + d.debtAmount, 0) ?? 0;
  const cash = payments?.reduce((sum, p) => sum + p.cashAmount, 0) ?? 0;
  const credit = payments?.reduce((sum, p) => sum + p.creditAmount, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Dettes et paiements"
        subtitle="Ce que les clients doivent, et ce qui a été encaissé sur la période."
        action={
          <Button variant="secondary" onClick={() => void exportCsv()}>
            Exporter en CSV
          </Button>
        }
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Du"
          type="date"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <Field
          label="Au"
          type="date"
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </Card>

      {debtors && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">
            Clients endettés · {formatDA(totalDebt)}
          </h2>
          {debtors.length === 0 && <p className="text-sm text-muted">Aucun client endetté.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {debtors.map((d) => (
              <div
                key={d.customer.id}
                className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">{d.customer.name}</span>
                  <span className="text-xs text-muted">
                    {d.customer.code ?? ''}
                    {d.isCreditAllowed
                      ? ` · plafond ${formatDA(d.creditLimitAmount)}`
                      : ' · sans crédit'}
                  </span>
                </span>
                <Badge
                  tone={
                    d.isCreditAllowed && d.debtAmount <= d.creditLimitAmount ? 'warning' : 'danger'
                  }
                >
                  {formatDA(d.debtAmount)}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {payments && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">
            Paiements · espèces {formatDA(cash)} · crédit {formatDA(credit)}
          </h2>
          {payments.length === 0 && <p className="text-sm text-muted">Aucun paiement.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {p.customer} <span className="font-mono text-xs text-muted">{p.number}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {formatDateTime(p.at)} · {p.user} ·{' '}
                    {p.kind === 'DEBT_PAYMENT' ? 'dette' : `dû ${formatDA(p.dueAmount)}`}
                  </span>
                </span>
                <span className="text-sm text-text-dark">
                  {formatDA(p.cashAmount)}
                  {p.creditAmount > 0 ? ` · crédit ${formatDA(p.creditAmount)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
