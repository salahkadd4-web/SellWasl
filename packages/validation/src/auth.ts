// Phase 4 — authentification (docs/api.md §3, architecture ARC-04, BR-USR-02, BR-USR-06)
import { z } from 'zod';

const password = z.string().min(1, 'Mot de passe obligatoire').max(200);

/** Connexion Web : code de l'entreprise, code ou email de l'utilisateur, mot de passe. */
export const webLoginSchema = z.object({
  companyCode: z.string().trim().min(1, "Code de l'entreprise obligatoire").toUpperCase(),
  login: z.string().trim().min(1, 'Identifiant obligatoire'),
  password,
});
export type WebLoginInput = z.infer<typeof webLoginSchema>;

/** Connexion du Super Admin (comptes plateforme, séparés). */
export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  password,
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

/** Code d'association : 8 caractères sans 0/O ni 1/I/L, affiché « ABCD-EFGH ». */
export const ACTIVATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeActivationCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export const activationCodeSchema = z
  .string()
  .transform(normalizeActivationCode)
  .pipe(z.string().length(8, 'Le code fait 8 caractères'));

/** Contenu du QR code affiché sur le Web. */
export function activationQrPayload(code: string): string {
  return `sellwasl://activate?code=${normalizeActivationCode(code)}`;
}
export function parseActivationQr(data: string): string | null {
  const match = /[?&]code=([A-Za-z0-9-]+)/.exec(data);
  return match ? normalizeActivationCode(match[1]!) : null;
}

export const deviceInfoSchema = z.object({
  name: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  osVersion: z.string().max(50).optional(),
  appVersion: z.string().max(50).optional(),
});

/** Association d'un téléphone (UC-01) : code d'association et mot de passe de l'utilisateur. */
export const deviceActivateSchema = z.object({
  code: activationCodeSchema,
  password,
  device: deviceInfoSchema.default({}),
});
export type DeviceActivateInput = z.input<typeof deviceActivateSchema>;

/** Connexion sur l'appareil associé. */
export const deviceLoginSchema = z.object({
  deviceId: z.string().uuid(),
  password,
});
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;

/** Rafraîchissement mobile (le Web utilise un cookie HttpOnly). */
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword: z.string().min(8, 'Au moins 8 caractères').max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Réponses de l'API */
export interface AuthTokens {
  accessToken: string;
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: number;
  /** Mobile seulement : le Web le reçoit dans un cookie. */
  refreshToken?: string;
}

export interface MeResponse {
  user: { id: string; code: string; firstName: string; lastName: string; email: string | null };
  company: { id: string; code: string; name: string; mode: string };
  role: { code: string; name: string; channel: 'WEB' | 'MOBILE' };
  permissions: string[];
  modules: string[];
  device: { id: string; series: string } | null;
  mustChangePassword: boolean;
}

export interface DeviceActivationResponse extends AuthTokens {
  device: { id: string; series: string };
  me: MeResponse;
}

export interface ActivationCodeResponse {
  code: string;
  qrPayload: string;
  expiresAt: string;
  /** L'ancien appareil avait signalé des opérations non synchronisées (BR-USR-08). */
  previousDevicePendingOps: number;
}

export interface PlatformMeResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}
