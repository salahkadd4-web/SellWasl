'use client';

import type { NotificationDto, Page } from '@sellwasl/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';

/** Rafraîchissement du nombre de non lues (spec phase 24 §4). */
const REFRESH_MS = 60_000;

/**
 * Cloche des notifications (BR-NOT-01) : nombre de non lues, rafraîchi toutes les minutes et au
 * retour sur l'onglet ; panneau des dernières, chacune mène à sa page.
 */
export function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setCount((await api<{ count: number }>('company', '/notifications/unread-count')).count);
    } catch {
      // Hors ligne ou session expirée : la cloche garde son dernier nombre
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Le panneau se ferme au clic dehors et à la touche Échap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) =>
      box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setItems(null);
    try {
      setItems((await api<Page<NotificationDto>>('company', '/notifications?limit=10')).data);
    } catch {
      setItems([]);
    }
  }

  async function openItem(n: NotificationDto) {
    setOpen(false);
    if (!n.readAt) {
      await api('company', `/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => null);
      void refresh();
    }
    router.push(n.href ?? '/app/notifications');
  }

  async function readAll() {
    await api('company', '/notifications/read-all', { method: 'POST' }).catch(() => null);
    setItems(
      (list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null,
    );
    void refresh();
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={count > 0 ? `Notifications : ${count} non lue(s)` : 'Notifications'}
        aria-expanded={open}
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10 lg:hover:bg-surface"
      >
        <Icon name="bell" className="size-6" />
        {count > 0 && (
          <span className="absolute right-1 top-1 min-w-5 rounded-full bg-error px-1 text-center text-xs font-bold leading-5 text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-white text-text-dark shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="font-semibold">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => void readAll()}
                className="text-sm font-semibold text-deep-blue"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          {!items && <p className="px-3 py-4 text-sm text-muted">Chargement…</p>}
          {items?.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted">Aucune notification.</p>
          )}
          <ul className="max-h-96 overflow-y-auto">
            {items?.map((n) => (
              <li key={n.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => void openItem(n)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface"
                >
                  <span
                    className={`text-sm ${n.readAt ? 'font-medium' : 'font-bold text-primary'}`}
                  >
                    {n.title}
                  </span>
                  <span className="text-sm text-text-dark">{n.body}</span>
                  <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            href="/app/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-center text-sm font-semibold text-deep-blue hover:bg-surface"
          >
            Toutes les notifications
          </Link>
        </div>
      )}
    </div>
  );
}
