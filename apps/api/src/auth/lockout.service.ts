import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

/** Échecs de mot de passe consécutifs avant blocage (architecture §16, phase 27). */
export const MAX_FAILED_LOGINS = 5;
/** Durée du blocage. */
export const LOCK_MS = 15 * 60_000;

interface Lockable {
  id: string;
  lockedUntil: Date | null;
  failedLoginCount: number;
}

const accountLocked = (until: Date) =>
  new ApiError(
    HttpStatus.FORBIDDEN,
    'ACCOUNT_LOCKED',
    "Compte bloqué 15 minutes après 5 mots de passe incorrects. Réessayez plus tard ou demandez une réinitialisation à l'administrateur.",
    { until: until.toISOString() },
  );

/**
 * Blocage temporaire des comptes contre la force brute : la limite par IP n'arrête pas un
 * attaquant qui change d'adresse, le compteur du compte si. Pendant le blocage, le mot de passe
 * n'est même pas vérifié : un essai juste ne se distingue pas d'un essai faux.
 */
@Injectable()
export class LockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Refuse un compte bloqué, avant toute vérification du mot de passe. */
  assertNotLocked(account: Lockable | null | undefined): void {
    if (account?.lockedUntil && account.lockedUntil > new Date())
      throw accountLocked(account.lockedUntil);
  }

  /** Mot de passe faux pour un compte de l'entreprise : compte, puis bloque au 5e échec. */
  async userFailed(userId: string): Promise<void> {
    const { failedLoginCount, companyId } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true, companyId: true },
    });
    if (failedLoginCount < MAX_FAILED_LOGINS) return;
    const until = new Date(Date.now() + LOCK_MS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: until },
    });
    await this.audit.write({
      companyId,
      actorUserId: null,
      action: 'auth.lockout',
      entity: 'User',
      entityId: userId,
      after: { lockedUntil: until.toISOString() },
    });
  }

  /** Connexion réussie : compteur remis à zéro. */
  async userSucceeded(account: Lockable): Promise<void> {
    if (account.failedLoginCount === 0 && !account.lockedUntil) return;
    await this.prisma.user.update({
      where: { id: account.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  async platformFailed(platformUserId: string): Promise<void> {
    const { failedLoginCount } = await this.prisma.platformUser.update({
      where: { id: platformUserId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount < MAX_FAILED_LOGINS) return;
    await this.prisma.platformUser.update({
      where: { id: platformUserId },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
    });
  }

  async platformSucceeded(account: Lockable): Promise<void> {
    if (account.failedLoginCount === 0 && !account.lockedUntil) return;
    await this.prisma.platformUser.update({
      where: { id: account.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }
}
