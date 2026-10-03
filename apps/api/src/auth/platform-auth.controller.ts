import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthTokens,
  platformLoginSchema,
  type PlatformMeResponse,
} from '@sellwasl/validation';
import type { Request, Response } from 'express';
import { ApiError, unauthorized } from '../common/api-error';
import {
  CurrentPlatformUser,
  type PlatformPrincipal,
  PlatformOnly,
  Public,
} from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  clearRefreshCookie,
  clientInfo,
  PLATFORM_REFRESH_COOKIE,
  readRefreshCookie,
  setRefreshCookie,
} from './cookies';
import { verifyPassword } from './passwords';
import { TokensService } from './tokens.service';

/** Connexion séparée du Super Admin (docs/api.md §4). */
@Controller('platform')
export class PlatformAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(platformLoginSchema))
    body: ReturnType<typeof platformLoginSchema.parse>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const user = await this.prisma.platformUser.findUnique({ where: { email: body.email } });
    const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
    if (!ok || !user || user.status !== 'ACTIVE') {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Email ou mot de passe incorrect.',
      );
    }
    const client = clientInfo(req);
    const { refreshToken, ...tokens } = await this.tokens.openPlatformSession(
      user.id,
      client.ip,
      client.userAgent,
    );
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    setRefreshCookie(res, PLATFORM_REFRESH_COOKIE, refreshToken);
    return tokens;
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const token = readRefreshCookie(req, PLATFORM_REFRESH_COOKIE);
    if (!token) throw unauthorized('SESSION_EXPIRED', 'Session expirée. Reconnectez-vous.');
    try {
      const { refreshToken, ...tokens } = await this.tokens.rotatePlatform(token);
      setRefreshCookie(res, PLATFORM_REFRESH_COOKIE, refreshToken);
      return tokens;
    } catch (error) {
      clearRefreshCookie(res, PLATFORM_REFRESH_COOKIE);
      throw error;
    }
  }

  @PlatformOnly()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentPlatformUser() principal: PlatformPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.tokens.revokePlatformSession(principal.sessionId);
    clearRefreshCookie(res, PLATFORM_REFRESH_COOKIE);
  }

  @PlatformOnly()
  @Get('me')
  async me(@CurrentPlatformUser() principal: PlatformPrincipal): Promise<PlatformMeResponse> {
    const user = await this.prisma.platformUser.findUniqueOrThrow({
      where: { id: principal.platformUserId },
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
