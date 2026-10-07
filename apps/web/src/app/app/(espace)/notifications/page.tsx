'use client';

import type { NotificationDto, Page } from '@sellwasl/validation';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';

/** Historique des notifications de l'utilisateur (BR-NOT-01). */
export default function NotificationsPage() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState<Page<NotificationDto> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({ limit: '30' });
      if (unreadOnly) params.set('unread', 'true');
      if (cursor) params.set('cursor', cursor);
      return `/notifications?${params.toString()}`;
    },
    [unreadOnly],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setPage(await api<Page<NotificationDto>>('company', query()));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await api<Page<NotificationDto>>('company', query(page.nextCursor));
      setPage({ ...next, data: [...page.data, ...next.data] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(n: NotificationDto) {
    if (!n.readAt) await api('company', `/notifications/${n.id}/read`, { method: 'PATCH' });
    if (n.href) router.push(n.href);
    else void load();
  }

  async function readAll() {
    try {
      await api('company', '/notifications/read-all', { method: 'POST' });
      void load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Notifications"
        subtitle="Événements qui vous concernent : lignes en attente, nouveaux clients, écarts, journées."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? 'Toutes' : 'Non lues seulement'}
            </Button>
            <Button onClick={() => void readAll()}>Tout marquer comme lu</Button>
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      {!page && !error && <p className="text-muted">Chargement…</p>}
      {page && (
        <Card className="flex flex-col gap-3">
          {page.data.length === 0 && <p className="text-sm text-muted">Aucune notification.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {page.data.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void open(n)}
                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={n.readAt ? 'font-medium text-text-dark' : 'font-bold text-primary'}
                  >
                    {n.title}
                  </span>
                  {!n.readAt && <Badge tone="warning">Non lue</Badge>}
                </span>
                <span className="text-sm text-text-dark">{n.body}</span>
                <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
              </button>
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
