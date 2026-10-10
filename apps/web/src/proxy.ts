import { clientIp, platformAccess } from '@sellwasl/business-rules';
import { type NextRequest, NextResponse } from 'next/server';

const allowed = platformAccess(process.env);
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);

/**
 * Espace plateforme (/admin) invisible hors de la liste d'IP (PLATFORM_ALLOWED_IPS, phase 27) :
 * la page « introuvable » s'affiche, avec le statut 404, comme si l'espace n'existait pas. L'IP
 * vient de X-Forwarded-For, posé par les proxys de confiance (TRUST_PROXY).
 */
export function proxy(request: NextRequest) {
  const ip = clientIp(request.headers.get('x-forwarded-for'), undefined, trustProxy);
  if (allowed(ip)) return NextResponse.next();
  return NextResponse.rewrite(new URL('/introuvable', request.url), { status: 404 });
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
