'use client';

import type { IncentiveProgressDto, MyPayDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Field, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import {
  ADVANCE_STATUS,
  DEDUCTION_STATUS,
  formatDA,
  formatDate,
  formatMonth,
  INCENTIVE_STATUS,
  PAY_LINE_KIND,
  PAYROLL_STATUS,
} from '@/lib/labels';
import { currentMonth } from '@/lib/payroll';

/** Ma paie (phase 21 bis) : rémunération, primes, acomptes, retenues et fiche du mois, à moi seul. */
export default function MyPayPage() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<MyPayDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<IncentiveProgressDto[]>([]);

  useEffect(() => {
    api<IncentiveProgressDto[]>('company', '/me/incentives/progress')
      .then(setProgress)
      .catch(() => setProgress([]));
  }, []);

  useEffect(() => {
    setError(null);
    api<MyPayDto>('company', `/me/pay?month=${month}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [month]);

  const current = data?.compensation.find((c) => !c.effectiveTo) ?? data?.compensation[0];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Ma paie"
        subtitle={
          current ? `Salaire en vigueur : ${formatDA(current.baseSalary)} par mois.` : undefined
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <Field
          label="Mois"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </Card>
      {progress.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text-dark">En cours</h2>
          <p className="text-sm text-muted">
            Estimation sur les ventes livrées à ce jour ; la prime est calculée chaque nuit puis
            validée par le comptable.
          </p>
          {progress.map((p) => (
            <p
              key={`${p.rule.id}-${p.periodStart}`}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {p.rule.name} · {p.rule.frequency === 'WEEKLY' ? 'semaine' : 'mois'} du{' '}
                {formatDate(p.periodStart)} au {formatDate(p.periodEnd)} · {p.quantity}{' '}
                {p.unitName ?? ''}
              </span>
              <span className="font-semibold text-text-dark">{formatDA(p.estimatedAmount)}</span>
            </p>
          ))}
        </Card>
      )}
      {data && (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text-dark">
              Fiche de {formatMonth(month)}{' '}
              {data.entry && (
                <Badge tone={PAYROLL_STATUS[data.entry.status]!.tone}>
                  {PAYROLL_STATUS[data.entry.status]!.label}
                </Badge>
              )}
            </h2>
            {!data.entry && (
              <p className="text-sm text-muted">La paie de ce mois n'est pas encore calculée.</p>
            )}
            {data.entry && (
              <table className="w-full text-left text-sm">
                <tbody>
                  {data.entry.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border first:border-0">
                      <td className="py-1 pr-3 text-muted">{PAY_LINE_KIND[l.kind]}</td>
                      <td className="py-1 pr-3 text-text-dark">{l.label}</td>
                      <td className={`py-1 text-right ${l.amount < 0 ? 'text-error' : ''}`}>
                        {formatDA(l.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1" colSpan={2}>
                      Net à payer
                    </td>
                    <td className="py-1 text-right">{formatDA(data.entry.net)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {data.entry?.payments.map((p) => (
              <p key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Échéance du {formatDate(p.dueDate)} : {formatDA(p.amount)}
                </span>
                <Badge tone={p.paidAt ? 'success' : 'warning'}>
                  {p.paidAt ? 'Payée' : 'À venir'}
                </Badge>
              </p>
            ))}
          </Card>
          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-text-dark">Mes primes</h2>
            {data.incentives.length === 0 && (
              <p className="text-sm text-muted">Aucune prime ce mois-là.</p>
            )}
            {data.incentives.map((i) => (
              <p key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {i.rule.name} · du {formatDate(i.periodStart)} au {formatDate(i.periodEnd)} ·{' '}
                  {i.quantity} {i.unitName ?? ''}
                </span>
                <span className="flex items-center gap-2">
                  {formatDA(i.amount)}{' '}
                  <Badge tone={INCENTIVE_STATUS[i.status]!.tone}>
                    {INCENTIVE_STATUS[i.status]!.label}
                  </Badge>
                </span>
              </p>
            ))}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-text-dark">Mes acomptes</h2>
              {data.advances.length === 0 && <p className="text-sm text-muted">Aucun acompte.</p>}
              {data.advances.map((a) => (
                <p key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{formatDA(a.amount)}</span>
                  <Badge tone={ADVANCE_STATUS[a.status]!.tone}>
                    {ADVANCE_STATUS[a.status]!.label}
                  </Badge>
                </p>
              ))}
            </Card>
            <Card className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-text-dark">Mes retenues</h2>
              {data.deductions.length === 0 && (
                <p className="text-sm text-muted">Aucune retenue.</p>
              )}
              {data.deductions.map((d) => (
                <p key={d.id} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span>{formatDA(d.amount)}</span>
                    <Badge tone={DEDUCTION_STATUS[d.status]!.tone}>
                      {DEDUCTION_STATUS[d.status]!.label}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted">{d.reason}</span>
                </p>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
