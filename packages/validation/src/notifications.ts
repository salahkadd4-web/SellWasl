// Notifications internes et push (phase 24, BR-NOT)
import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'PENDING_LINES',
  'NEW_CUSTOMER',
  'OUT_OF_ZONE_VISIT',
  'LOAD_GAP',
  'UNLOAD_GAP',
  'SETTLEMENT_GAP',
  'WORKDAY_OFFLINE',
  'WORKDAY_REOPENED',
  'QUOTA_CHANGED',
  'PENDING_DECIDED',
  'DEVICE_REVOKED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Page du Web à ouvrir (null : pas de page). */
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

export const notificationListQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
