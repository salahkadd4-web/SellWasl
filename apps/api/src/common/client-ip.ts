import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { WEB_PROXY_IP_HEADER, WEB_PROXY_KEY_HEADER } from '@sellwasl/business-rules';
import type { NextFunction, Request, Response } from 'express';

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Adresse du client posée par le Web (phase 30, docs/deployment.md §9), retenue seulement avec la
 * clé partagée `WEB_PROXY_SECRET` (comparaison à temps constant) et si c'est bien une adresse IP.
 */
export function webProxyClientIp(
  headers: Request['headers'],
  secret: string | undefined,
): string | undefined {
  const key = single(headers[WEB_PROXY_KEY_HEADER]);
  const ip = single(headers[WEB_PROXY_IP_HEADER])?.trim();
  if (!secret || !key || !ip || isIP(ip) === 0) return undefined;
  const expected = Buffer.from(secret);
  const given = Buffer.from(key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  return ip;
}

/**
 * Le Web passe par Vercel puis Render, le mobile par Render seul : le nombre de proxys diffère.
 * Une requête du Web porte l'adresse du client ; les autres suivent TRUST_PROXY (mobile).
 */
export function webProxyClientIpMiddleware(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = webProxyClientIp(req.headers, secret);
    // Masque l'accesseur d'Express : audit, limite de tentatives et liste d'IP lisent req.ip
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  };
}
