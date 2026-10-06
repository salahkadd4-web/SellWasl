'use client';

import type { CompensationDto, CurrentCompensationDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, todayDate } from '@/lib/labels';

/**
 * Rémunérations (phase 21 bis) : salaire en vigueur de chaque employé ; un nouveau salaire prend
 * effet à une date et ferme le précédent, l'historique reste.
 */
export default function CompensationsPage() {
  const { can } = CompanyAuth.useAuth();
  const [rows, setRows] = useState<CurrentCompensationDto[] | null>(null);
  const [selected, setSelected] = useState<CurrentCompensationDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<CurrentCompensationDto[]>('company', '/compensations/current'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const payroll =
    rows?.filter((r) => r.current).reduce((s, r) => s + r.current!.baseSalary, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Rémunérations"
        subtitle={rows ? `Masse salariale en vigueur : ${formatDA(payroll)} par mois.` : undefined}
      />
      {error && <Alert>{error}</Alert>}
      {rows && (
        <Card>
          <div className="overflow-hidden rounded-xl border border-border">
            {rows.map((r) => (
              <button
                key={r.user.id}
                type="button"
                onClick={() => setSelected(r)}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {r.user.name}{' '}
                    <span className="font-mono text-xs text-muted">{r.user.code}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {r.user.role}
                    {r.current ? ` · depuis le ${formatDate(r.current.effectiveFrom)}` : ''}
                  </span>
                </span>
                {r.current ? (
                  <span className="font-semibold text-text-dark">
                    {formatDA(r.current.baseSalary)} / mois
                  </span>
                ) : (
                  <Badge>Pas de rémunération</Badge>
                )}
              </button>
            ))}
          </div>
        </Card>
      )}
      {selected && (
        <History
          employee={selected}
          editable={can('compensation.update')}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function History({
  employee,
  editable,
  onClose,
  onChanged,
}: {
  employee: CurrentCompensationDto;
  editable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<CompensationDto[] | null>(null);
  const [salary, setSalary] = useState('');
  const [from, setFrom] = useState(todayDate);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHistory(
      await api<CompensationDto[]>('company', `/compensations?userId=${employee.user.id}`),
    );
  }, [employee.user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    const value = Number(salary);
    if (!Number.isInteger(value) || value < 0)
      return setError('Salaire mensuel en dinars entiers.');
    if (
      !confirm(
        `Fixer le salaire de ${employee.user.name} à ${formatDA(value)} à partir du ${formatDate(from)} ?`,
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      await api('company', '/compensations', {
        method: 'POST',
        body: JSON.stringify({
          userId: employee.user.id,
          baseSalary: value,
          effectiveFrom: from,
          note: note.trim() || undefined,
        }),
      });
      setSalary('');
      setNote('');
      await load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Rémunération · ${employee.user.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {history?.length === 0 && (
          <p className="text-sm text-muted">Aucune rémunération enregistrée.</p>
        )}
        {history && history.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
              >
                <span>
                  Du {formatDate(h.effectiveFrom)}{' '}
                  {h.effectiveTo ? `au ${formatDate(h.effectiveTo)}` : '· en vigueur'}
                  {h.note && <span className="block text-xs text-muted">{h.note}</span>}
                </span>
                <span className="font-semibold text-text-dark">{formatDA(h.baseSalary)}</span>
              </div>
            ))}
          </div>
        )}
        {editable && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="font-semibold text-text-dark">Nouveau salaire</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Salaire mensuel (DA)"
                type="number"
                min={0}
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
              <Field
                label="À partir du"
                type="date"
                value={from}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
            </div>
            <Field
              label="Note (facultatif)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error && <Alert>{error}</Alert>}
            <Button disabled={busy} onClick={() => void submit()}>
              Enregistrer
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
