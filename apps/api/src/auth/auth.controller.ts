import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthTokens,
  changePasswordSchema,
  deviceActivateSchema,
  type DeviceActivationResponse,
  deviceLoginSchema,
  type MeResponse,
  webLoginSchema,
} from '@sellwasl/validation';
import type { Request, Response } from 'express';
import { unauthorized } from '../common/api-error';
import { type AuthUser, CurrentUser, Public } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  clearRefreshCookie,
  clientInfo,
  COMPANY_REFRESH_COOKIE,
  readRefreshCookie,
  setRefreshCookie,
} from './cookies';

/** Limite des routes de connexion : 10 tentatives par minute et par adresse IP. */
const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Connexion Web : le jeton de rafraîchissement part dans un cookie HttpOnly. */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(webLoginSchema)) body: ReturnType<typeof webLoginSchema.parse>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const { refreshToken, ...tokens } = await this.auth.webLogin(body, clientInfo(req));
    setRefreshCookie(res, COMPANY_REFRESH_COOKIE, refreshToken);
    return tokens;
  }

  /** Rafraîchissement : cookie (Web) ou corps de la requête (mobile). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const fromCookie = readRefreshCookie(req, COMPANY_REFRESH_COOKIE);
    const token =
      fromCookie ?? (typeof body?.refreshToken === 'string' ? body.refreshToken : undefined);
    if (!token) throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    try {
      const { refreshToken, ...tokens } = await this.auth.refresh(token);
      if (fromCookie) {
        setRefreshCookie(res, COMPANY_REFRESH_COOKIE, refreshToken);
        return tokens;
      }
      return { ...tokens, refreshToken };
    } catch (error) {
      if (fromCookie) clearRefreshCookie(res, COMPANY_REFRESH_COOKIE);
      throw error;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, clientInfo(req));
    clearRefreshCookie(res, COMPANY_REFRESH_COOKIE);
  }

  @Post('auth/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ReturnType<typeof changePasswordSchema.parse>,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(user, body, clientInfo(req));
  }

  /** Association d'un téléphone (UC-01). */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/device/activate')
  @HttpCode(200)
  activate(
    @Body(new ZodValidationPipe(deviceActivateSchema))
    body: ReturnType<typeof deviceActivateSchema.parse>,
    @Req() req: Request,
  ): Promise<DeviceActivationResponse> {
    return this.auth.activateDevice(body, clientInfo(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/device/login')
  @HttpCode(200)
  deviceLogin(
    @Body(new ZodValidationPipe(deviceLoginSchema))
    body: ReturnType<typeof deviceLoginSchema.parse>,
    @Req() req: Request,
  ): Promise<AuthTokens> {
    return this.auth.deviceLogin(body, clientInfo(req));
  }

  /** Utilisateur, rôle, permissions effectives et modules actifs (docs/rbac.md §9). */
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.buildMe(user.userId, user.deviceId);
  }
}
