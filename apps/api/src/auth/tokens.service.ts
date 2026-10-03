import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens } from '@sellwasl/validation';
import { unauthorized } from '../common/api-error';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';

/** Durées des jetons (architecture §16). */
export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessPayload {
  typ: 'access';
  sub: string;
  cid: string;
  sid: string;
  did?: string;
  ch: 'WEB' | 'MOBILE';
}

export interface PlatformPayload {
  typ: 'platform';
  sub: string;
  sid: string;
}

interface SessionTarget {
  companyId: string;
  userId: string;
  deviceId: string | null;
  channel: 'WEB' | 'MOBILE';
  ip?: string;
  userAgent?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Jeton de rafraîchissement : « <id de session>.<secret> » ; seul le hash du secret est stocké. */
function newRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

function parseRefreshToken(token: string): { sessionId: string; secret: string } {
  const [sessionId, secret] = token.split('.');
  if (!sessionId || !secret) throw unauthorized('INVALID_REFRESH_TOKEN', 'Session invalide.');
  return { sessionId, secret };
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Sessions et jetons : jeton d'accès JWT de 15 minutes, jeton de rafraîchissement de 30 jours
 * à rotation. Un jeton déjà utilisé et présenté de nouveau révoque la session (architecture §16).
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async openSession(target: SessionTarget): Promise<Required<AuthTokens>> {
    const sessionId = uuidv7();
    const secret = newRefreshSecret();
    await this.prisma.session.create({
      data: {
        id: sessionId,
        companyId: target.companyId,
        userId: target.userId,
        deviceId: target.deviceId,
        channel: target.channel,
        refreshTokenHash: sha256(secret),
        familyId: sessionId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        ip: target.ip,
        userAgent: target.userAgent,
      },
    });
    return this.issue(target, sessionId, secret);
  }

  /** Rotation : renvoie de nouveaux jetons, ou révoque la session si le jeton a déjà servi. */
  async rotate(
    refreshToken: string,
  ): Promise<Required<AuthTokens> & { userId: string; companyId: string }> {
    const { sessionId, secret } = parseRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    if (!sameHash(session.refreshTokenHash, sha256(secret))) {
      await this.revokeSession(sessionId, 'REFRESH_TOKEN_REUSED');
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    const next = newRefreshSecret();
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: sha256(next),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    const target: SessionTarget = {
      companyId: session.companyId,
      userId: session.userId,
      deviceId: session.deviceId,
      channel: session.channel,
    };
    return {
      userId: session.userId,
      companyId: session.companyId,
      ...(await this.issue(target, sessionId, next)),
    };
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  verifyAccess(token: string): AccessPayload | PlatformPayload {
    try {
      return this.jwt.verify<AccessPayload | PlatformPayload>(token);
    } catch {
      throw unauthorized('TOKEN_EXPIRED', 'Session expirée.');
    }
  }

  private async issue(
    target: SessionTarget,
    sessionId: string,
    secret: string,
  ): Promise<Required<AuthTokens>> {
    const payload: AccessPayload = {
      typ: 'access',
      sub: target.userId,
      cid: target.companyId,
      sid: sessionId,
      ch: target.channel,
      ...(target.deviceId ? { did: target.deviceId } : {}),
    };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_S }),
      expiresIn: ACCESS_TOKEN_TTL_S,
      refreshToken: `${sessionId}.${secret}`,
    };
  }

  // --- Comptes plateforme : même mécanisme, table séparée ---

  async openPlatformSession(
    platformUserId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<Required<AuthTokens>> {
    const sessionId = uuidv7();
    const secret = newRefreshSecret();
    await this.prisma.platformSession.create({
      data: {
        id: sessionId,
        platformUserId,
        refreshTokenHash: sha256(secret),
        familyId: sessionId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        ip,
        userAgent,
      },
    });
    return this.issuePlatform(platformUserId, sessionId, secret);
  }

  async rotatePlatform(refreshToken: string): Promise<Required<AuthTokens>> {
    const { sessionId, secret } = parseRefreshToken(refreshToken);
    const session = await this.prisma.platformSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    if (!sameHash(session.refreshTokenHash, sha256(secret))) {
      await this.revokePlatformSession(sessionId);
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    const next = newRefreshSecret();
    await this.prisma.platformSession.update({
      where: { id: sessionId },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date() },
    });
    return this.issuePlatform(session.platformUserId, sessionId, next);
  }

  async revokePlatformSession(sessionId: string): Promise<void> {
    await this.prisma.platformSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issuePlatform(
    platformUserId: string,
    sessionId: string,
    secret: string,
  ): Promise<Required<AuthTokens>> {
    const payload: PlatformPayload = { typ: 'platform', sub: platformUserId, sid: sessionId };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_S }),
      expiresIn: ACCESS_TOKEN_TTL_S,
      refreshToken: `${sessionId}.${secret}`,
    };
  }
}
