'use client';

import type { DiscrepancyDto, Page } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { AccountingTabs } from '@/components/accounting-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { type Listed, ShowMore } from '@/components/show-more';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { DISCREPANCY_STATUS, formatDA, formatDate, formatDateTime } from '@/lib/labels';

type Decision = 'NO_LIABILITY' | 'REJECT' | 'LIABILITY';
const OPEN = ['VALIDATED', 'UNDER_REVIEW'];

/**
 * Écarts de stock et de caisse (phase 21 bis) : constatés au déchargement ou au versement, le
 * comptable les analyse et décide ; une responsabilité confirmée crée une retenue à approuver.
 */
export default function DiscrepanciesPage() {
  const { can } = CompanyAuth.useAuth();
  const canDecide = can('discrepancies.decide');
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [list, setList] = useState<Listed<DiscrepancyDto> | null>(null);
  const rows = list?.page.data ?? null;
  const [deciding, setDeciding] = useState<DiscrepancyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status === 'OPEN') params.set('status', 'OPEN');
      if (kind) params.set('kind', kind);
      const path = `/discrepancies?${params}`;
      setList({ path, page: await api<Page<DiscrepancyDto>>('company', path) });
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(d: DiscrepancyDto) {
    setError(null);
    try {
      await api('company', `/discrepancies/${d.id}/review`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Écarts"
        subtitle="Manques et surplus constatés au retour des camions et aux versements."
      />
      <AccountingTabs />
      {error && <Alert>{error}</Alert>}
      {info && (
        <p className="rounded-lg border border-synced/30 bg-synced/10 px-3 py-2 text-sm text-synced">
          {info}
        </p>
      )}
      <Card className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: 'OPEN', label: 'À analyser' },
            { value: 'ALL', label: 'Tous' },
          ]}
        />
        <Select
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={[
            { value: '', label: 'Stock et caisse' },
            { value: 'STOCK', label: 'Stock' },
            { value: 'FINANCIAL', label: 'Caisse' },
          ]}
        />
      </Card>
      {rows && (
        <Card className="flex flex-col gap-3">
          {rows.length === 0 && <p className="text-sm text-muted">Aucun écart.</p>}
          {rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {rows.map((d) => {
                const s = DISCREPANCY_STATUS[d.status]!;
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
                        {formatDate(d.date)} ·{' '}
                        {d.kind === 'STOCK'
                          ? `${d.article} : ${d.qty} × ${formatDA(d.unitValue ?? 0)}`
                          : 'Écart de caisse'}
                        {d.cause ? ` · ${d.cause}` : ''} · contrôlé par {d.validatedBy}
                      </span>
                      {d.decisionNote && (
                        <span className="text-xs text-muted">
                          Décision : « {d.decisionNote} » ({d.decidedBy},{' '}
                          {formatDateTime(d.decidedAt)})
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${d.amount < 0 ? 'text-error' : 'text-synced'}`}
                      >
                        {d.amount > 0 ? '+' : ''}
                        {formatDA(d.amount)}
                      </span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {canDecide && d.status === 'VALIDATED' && (
                        <Button variant="secondary" onClick={() => void review(d)}>
                          Analyser
                        </Button>
                      )}
                      {canDecide && OPEN.includes(d.status) && (
                        <Button onClick={() => setDeciding(d)}>Décider</Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <ShowMore list={list} onChange={setList} />
        </Card>
      )}
      {deciding && (
        <DecisionForm
          discrepancy={deciding}
          onClose={() => setDeciding(null)}
          onDone={(message) => {
            setDeciding(null);
            setInfo(message);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DecisionForm({
  discrepancy,
  onClose,
  onDone,
}: {
  discrepancy: DiscrepancyDto;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const missing = Math.max(0, -discrepancy.amount);
  const [decision, setDecision] = useState<Decision>(missing > 0 ? 'LIABILITY' : 'NO_LIABILITY');
  const [amount, setAmount] = useState(String(missing));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (note.trim().length < 3) return setError('Justifiez la décision.');
    const value = Number(amount);
    if (decision === 'LIABILITY' && (!Number.isInteger(value) || value < 1 || value > missing))
      return setError(`La retenue va de 1 à ${formatDA(missing)}.`);
    setError(null);
    setBusy(true);
    try {
      await api('company', `/discrepancies/${discrepancy.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          note: note.trim(),
          ...(decision === 'LIABILITY' && { amount: value }),
        }),
      });
      onDone(
        decision === 'LIABILITY'
          ? `Retenue de ${formatDA(value)} créée : approuvez-la dans « Retenues ».`
          : 'Décision enregistrée.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Écart · ${discrepancy.user.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          {formatDate(discrepancy.date)} · {formatDA(discrepancy.amount)}. Un écart ne devient une
          retenue qu'après votre décision, puis son approbation.
        </p>
        <Select
          label="Décision"
          value={decision}
          onChange={(e) => setDecision(e.target.value as Decision)}
          options={[
            {
              value: 'LIABILITY',
              label: 'Responsabilité confirmée : retenue',
              disabled: missing === 0,
            },
            { value: 'NO_LIABILITY', label: 'Pas de responsabilité' },
            { value: 'REJECT', label: 'Écart non fondé' },
          ]}
        />
        {decision === 'LIABILITY' && (
          <Field
            label="Montant de la retenue (DA)"
            type="number"
            min={1}
            max={missing}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={`Au plus le manque : ${formatDA(missing)}.`}
          />
        )}
        <Field label="Justification" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Enregistrer la décision
          </Button>
        </div>
      </div>
    </Modal>
  );
}
