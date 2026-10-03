import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthTokens,
  ChangePasswordInput,
  DeviceActivateInput,
  DeviceActivationResponse,
  DeviceLoginInput,
  MeResponse,
  WebLoginInput,
} from '@sellwasl/validation';
import { ApiError, forbidden, unauthorized } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_COMPANY_STATUSES } from './auth.guard';
import { hashPassword, verifyPassword } from './passwords';
import { TokensService } from './tokens.service';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

const invalidCredentials = () =>
  new ApiError(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    'Identifiant ou mot de passe incorrect.',
  );

/** Série d'un appareil : A, B… Z, puis AA, AB… (ARC-11). */
export function deviceSeries(index: number): string {
  let n = index;
  let series = '';
  do {
    series = String.fromCharCode(65 + (n % 26)) + series;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return series;
}

export const hashActivationCode = (code: string) => createHash('sha256').update(code).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /** Connexion Web : rôles Web uniquement (BR-USR-02). */
  async webLogin(input: WebLoginInput, client: ClientInfo): Promise<Required<AuthTokens>> {
    const company = await this.prisma.company.findUnique({ where: { code: input.companyCode } });
    const user = company
      ? await this.prisma.user.findFirst({
          where: {
            companyId: company.id,
            deletedAt: null,
            OR: [
              { code: { equals: input.login, mode: 'insensitive' } },
              { email: { equals: input.login, mode: 'insensitive' } },
            ],
          },
          include: { role: true },
        })
      : null;

    if (!(await verifyPassword(user?.passwordHash ?? null, input.password)) || !user || !company) {
      throw invalidCredentials();
    }
    this.assertCompanyActive(company.status);
    if (user.status !== 'ACTIVE') throw forbidden('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
    if (user.role.channel !== 'WEB') {
      throw forbidden('WRONG_CHANNEL', "Ce compte s'utilise sur l'application mobile.");
    }

    const tokens = await this.tokens.openSession({
      companyId: company.id,
      userId: user.id,
      deviceId: null,
      channel: 'WEB',
      ...client,
    });
    await this.afterLogin(company.id, user.id, null, 'auth.login', client);
    return tokens;
  }

  /**
   * Association d'un téléphone avec un code à usage unique (ARC-04, BR-USR-07) :
   * le nouvel appareil remplace l'ancien, qui est révoqué avec ses sessions.
   */
  async activateDevice(
    input: DeviceActivateInput & { code: string },
    client: ClientInfo,
  ): Promise<DeviceActivationResponse> {
    const activation = await this.prisma.deviceActivationCode.findUnique({
      where: { codeHash: hashActivationCode(input.code) },
      include: { user: { include: { role: true, company: true } } },
    });
    if (!activation || activation.usedAt || activation.expiresAt < new Date()) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_ACTIVATION_CODE',
        'Code invalide ou expiré. Demandez-en un nouveau.',
      );
    }
    const { user } = activation;
    if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();
    this.assertCompanyActive(user.company.status);
    if (user.status !== 'ACTIVE') throw forbidden('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
    if (user.role.channel !== 'MOBILE')
      throw forbidden('WRONG_CHANNEL', "Ce compte s'utilise sur le Web.");

    const deviceId = uuidv7();
    const device = await this.prisma.$transaction(async (tx) => {
      // Usage unique, même en cas de double envoi simultané
      const consumed = await tx.deviceActivationCode.updateMany({
        where: { id: activation.id, usedAt: null },
        data: { usedAt: new Date(), usedByDeviceId: null },
      });
      if (consumed.count === 0) {
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'INVALID_ACTIVATION_CODE',
          'Code déjà utilisé.',
        );
      }
      const previous = await tx.device.findMany({ where: { userId: user.id, status: 'ACTIVE' } });
      if (previous.length > 0) {
        await tx.device.updateMany({
          where: { id: { in: previous.map((d) => d.id) } },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
        await tx.session.updateMany({
          where: { deviceId: { in: previous.map((d) => d.id) }, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'DEVICE_REPLACED' },
        });
      }
      const count = await tx.device.count({ where: { userId: user.id } });
      const created = await tx.device.create({
        data: {
          id: deviceId,
          companyId: user.companyId,
          userId: user.id,
          series: deviceSeries(count),
          activatedAt: new Date(),
          name: input.device?.name,
          model: input.device?.model,
          osVersion: input.device?.osVersion,
          appVersion: input.device?.appVersion,
          lastSeenAt: new Date(),
        },
      });
      await tx.deviceActivationCode.update({
        where: { id: activation.id },
        data: { usedByDeviceId: deviceId },
      });
      await this.audit.write(
        {
          companyId: user.companyId,
          actorUserId: user.id,
          deviceId,
          action: 'device.activate',
          entity: 'Device',
          entityId: deviceId,
          after: { series: created.series, replaced: previous.map((d) => d.id) },
          ...client,
        },
        tx,
      );
      return created;
    });

    const tokens = await this.tokens.openSession({
      companyId: user.companyId,
      userId: user.id,
      deviceId: device.id,
      channel: 'MOBILE',
      ...client,
    });
    await this.afterLogin(user.companyId, user.id, device.id, 'auth.login', client);
    return {
      ...tokens,
      device: { id: device.id, series: device.series },
      me: await this.buildMe(user.id, device.id),
    };
  }

  /** Connexion sur l'appareil associé (BR-USR-06). */
  async deviceLogin(input: DeviceLoginInput, client: ClientInfo): Promise<Required<AuthTokens>> {
    const device = await this.prisma.device.findUnique({
      where: { id: input.deviceId },
      include: { user: { include: { role: true, company: true } } },
    });
    if (!device) throw unauthorized('DEVICE_UNKNOWN', 'Appareil inconnu. Associez-le de nouveau.');
    if (!(await verifyPassword(device.user.passwordHash, input.password)))
      throw invalidCredentials();
    if (device.status === 'BLOCKED')
      throw forbidden('DEVICE_BLOCKED', 'Appareil bloqué. Contactez votre superviseur.');
    if (device.status !== 'ACTIVE')
      throw forbidden('DEVICE_REVOKED', 'Appareil révoqué. Contactez votre superviseur.');
    this.assertCompanyActive(device.user.company.status);
    if (device.user.status !== 'ACTIVE')
      throw forbidden('ACCOUNT_DISABLED', 'Ce compte est désactivé.');

    const tokens = await this.tokens.openSession({
      companyId: device.companyId,
      userId: device.userId,
      deviceId: device.id,
      channel: 'MOBILE',
      ...client,
    });
    await this.afterLogin(device.companyId, device.userId, device.id, 'auth.login', client);
    return tokens;
  }

  /** Rafraîchissement : rotation du jeton, puis nouveaux contrôles du compte et de l'appareil. */
  async refresh(refreshToken: string): Promise<Required<AuthTokens>> {
    const result = await this.tokens.rotate(refreshToken);
    const sessionId = refreshToken.split('.')[0]!;
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { company: true, user: true, device: true },
    });
    const reason = !ACTIVE_COMPANY_STATUSES.includes(session.company.status as never)
      ? 'COMPANY_SUSPENDED'
      : session.user.status !== 'ACTIVE'
        ? 'ACCOUNT_DISABLED'
        : session.device && session.device.status !== 'ACTIVE'
          ? session.device.status === 'BLOCKED'
            ? 'DEVICE_BLOCKED'
            : 'DEVICE_REVOKED'
          : null;
    if (reason) {
      await this.tokens.revokeSession(sessionId, reason);
      throw forbidden(reason, 'Accès refusé. Contactez votre superviseur.');
    }
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      refreshToken: result.refreshToken,
    };
  }

  async logout(user: AuthUser, client: ClientInfo): Promise<void> {
    await this.tokens.revokeSession(user.sessionId, 'LOGOUT');
    await this.audit.write({
      companyId: user.companyId,
      actorUserId: user.userId,
      deviceId: user.deviceId,
      action: 'auth.logout',
      entity: 'Session',
      entityId: user.sessionId,
      ...client,
    });
  }

  async changePassword(
    user: AuthUser,
    input: ChangePasswordInput,
    client: ClientInfo,
  ): Promise<void> {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    if (!(await verifyPassword(current.passwordHash, input.currentPassword))) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PASSWORD',
        'Mot de passe actuel incorrect.',
      );
    }
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
    });
    // Les autres sessions de l'utilisateur sont fermées.
    await this.prisma.session.updateMany({
      where: { userId: user.userId, revokedAt: null, id: { not: user.sessionId } },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
    });
    await this.audit.write({
      companyId: user.companyId,
      actorUserId: user.userId,
      deviceId: user.deviceId,
      action: 'user.password.change',
      entity: 'User',
      entityId: user.userId,
      ...client,
    });
  }

  async buildMe(userId: string, deviceId: string | null): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        company: { include: { companyModules: { where: { status: 'ACTIVE' } } } },
        role: { include: { rolePermissions: true } },
      },
    });
    const device = deviceId
      ? await this.prisma.device.findUnique({ where: { id: deviceId } })
      : null;
    return {
      user: {
        id: user.id,
        code: user.code,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      company: {
        id: user.company.id,
        code: user.company.code,
        name: user.company.name,
        mode: user.company.mode,
      },
      role: { code: user.role.code, name: user.role.name, channel: user.role.channel },
      permissions: user.role.rolePermissions.map((p) => p.permissionCode).sort(),
      modules: user.company.companyModules.map((m) => m.moduleCode),
      device: device ? { id: device.id, series: device.series } : null,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private assertCompanyActive(status: string): void {
    if (!ACTIVE_COMPANY_STATUSES.includes(status as never)) {
      throw forbidden('COMPANY_SUSPENDED', "L'accès de votre entreprise est suspendu.");
    }
  }

  private async afterLogin(
    companyId: string,
    userId: string,
    deviceId: string | null,
    action: string,
    client: ClientInfo,
  ): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    if (deviceId)
      await this.prisma.device.update({
        where: { id: deviceId },
        data: { lastSeenAt: new Date() },
      });
    await this.audit.write({
      companyId,
      actorUserId: userId,
      deviceId,
      action,
      entity: 'User',
      entityId: userId,
      ...client,
    });
  }
}
