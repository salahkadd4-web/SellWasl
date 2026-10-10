import { Injectable, type NestMiddleware } from '@nestjs/common';
import { platformAccess } from '@sellwasl/business-rules';
import type { NextFunction, Request, Response } from 'express';
import { notFound } from '../common/api-error';

/**
 * Espace plateforme invisible hors de la liste d'IP (PLATFORM_ALLOWED_IPS, phase 27) : toute
 * route `/platform/*`, connexion comprise, répond 404 comme si elle n'existait pas, avant
 * l'authentification. L'IP est celle du client derrière les proxys de confiance (TRUST_PROXY).
 */
@Injectable()
export class PlatformIpMiddleware implements NestMiddleware {
  private readonly allowed = platformAccess(process.env);

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.allowed(req.ip)) throw notFound();
    next();
  }
}
