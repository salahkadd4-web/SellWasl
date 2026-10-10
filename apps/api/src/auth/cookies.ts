import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_TOKEN_TTL_MS } from './tokens.service';

/** Jeton de rafraîchissement du Web : cookie HttpOnly, limité aux routes d'authentification (architecture §8). */
export const COMPANY_REFRESH_COOKIE = 'sw_rt';
export const PLATFORM_REFRESH_COOKIE = 'sw_prt';

/** Cookie Secure (HTTPS seulement) partout sauf en développement et en test (phase 27). */
export function cookieOptions(path: string, nodeEnv = process.env.NODE_ENV): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: nodeEnv !== 'development' && nodeEnv !== 'test',
    path,
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

const PATHS = {
  [COMPANY_REFRESH_COOKIE]: '/api/v1/auth',
  [PLATFORM_REFRESH_COOKIE]: '/api/v1/platform/auth',
} as const;

type CookieName = keyof typeof PATHS;

export function setRefreshCookie(res: Response, name: CookieName, token: string): void {
  res.cookie(name, token, cookieOptions(PATHS[name]));
}

export function clearRefreshCookie(res: Response, name: CookieName): void {
  res.clearCookie(name, { ...cookieOptions(PATHS[name]), maxAge: undefined });
}

export function readRefreshCookie(req: Request, name: CookieName): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function clientInfo(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
}
