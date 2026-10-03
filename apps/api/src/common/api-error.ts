import { HttpException, HttpStatus } from '@nestjs/common';

/** Erreur métier au format de docs/api.md §2 : { error: { code, message, details } }. */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Session invalide ou expirée.') =>
  new ApiError(HttpStatus.UNAUTHORIZED, code, message);

export const forbidden = (
  code = 'FORBIDDEN',
  message = "Vous n'avez pas le droit de faire cette action.",
) => new ApiError(HttpStatus.FORBIDDEN, code, message);

export const notFound = (message = 'Introuvable.') =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
