import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type AuthUser,
  IS_PLATFORM,
  IS_PUBLIC,
  PERMISSION,
  type PlatformPrincipal,
  type Principal,
} from '../common/auth-context';
import { forbidden, unauthorized } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { TokensService } from './tokens.service';

export const ACTIVE_COMPANY_STATUSES = ['ACTIVE', 'TRIAL'] as const;

/**
 * Contrôles de chaque requête (docs/rbac.md §3) : session valide, canal, appareil actif,
 * entreprise active, permission. Refus par défaut : toute route non marquée @Public exige une session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const payload = this.tokens.verifyAccess(header.slice(7));

    const platformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets) ?? false;
    if (platformRoute) {
      if (payload.typ !== 'platform') throw forbidden();
      req.principal = await this.loadPlatform(payload.sub, payload.sid);
      return true;
    }
    if (payload.typ !== 'access') throw forbidden();

    const user = await this.loadCompanyUser(
      payload.sid,
      payload.sub,
      payload.cid,
      payload.did ?? null,
    );
    if (user.channel !== payload.ch)
      throw forbidden('WRONG_CHANNEL', "Ce compte n'utilise pas cet outil.");
    const permission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION, targets);
    if (permission && !user.permissions.has(permission)) throw forbidden();
    req.principal = user;
    return true;
  }

  private async loadCompanyUser(
    sessionId: string,
    userId: string,
    companyId: string,
    deviceId: string | null,
  ): Promise<AuthUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        company: true,
        device: true,
        user: { include: { role: { include: { rolePermissions: true } } } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.userId !== userId
    ) {
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    if (session.companyId !== companyId) throw unauthorized();
    if (!ACTIVE_COMPANY_STATUSES.includes(session.company.status as never)) {
      throw forbidden('COMPANY_SUSPENDED', "L'accès de votre entreprise est suspendu.");
    }
    if (session.user.status !== 'ACTIVE')
      throw forbidden('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
    if (session.user.role.channel === 'MOBILE') {
      if (!session.device || session.device.id !== deviceId) throw unauthorized();
      if (session.device.status === 'BLOCKED')
        throw forbidden('DEVICE_BLOCKED', 'Appareil bloqué. Contactez votre superviseur.');
      if (session.device.status !== 'ACTIVE')
        throw forbidden('DEVICE_REVOKED', 'Appareil révoqué. Contactez votre superviseur.');
    }
    return {
      kind: 'company',
      userId,
      companyId,
      sessionId,
      deviceId: session.deviceId,
      channel: session.user.role.channel,
      roleCode: session.user.role.code,
      permissions: new Set(session.user.role.rolePermissions.map((p) => p.permissionCode)),
    };
  }

  private async loadPlatform(
    platformUserId: string,
    sessionId: string,
  ): Promise<PlatformPrincipal> {
    const session = await this.prisma.platformSession.findUnique({
      where: { id: sessionId },
      include: { platformUser: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.platformUserId !== platformUserId ||
      session.platformUser.status !== 'ACTIVE'
    ) {
      throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    }
    return { kind: 'platform', platformUserId, sessionId };
  }
}
