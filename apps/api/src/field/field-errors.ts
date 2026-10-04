import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error';

/** Règle métier non respectée (422). */
export const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);

/** Action impossible dans l'état actuel : journée non démarrée, visite en cours… (409). */
export const invalidState = (message: string) =>
  new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE', message);

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** 2026-10-03 → 03/10/2026, pour les messages. */
export const frDate = (s: string) => s.split('-').reverse().join('/');
