'use client';

import type { FieldUserDevice, Page, SyncChange, SyncOperationRowDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';

const STATUS: Record<
  SyncOperationRowDto['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  APPLIED: { label: 'Appliquée', tone: 'success' },
  APPLIED_WITH_CHANGES: { label: 'Avec changements', tone: 'warning' },
  REJECTED: { label: 'Refusée', tone: 'danger' },
};

/** Changement fait par le serveur à la réception, en clair (BR-SYN-05). */
function changeLabel(c: SyncChange): string {
  switch (c.kind) {
    case 'QUOTA_PENDING':
      return `Quantité passée en attente : ${c.pendingQty} unité(s)`;
    case 'STOCKOUT':
      return `Rupture au dépôt : ${c.reservedQty} réservée(s) sur ${c.orderedQty}`;
    case 'QUOTA_EXCEEDED':
      return `Quota dépassé (vente acceptée) : ${c.exceededQty} unité(s)`;
    case 'TRUCK_STOCK_SHORT':
      return `Stock du camion insuffisant (écart enregistré) : ${c.shortQty} unité(s)`;
  }
}

/** Journal de synchronisation (BR-SYN-07) : opérations reçues des téléphones, pour le diagnostic. */
export default function SyncLogPage() {
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<FieldUserDevice[]>([]);
  const [page, setPage] = useState<Page<SyncOperationRowDto> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (userId) params.set('userId', userId);
      if (cursor) params.set('cursor', cursor);
      return `/sync/operations?${params.toString()}`;
    },
    [status, userId],
  );

  useEffect(() => {
    api<FieldUserDevice[]>('company', '/devices')
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    setError(null);
    api<Page<SyncOperationRowDto>>('company', query())
      .then(setPage)
      .catch((err) => setError(errorMessage(err, 'Chargement impossible.')));
  }, [query]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await api<Page<SyncOperationRowDto>>('company', query(page.nextCursor));
      setPage({ ...next, data: [...page.data, ...next.data] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Synchronisation"
        subtitle="Actions reçues des téléphones : refusées, transformées à la réception ou appliquées."
      />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Tous les statuts' },
            { value: 'REJECTED', label: 'Refusées' },
            { value: 'APPLIED_WITH_CHANGES', label: 'Avec changements' },
            { value: 'APPLIED', label: 'Appliquées' },
          ]}
        />
        <Select
          label="Utilisateur"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[
            { value: '', label: 'Tous les utilisateurs' },
            ...users.map((u) => ({ value: u.userId, label: `${u.code} · ${u.name}` })),
          ]}
        />
      </Card>
      {!page && !error && <p className="text-muted">Chargement…</p>}
      {page && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">{page.total} action(s)</h2>
          {page.data.length === 0 && (
            <p className="text-sm text-muted">Aucune action pour ces critères.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border">
            {page.data.map((o) => (
              <div
                key={o.id}
                className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text-dark">
                    {o.typeLabel}{' '}
                    <span className="text-sm font-normal text-muted">
                      {o.user.name} <span className="font-mono text-xs">{o.user.code}</span>
                    </span>
                  </span>
                  <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                </span>
                <span className="text-xs text-muted">
                  Sur le téléphone {formatDateTime(o.occurredAt)} · reçue{' '}
                  {formatDateTime(o.receivedAt)}
                </span>
                {o.errorMessage && <span className="text-sm text-error">{o.errorMessage}</span>}
                {o.changes.map((c, i) => (
                  <span key={i} className="text-sm text-text-dark">
                    {changeLabel(c)}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {page.nextCursor && (
            <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Chargement…' : 'Afficher plus'}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
