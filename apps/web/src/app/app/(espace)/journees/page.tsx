'use client';

import type { WorkdayDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, formatDateTime, todayDate, WORKDAY_STATUS } from '@/lib/labels';

type Action = { kind: 'reopen' | 'force-close'; workday: WorkdayDto };

/** Journées du terrain d'une date (UC-57) : rouvrir (UC-58) ou clôturer d'office (UC-64). */
export default function WorkdaysPage() {
  const { can } = CompanyAuth.useAuth();
  const [date, setDate] = useState(todayDate);
  const [workdays, setWorkdays] = useState<WorkdayDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkdays(await api<WorkdayDto[]>('company', `/workdays?date=${date}`));
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
        title="Journées"
        subtitle="État de la journée de chaque utilisateur du terrain : visites, commandes, encaissé."
      />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </Card>
      {workdays && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
          {workdays.length === 0 && (
            <p className="text-sm text-muted">Aucun utilisateur du terrain.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border">
            {workdays.map((w) => {
              const status = WORKDAY_STATUS[w.status]!;
              return (
                <div
                  key={w.user.id}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">
                      {w.user.name}{' '}
                      <span className="font-mono text-xs text-muted">{w.user.code}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {w.user.roleName}
                      {w.startedAt ? ` · démarrée ${formatDateTime(w.startedAt)}` : ''}
                      {w.closedAt ? ` · clôturée ${formatDateTime(w.closedAt)}` : ''}
                    </span>
                    {w.id && (
                      <span className="text-xs text-muted">
                        Visites {w.visits.done}/{w.visits.planned}
                        {w.visits.outOfZone ? ` · ${w.visits.outOfZone} hors zone` : ''}
                        {w.visits.byPhone ? ` · ${w.visits.byPhone} par téléphone` : ''} ·{' '}
                        {w.ordersCount} commande(s), {formatDA(w.ordersAmount)} · encaissé{' '}
                        {formatDA(w.collectedAmount)}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {w.isForceClosed && <Badge tone="danger">Clôturée d'office</Badge>}
                    {w.reopenCount > 0 && <Badge tone="warning">Rouverte ×{w.reopenCount}</Badge>}
                    {w.status === 'CLOSED' && can('workdays.reopen') && (
                      <Button
                        variant="secondary"
                        onClick={() => setAction({ kind: 'reopen', workday: w })}
                      >
                        Rouvrir
                      </Button>
                    )}
                    {w.status === 'IN_PROGRESS' && can('workdays.force_close') && (
                      <Button
                        variant="danger"
                        onClick={() => setAction({ kind: 'force-close', workday: w })}
                      >
                        Clôturer d'office
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {action && (
        <ReasonDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Motif obligatoire, audité (BR-JOU-08, BR-JOU-10). */
function ReasonDialog({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reopen = action.kind === 'reopen';

  async function submit() {
    setError(null);
    if (reason.trim().length < 3) return setError('Saisissez le motif.');
    setBusy(true);
    try {
      await api('company', `/workdays/${action.workday.id}/${action.kind}`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={reopen ? 'Rouvrir la journée' : "Clôturer d'office la journée"} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          {action.workday.user.name} · {formatDate(action.workday.date)}.{' '}
          {reopen
            ? 'Ses commandes figées redeviennent modifiables jusqu’à la prochaine clôture.'
            : 'Mêmes effets qu’une clôture : visites manquées et commandes figées.'}
        </p>
        <Field label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={reopen ? 'primary' : 'danger'}
            onClick={() => void submit()}
            disabled={busy}
          >
            {reopen ? 'Rouvrir' : "Clôturer d'office"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
