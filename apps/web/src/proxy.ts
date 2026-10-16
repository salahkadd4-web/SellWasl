import {
  clientIp,
  platformAccess,
  WEB_PROXY_IP_HEADER,
  WEB_PROXY_KEY_HEADER,
} from '@sellwasl/business-rules';
import { type NextRequest, NextResponse } from 'next/server';

const allowed = platformAccess(process.env);
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
const webProxySecret = process.env.WEB_PROXY_SECRET;

/**
 * - Espace plateforme (/admin) invisible hors de la liste d'IP (PLATFORM_ALLOWED_IPS, phase 27) :
 *   la page « introuvable » s'affiche, avec le statut 404, comme si l'espace n'existait pas.
 * - Requêtes vers l'API (/api/*, redirigées par next.config.ts) : l'adresse du client et la clé
 *   partagée sont posées pour l'API (phase 30, docs/deployment.md, étape 13) ; celles envoyées par le
 *   visiteur sont toujours retirées.
 * L'IP vient de X-Forwarded-For, posé par les proxys de confiance (TRUST_PROXY).
 */
export function proxy(request: NextRequest) {
  const ip = clientIp(request.headers.get('x-forwarded-for'), undefined, trustProxy);
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const headers = new Headers(request.headers);
    headers.delete(WEB_PROXY_IP_HEADER);
    headers.delete(WEB_PROXY_KEY_HEADER);
    if (webProxySecret && ip) {
      headers.set(WEB_PROXY_IP_HEADER, ip);
      headers.set(WEB_PROXY_KEY_HEADER, webProxySecret);
    }
    return NextResponse.next({ request: { headers } });
  }
  if (allowed(ip)) return NextResponse.next();
  return NextResponse.rewrite(new URL('/introuvable', request.url), { status: 404 });
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/:path*'],
};
