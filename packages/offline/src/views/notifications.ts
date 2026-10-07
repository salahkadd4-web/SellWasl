import type { NotificationDto } from '@sellwasl/validation';
import type { LocalState } from '../local-state';

/** Notifications de l'utilisateur : non lues d'abord, puis les plus récentes en tête. */
export function notificationsView(s: LocalState): NotificationDto[] {
  return [...s.notifications].sort(
    (a, b) =>
      Number(a.readAt !== null) - Number(b.readAt !== null) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/** Nombre de notifications non lues (carte des accueils). */
export function unreadNotifications(s: LocalState): number {
  return s.notifications.filter((n) => n.readAt === null).length;
}
