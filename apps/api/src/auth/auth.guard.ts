import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  isPermissionModuleActive,
  isRoleAvailable,
  type ModuleCode,
  type RoleCode,
} from '@sellwasl/business-rules';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { forbidden, unauthorized } from '../common/api-error';
import {
  ANY_AUTHENTICATED,
  type AuthUser,
  IS_PLATFORM,
  IS_PUBLIC,
  MODULE,
  PERMISSION,
  type PlatformPrincipal,
  type Principal,
} from '../common/auth-context';
import { ModulesService } from '../modules/modules.service';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_KEY } from '../tenancy/tenant-prisma';
import { AUDIT_CONTEXT, type AuditContext } from '../audit/audit.service';
import { TokensService } from './tokens.service';

export const ACTIVE_COMPANY_STATUSES = ['ACTIVE', 'TRIAL'] as const;

export const moduleDisabled = () =>
  forbidden('MODULE_DISABLED', "Cette fonction n'est pas disponible pour votre entreprise.");

/**
 * Contrôles de chaque requête (docs/rbac.md §3), dans l'ordre : session, canal, appareil,
 * entreprise, rôle disponible, permission, module. Refus par défaut : une route doit être
 * @Public, @PlatformOnly, @AnyAuthenticated ou porter une @RequirePermission.
 * L'entreprise de l'utilisateur est placée dans le contexte de la requête (phase 5).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly cls: ClsService,
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
    if (!isRoleAvailable(user.roleCode as RoleCode, user.modules)) throw moduleDisabled();

    const permission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION, targets);
    const requiredModule = this.reflector.getAllAndOverride<ModuleCode | undefined>(
      MODULE,
      targets,
    );
    const anyAuthenticated =
      this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets) ?? false;
    if (!permission && !requiredModule && !anyAuthenticated) {
      throw forbidden('FORBIDDEN', 'Route sans permission déclarée.');
    }
    if (permission && !user.permissions.has(permission)) throw forbidden();
    if (permission && !isPermissionModuleActive(permission, user.modules)) throw moduleDisabled();
    if (requiredModule && !user.modules.includes(requiredModule)) throw moduleDisabled();

    req.principal = user;
    this.cls.set(TENANT_KEY, user.companyId);
    // Appareil du téléphone pour le journal d'audit (phase 26)
    const audit = this.cls.get<AuditContext | undefined>(AUDIT_CONTEXT);
    this.cls.set<AuditContext>(AUDIT_CONTEXT, { ...audit, deviceId: user.deviceId });
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
    if (session.companyId !== companyId || session.user.companyId !== companyId)
      throw unauthorized();
    if (!ACTIVE_COMPANY_STATUSES.includes(session.company.status as never)) {
      throw forbidden('COMPANY_SUSPENDED', "L'accès de votre entreprise est suspendu.");
    }
    if (session.user.status !== 'ACTIVE')
      throw forbidden('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
    if (session.user.role.channel === 'MOBILE') {
      if (!session.device || session.device.id !== deviceId) throw unauthorized();
      if (session.device.status === 'BLOCKED') {
        throw forbidden('DEVICE_BLOCKED', 'Appareil bloqué. Contactez votre superviseur.');
      }
      if (session.device.status !== 'ACTIVE') {
        throw forbidden('DEVICE_REVOKED', 'Appareil révoqué. Contactez votre superviseur.');
      }
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
      modules: await this.modules.activeModules(companyId),
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
