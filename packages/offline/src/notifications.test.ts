import type { NotificationDto } from '@sellwasl/validation';
import { describe, expect, it } from 'vitest';
import { applyOps } from './effects';
import { op } from './fixtures';
import { loadState } from './local-state';
import { notificationsView, unreadNotifications } from './views/notifications';

const n = (id: string, createdAt: string, readAt: string | null = null): NotificationDto => ({
  id,
  type: 'QUOTA_CHANGED',
  title: 'Quota modifié',
  body: id,
  href: null,
  createdAt,
  readAt,
});

describe('notifications du téléphone (phase 24)', () => {
  const state = () =>
    loadState({
      notification: [
        { id: 'a', data: n('a', '2027-06-01T08:00:00.000Z', '2027-06-01T09:00:00.000Z') },
        { id: 'b', data: n('b', '2027-06-02T08:00:00.000Z') },
        { id: 'c', data: n('c', '2027-06-03T08:00:00.000Z') },
      ],
    });

  it('non lues d’abord, les plus récentes en tête ; compteur', () => {
    expect(notificationsView(state()).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(unreadNotifications(state())).toBe(2);
  });

  it('« lu » en file : lue tout de suite, même hors connexion', () => {
    const s = applyOps(state(), [op('notification.read', { notificationIds: ['c'] })]);
    expect(unreadNotifications(s)).toBe(1);
    expect(notificationsView(s).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(notificationsView(s).find((x) => x.id === 'c')!.readAt).not.toBeNull();
  });
});
