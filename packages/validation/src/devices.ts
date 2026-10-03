import { z } from 'zod';

/**
 * Signal de vie du téléphone (architecture §11.3, BR-JOU-09) : envoyé à l'ouverture de
 * l'application puis toutes les `positionIntervalMin` minutes tant qu'elle est ouverte.
 */
export const heartbeatSchema = z.object({
  /** Niveau de batterie en pourcentage, absent si le téléphone ne le donne pas. */
  batteryLevel: z.number().int().min(0).max(100).nullish(),
  /** Opérations enregistrées sur le téléphone et pas encore synchronisées. */
  pendingOps: z.number().int().min(0).max(100_000).default(0),
  appVersion: z.string().max(50).optional(),
  /** Gardée seulement pendant une journée en cours (BR-JOU-09). */
  position: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyM: z.number().min(0).max(100_000).optional(),
      recordedAt: z.iso.datetime(),
    })
    .optional(),
});
export type HeartbeatInput = z.input<typeof heartbeatSchema>;

export interface HeartbeatResponse {
  /** La position a été enregistrée (journée en cours). */
  positionRecorded: boolean;
  /** Intervalle d'envoi demandé par les paramètres de l'entreprise, en minutes. */
  intervalMin: number;
}

export const pushTokenSchema = z.object({ pushToken: z.string().min(1).max(500) });

export type DeviceStatusValue = 'ACTIVE' | 'REVOKED' | 'BLOCKED';

/** Appareil vu par le superviseur (UC-59). */
export interface DeviceSummary {
  id: string;
  series: string;
  status: DeviceStatusValue;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  activatedAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  batteryLevel: number | null;
  pendingOps: number;
}

/** Utilisateur terrain et son appareil en service (actif ou bloqué). */
export interface FieldUserDevice {
  userId: string;
  code: string;
  name: string;
  role: string;
  userStatus: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  activeSessions: number;
  device: DeviceSummary | null;
}

export interface SessionSummary {
  id: string;
  channel: 'WEB' | 'MOBILE';
  deviceSeries: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  ip: string | null;
}

/** Détail d'un utilisateur terrain : tous ses appareils et ses sessions ouvertes. */
export interface UserDevicesResponse {
  devices: DeviceSummary[];
  sessions: SessionSummary[];
}
