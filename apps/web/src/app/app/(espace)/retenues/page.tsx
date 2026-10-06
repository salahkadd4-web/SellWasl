'use client';

import type { DeductionDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import {
  DEDUCTION_SOURCE,
  DEDUCTION_STATUS,
  formatDA,
  formatDateTime,
  formatMonth,
} from '@/lib/labels';
import { useEmployees } from '@/lib/payroll';

/**
 * Retenues sur rémunération (phase 21 bis) : nées d'un écart ou saisies avec un motif, elles ne
 * s'appliquent qu'après approbation explicite, à la paie suivante.
 */
export default function DeductionsPage() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<DeductionDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(
        await api<DeductionDto[]>('company', `/deductions${status ? `?status=${status}` : ''}`),
      );
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(d: DeductionDto, action: 'approve' | 'reject') {
    if (
      !confirm(
        action === 'approve'
          ? `Approuver la retenue de ${formatDA(d.amount)} sur ${d.user.name} ?`
          : `Refuser la retenue de ${formatDA(d.amount)} ?`,
      )
    )
      return;
    setError(null);
    setBusy(d.id);
    try {
      await api('company', `/deductions/${d.id}/${action}`, { method: 'POST', body: '{}' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Retenues"
        subtitle="Montants retenus sur la paie, toujours approuvés avant d'être appliqués."
        action={<Button onClick={() => setCreating(true)}>Nouvelle retenue</Button>}
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      <Card>
        <Select
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: 'PENDING', label: 'À approuver' },
            { value: 'APPROVED', label: 'Approuvées' },
            { value: 'APPLIED', label: 'Appliquées' },
            { value: 'REJECTED', label: 'Refusées' },
            { value: '', label: 'Toutes' },
          ]}
        />
      </Card>
      {rows && (
        <Card className="flex flex-col gap-3">
          {rows.length === 0 && <p className="text-sm text-muted">Aucune retenue.</p>}
          {rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {rows.map((d) => {
                const s = DEDUCTION_STATUS[d.status]!;
                return (
                  <div
                    key={d.id}
                    className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-text-dark">
                        {d.user.name}{' '}
                        <span className="font-mono text-xs text-muted">{d.user.code}</span>
                      </span>
                      <span className="text-xs text-muted">
                        {DEDUCTION_SOURCE[d.sourceType]} · {d.reason}
                      </span>
                      <span className="text-xs text-muted">
                        {d.month ? `Paie de ${formatMonth(d.month)}` : 'Prochaine paie'} · créée le{' '}
                        {formatDateTime(d.createdAt)}
                        {d.approvedBy ? ` · décidée par ${d.approvedBy}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-error">{formatDA(d.amount)}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {d.status === 'PENDING' && (
                        <>
                          <Button
                            disabled={busy === d.id}
                            onClick={() => void decide(d, 'approve')}
                          >
                            Approuver
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy === d.id}
                            onClick={() => void decide(d, 'reject')}
                          >
                            Refuser
                          </Button>
                        </>
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
        <DeductionForm
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setStatus('PENDING');
            void load();
          }}
        />
      )}
    </div>
  );
}

function DeductionForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const employees = useEmployees().filter((e) => e.current);
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = Number(amount);
    if (!userId) return setError("Choisissez l'employé.");
    if (!Number.isInteger(value) || value < 1) return setError('Le montant doit être positif.');
    if (reason.trim().length < 3) return setError('Indiquez le motif.');
    setError(null);
    setBusy(true);
    try {
      await api('company', '/deductions', {
        method: 'POST',
        body: JSON.stringify({ userId, amount: value, reason: reason.trim() }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouvelle retenue" onClose={onClose}>
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
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Créer la retenue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
