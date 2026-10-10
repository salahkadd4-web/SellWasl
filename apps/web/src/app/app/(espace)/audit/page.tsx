'use client';

import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditRowDto,
  type CompanyUser,
  type Page,
} from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { type Listed, ShowMore } from '@/components/show-more';
import { Alert, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage, getAccessToken } from '@/lib/api';
import { formatDateTime, shiftDate, todayDate } from '@/lib/labels';

/** Valeur d'un champ, en clair. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Champs changés entre l'ancienne et la nouvelle valeur ; une valeur simple forme un seul champ. */
function changes(before: unknown, after: unknown): { field: string; from: unknown; to: unknown }[] {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(before) && !isObject(after)) {
    if (before === null && after === null) return [];
    return [{ field: 'Valeur', from: before, to: after }];
  }
  const a = isObject(before) ? before : {};
  const b = isObject(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: k, from: a[k], to: b[k] }));
}

/** Journal d'audit de l'entreprise (BR-AUD-01) : qui a fait quoi, quand, depuis où. */
export default function AuditPage() {
  const [from, setFrom] = useState(() => shiftDate(todayDate(), -30));
  const [to, setTo] = useState(todayDate);
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [list, setList] = useState<Listed<AuditRowDto> | null>(null);
  const [open, setOpen] = useState<AuditRowDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = list?.page.data ?? null;

  const filters = useCallback(() => {
    const params = new URLSearchParams(
      Object.entries({ from, to, userId, entity, action }).filter(([, v]) => v !== ''),
    );
    return params.toString();
  }, [from, to, userId, entity, action]);

  useEffect(() => {
    api<CompanyUser[]>('company', '/users')
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const path = `/audit?${filters()}`;
      setList({ path, page: await api<Page<AuditRowDto>>('company', path) });
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    // L'export demande une session : téléchargement par l'API, puis enregistrement local
    const response = await fetch(`/api/v1/audit/export?${filters()}`, {
      headers: { Authorization: `Bearer ${getAccessToken('company') ?? ''}` },
    });
    if (!response.ok) return setError('Export impossible.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `journal-audit-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Journal d'audit"
        subtitle="Qui a fait quoi, quand et depuis où. Le journal ne se modifie pas."
        action={
          <Button variant="secondary" onClick={() => void exportCsv()}>
            Exporter en CSV
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select
          label="Utilisateur"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[
            { value: '', label: 'Tous les utilisateurs' },
            ...users.map((u) => ({
              value: u.id,
              label: `${u.code} · ${u.firstName} ${u.lastName}`,
            })),
          ]}
        />
        <Select
          label="Fiche"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          options={[
            { value: '', label: 'Toutes les fiches' },
            ...Object.entries(AUDIT_ENTITIES)
              .map(([value, label]) => ({ value, label }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          ]}
        />
        <Select
          label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          options={[
            { value: '', label: 'Toutes les actions' },
            ...Object.entries(AUDIT_ACTIONS)
              .map(([value, label]) => ({ value, label }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          ]}
        />
      </Card>
      {!list && !error && <p className="text-muted">Chargement…</p>}
      {list && rows && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{list.page.total} action(s)</h2>
          {rows.length === 0 && (
            <p className="text-sm text-muted">Aucune action pour ces critères.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpen(r)}
                className="flex w-full cursor-pointer flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text-dark">
                    {r.actionLabel}{' '}
                    <span className="text-sm font-normal text-muted">· {r.entityLabel}</span>
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(r.at)}</span>
                </span>
                <span className="text-xs text-muted">
                  {r.actor ? (
                    <>
                      {r.actor.name} <span className="font-mono">{r.actor.code}</span>
                    </>
                  ) : (
                    'Système'
                  )}
                  {r.deviceId ? ' · téléphone' : ''}
                  {r.reason ? ` · ${r.reason}` : ''}
                </span>
              </button>
            ))}
          </div>
          <ShowMore list={list} onChange={setList} />
        </Card>
      )}
      {open && <AuditDetail row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditDetail({ row, onClose }: { row: AuditRowDto; onClose: () => void }) {
  const changed = changes(row.before, row.after);
  return (
    <Modal title={row.actionLabel} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Quand</dt>
          <dd className="text-text-dark">{formatDateTime(row.at)}</dd>
          <dt className="text-muted">Qui</dt>
          <dd className="text-text-dark">
            {row.actor ? `${row.actor.name} (${row.actor.code})` : 'Système'}
          </dd>
          <dt className="text-muted">Fiche</dt>
          <dd className="text-text-dark">
            {row.entityLabel}
            {row.entityId && (
              <span className="ml-1 font-mono text-xs text-muted">{row.entityId}</span>
            )}
          </dd>
          <dt className="text-muted">Appareil</dt>
          <dd className="font-mono text-xs text-text-dark">{row.deviceId ?? '—'}</dd>
          <dt className="text-muted">IP</dt>
          <dd className="font-mono text-xs text-text-dark">{row.ip ?? '—'}</dd>
          <dt className="text-muted">Navigateur</dt>
          <dd className="break-all text-xs text-text-dark">{row.userAgent ?? '—'}</dd>
          {row.reason && (
            <>
              <dt className="text-muted">Motif</dt>
              <dd className="text-text-dark">{row.reason}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-text-dark">Changements</h3>
          {changed.length === 0 && <p className="text-muted">Aucun détail enregistré.</p>}
          {changed.map((c) => (
            <div key={c.field} className="rounded-lg border border-border px-3 py-2">
              <p className="font-medium text-text-dark">{c.field}</p>
              <p className="break-all text-xs text-muted">
                Avant : <span className="text-text-dark">{show(c.from)}</span>
              </p>
              <p className="break-all text-xs text-muted">
                Après : <span className="text-text-dark">{show(c.to)}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
