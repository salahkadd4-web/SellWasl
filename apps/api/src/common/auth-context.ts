import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

/** Utilisateur d'entreprise authentifié, placé sur la requête par AuthGuard. */
export interface AuthUser {
  kind: 'company';
  userId: string;
  companyId: string;
  sessionId: string;
  deviceId: string | null;
  channel: 'WEB' | 'MOBILE';
  roleCode: string;
  permissions: ReadonlySet<string>;
}

/** Super Admin authentifié. */
export interface PlatformPrincipal {
  kind: 'platform';
  platformUserId: string;
  sessionId: string;
}

export type Principal = AuthUser | PlatformPrincipal;

export const IS_PUBLIC = 'isPublic';
/** Route accessible sans session (connexion, santé). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const IS_PLATFORM = 'isPlatform';
/** Route réservée aux comptes plateforme. */
export const PlatformOnly = () => SetMetadata(IS_PLATFORM, true);

export const PERMISSION = 'permission';
/** Permission requise (docs/rbac.md §4). */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ principal: AuthUser }>().principal;
});

export const CurrentPlatformUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformPrincipal => {
    return ctx.switchToHttp().getRequest<{ principal: PlatformPrincipal }>().principal;
  },
);
