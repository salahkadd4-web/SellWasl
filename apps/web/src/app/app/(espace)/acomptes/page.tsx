'use client';

import type { AdvanceDto, PayrollSettings } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { idempotencyDone, idempotencyKey } from '@/lib/idempotency';
import { ADVANCE_STATUS, formatDA, formatDateTime, formatMonth } from '@/lib/labels';
import { currentMonth, useEmployees } from '@/lib/payroll';

/**
 * Acomptes (phase 21 bis) : demande, approbation dans le plafond du salaire, paiement, puis
 * déduction à la paie du mois. Désactivés : l'historique reste visible.
 */
export default function AdvancesPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<AdvanceDto[] | null>(null);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api<AdvanceDto[]>('company', `/advances?month=${month}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [month]);

  useEffect(() => {
    void load();
    api<PayrollSettings>('company', '/payroll/settings')
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [load]);

  async function act(a: AdvanceDto, action: 'approve' | 'reject' | 'pay') {
    const question = {
      approve: `Approuver l'acompte de ${formatDA(a.amount)} pour ${a.user.name} ?`,
      reject: `Refuser l'acompte de ${formatDA(a.amount)} ?`,
      pay: `Enregistrer le paiement de ${formatDA(a.amount)} à ${a.user.name} ?`,
    }[action];
    if (!confirm(question)) return;
    setError(null);
    setBusy(a.id);
    try {
      await api('company', `/advances/${a.id}/${action}`, {
        method: 'POST',
        headers: idempotencyKey(`advance:${a.id}:${action}`),
        body: '{}',
      });
      idempotencyDone(`advance:${a.id}:${action}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const enabled = !!settings?.enabled && !!settings.advancesEnabled;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Acomptes"
        subtitle={
          settings
            ? enabled
              ? `Plafond : ${settings.advanceMaxPercent} % du salaire du mois.`
              : 'Les acomptes sont désactivés dans les paramètres : historique seulement.'
            : undefined
        }
        action={enabled && <Button onClick={() => setCreating(true)}>Nouvel acompte</Button>}
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      <Card>
        <Field
          label="Mois de paie"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </Card>
      {rows && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">
            {formatMonth(month)} ·{' '}
            {formatDA(
              rows
                .filter((a) => ['PAID', 'DEDUCTED'].includes(a.status))
                .reduce((s, a) => s + a.amount, 0),
            )}{' '}
            payés
          </h2>
          {rows.length === 0 && <p className="text-sm text-muted">Aucun acompte ce mois-là.</p>}
          {rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {rows.map((a) => {
                const s = ADVANCE_STATUS[a.status]!;
                return (
                  <div
                    key={a.id}
                    className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-text-dark">
                        {a.user.name}{' '}
                        <span className="font-mono text-xs text-muted">{a.user.code}</span>
                      </span>
                      <span className="text-xs text-muted">
                        Demandé le {formatDateTime(a.requestedAt)}
                        {a.reason ? ` · ${a.reason}` : ''}
                        {a.decidedBy ? ` · décidé par ${a.decidedBy}` : ''}
                        {a.paidAt ? ` · payé le ${formatDateTime(a.paidAt)}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text-dark">
                        {formatDA(a.amount)}
                      </span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {a.status === 'REQUESTED' && (
                        <Button disabled={busy === a.id} onClick={() => void act(a, 'approve')}>
                          Approuver
                        </Button>
                      )}
                      {a.status === 'APPROVED' && (
                        <Button disabled={busy === a.id} onClick={() => void act(a, 'pay')}>
                          Enregistrer le paiement
                        </Button>
                      )}
                      {(a.status === 'REQUESTED' || a.status === 'APPROVED') && (
                        <Button
                          variant="secondary"
                          disabled={busy === a.id}
                          onClick={() => void act(a, 'reject')}
                        >
                          Refuser
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      {creating && (
        <AdvanceForm
          month={month}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AdvanceForm({
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
  const salary = employees.find((e) => e.user.id === userId)?.current?.baseSalary;

  async function submit() {
    const value = Number(amount);
    if (!userId) return setError("Choisissez l'employé.");
    if (!Number.isInteger(value) || value < 1) return setError('Le montant doit être positif.');
    setError(null);
    setBusy(true);
    try {
      await api('company', '/advances', {
        method: 'POST',
        body: JSON.stringify({ userId, amount: value, month, reason: reason.trim() || undefined }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Nouvel acompte · ${formatMonth(month)}`} onClose={onClose}>
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
        {salary !== undefined && (
          <p className="text-sm text-muted">Salaire en vigueur : {formatDA(salary)}</p>
        )}
        <Field
          label="Montant (DA)"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field
          label="Motif (facultatif)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted">Le plafond est vérifié à l'approbation.</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Enregistrer la demande
          </Button>
        </div>
      </div>
    </Modal>
  );
}
