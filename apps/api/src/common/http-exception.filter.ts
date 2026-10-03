import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_RULE',
  429: 'RATE_LIMITED',
};

const DEFAULT_MESSAGES: Record<number, string> = {
  404: 'Introuvable.',
  429: 'Trop de tentatives. Réessayez dans une minute.',
};

/** Toutes les erreurs ont la même forme (docs/api.md §2). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id !== undefined ? String(req.id) : undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'object' && body !== null && 'code' in body
          ? (body as { code: string; message: string; details?: unknown })
          : {
              code: DEFAULT_CODES[status] ?? 'ERROR',
              message: DEFAULT_MESSAGES[status] ?? exception.message,
            };
      res.status(status).json({ error: { ...payload, requestId } });
      return;
    }

    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur inattendue.', requestId },
    });
  }
}
