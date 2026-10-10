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
import { DataCipher } from '../common/crypto';
import { LockoutService } from './lockout.service';
import { verifyPassword } from './passwords';
import { generateSecret, otpauthUri, verifyTotp } from './totp';
import { TokensService } from './tokens.service';

/** Connexion séparée du Super Admin (docs/api.md §4). */
@Controller('platform')
export class PlatformAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly lockout: LockoutService,
    private readonly cipher: DataCipher,
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
    this.lockout.assertNotLocked(user);
    const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
    if (user && !ok) await this.lockout.platformFailed(user.id);
    if (!ok || !user || user.status !== 'ACTIVE') {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Email ou mot de passe incorrect.',
      );
    }
    await this.secondFactor(user, body.code);
    await this.lockout.platformSucceeded(user);
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

  /**
   * Deuxième facteur (phase 27), après le mot de passe. Pas encore enrôlé : renvoie le secret et
   * l'URI du QR code (le même tant que l'enrôlement n'est pas confirmé) ; le premier code juste
   * confirme l'enrôlement. Un code faux compte comme un échec de connexion (blocage).
   */
  private async secondFactor(
    user: {
      id: string;
      email: string;
      totpSecret: string | null;
      totpEnabledAt: Date | null;
      totpLastStep: number | null;
    },
    code: string | undefined,
  ): Promise<void> {
    let secret = user.totpSecret ? this.cipher.decrypt(user.totpSecret) : null;
    if (!user.totpEnabledAt && !secret) {
      secret = generateSecret();
      await this.prisma.platformUser.update({
        where: { id: user.id },
        data: { totpSecret: this.cipher.encrypt(secret) },
      });
    }
    if (!code) {
      if (user.totpEnabledAt)
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'TOTP_REQUIRED',
          "Saisissez le code à 6 chiffres de votre application d'authentification.",
        );
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'TOTP_SETUP',
        "Scannez le QR code avec une application d'authentification, puis saisissez le code affiché.",
        { secret, otpauthUri: otpauthUri(user.email, secret!) },
      );
    }
    const step = verifyTotp(secret!, code, Date.now(), user.totpLastStep);
    if (step === null) {
      await this.lockout.platformFailed(user.id);
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'TOTP_INVALID',
        'Code incorrect ou déjà utilisé.',
      );
    }
    // Pas consommé de façon atomique : deux requêtes avec le même code, une seule passe
    const { count } = await this.prisma.platformUser.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
      },
      data: { totpLastStep: step, ...(user.totpEnabledAt ? {} : { totpEnabledAt: new Date() }) },
    });
    if (count === 0)
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'TOTP_INVALID',
        'Code incorrect ou déjà utilisé.',
      );
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
