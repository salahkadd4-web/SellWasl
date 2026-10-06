'use client';

import type { PayrollDashboardDto } from '@sellwasl/validation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Stat } from '@/components/analytics';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDA, formatMonth, PAYROLL_STATUS } from '@/lib/labels';
import { currentMonth } from '@/lib/payroll';

/** Paie du mois sur l'accueil (comptable, administrateur) : masse salariale et éléments en attente. */
export function PayrollSummary() {
  const [data, setData] = useState<PayrollDashboardDto | null>(null);

  useEffect(() => {
    api<PayrollDashboardDto>('company', `/payroll/dashboard?month=${currentMonth()}`)
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return null;
  const pending = data.pending;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-dark">
          Paie de {formatMonth(data.month)}
          {data.payrollStatus ? ` · ${PAYROLL_STATUS[data.payrollStatus]!.label}` : ''}
        </h2>
        <Link href="/app/paie" className="text-sm font-semibold text-deep-blue">
          Paie →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Employés rémunérés" value={data.employees} />
        <Stat label="Salaires" value={formatDA(data.baseSalary)} />
        <Stat label="Primes validées" value={formatDA(data.incentivesValidated)} />
        <Stat label="Acomptes payés" value={formatDA(data.advancesPaid)} />
        <Stat label="Retenues approuvées" value={formatDA(data.deductionsApproved)} />
        <Stat label="Net à payer" value={data.net === null ? 'Non calculé' : formatDA(data.net)} />
      </div>
      {pending.advances + pending.deductions + pending.incentives + pending.discrepancies > 0 && (
        <p className="text-sm text-muted">
          En attente : {pending.discrepancies} écart(s) à analyser · {pending.deductions} retenue(s)
          · {pending.advances} acompte(s) · {pending.incentives} prime(s) à vérifier.
        </p>
      )}
    </Card>
  );
}
