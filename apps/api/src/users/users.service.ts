import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isRoleAvailable, type RoleCode } from '@sellwasl/business-rules';
import type {
  CompanyUser,
  CreateUserInput,
  TemporaryPasswordResponse,
  UpdateUserInput,
} from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { hashPassword, temporaryPassword } from '../auth/passwords';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const userInclude = { role: true } as const;
type UserWithRole = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const rule = (message: string, rule?: string) =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BUSINESS_RULE',
    message,
    rule ? { rule } : undefined,
  );
const duplicate = (field: string, message: string) =>
  new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', message, { field });

function toDto(u: UserWithRole): CompanyUser {
  return {
    id: u.id,
    version: u.version,
    code: u.code,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    email: u.email,
    role: { code: u.role.code, name: u.role.name, channel: u.role.channel },
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

/** Utilisateurs de l'entreprise (UC-80, BR-USR-01, BR-USR-10). */
@Injectable()
export class UsersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CompanyUser[]> {
    const users = await this.db.user.findMany({
      where: { deletedAt: null },
      include: userInclude,
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
    return users.map(toDto);
  }

  async roles(actor: AuthUser) {
    const roles = await this.db.role.findMany({ orderBy: { code: 'asc' } });
    return roles.map((r) => ({
      code: r.code,
      name: r.name,
      channel: r.channel,
      available: isRoleAvailable(r.code, actor.modules),
    }));
  }

  async create(
    actor: AuthUser,
    input: CreateUserInput & { code: string; role: RoleCode },
  ): Promise<TemporaryPasswordResponse> {
    await this.assertUnique(input.code, input.email);
    const role = await this.roleFor(actor, input.role);
    const password = temporaryPassword();
    const user = await this.db.user.create({
      data: {
        id: uuidv7(),
        companyId: actor.companyId,
        roleId: role.id,
        code: input.code,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        createdByUserId: actor.userId,
      },
      include: userInclude,
    });
    await this.log(actor, 'user.create', user.id, undefined, { code: user.code, role: role.code });
    return { user: toDto(user), temporaryPassword: password };
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput): Promise<CompanyUser> {
    const user = await this.find(id);
    if (input.code !== undefined || input.email !== undefined)
      await this.assertUnique(input.code, input.email, id);

    let roleId: string | undefined;
    let channelChanged = false;
    if (input.role && input.role !== user.role.code) {
      if (id === actor.userId) throw rule('Vous ne pouvez pas changer votre propre rôle.');
      if (user.role.code === 'COMPANY_ADMIN') await this.assertAnotherAdmin(id);
      const role = await this.roleFor(actor, input.role as RoleCode);
      roleId = role.id;
      channelChanged = role.channel !== user.role.channel;
    }

    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id },
        data: {
          code: input.code,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone === undefined ? undefined : (input.phone ?? null),
          email: input.email === undefined ? undefined : (input.email ?? null),
          roleId,
        },
        include: userInclude,
      });
      if (roleId) {
        // Nouveau rôle : nouvelles permissions à la prochaine connexion.
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ROLE_CHANGED' },
        });
        if (channelChanged && next.role.channel === 'WEB') {
          await tx.device.updateMany({
            where: { userId: id, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
        }
      }
      return next;
    });
    await this.log(
      actor,
      'user.update',
      id,
      { code: user.code, role: user.role.code },
      { code: updated.code, role: updated.role.code },
    );
    return toDto(updated);
  }

  /** Désactivation : plus de connexion possible ; l'historique est conservé. */
  async setStatus(
    actor: AuthUser,
    id: string,
    status: 'ACTIVE' | 'DISABLED',
  ): Promise<CompanyUser> {
    const user = await this.find(id);
    if (status === 'DISABLED') {
      if (id === actor.userId) throw rule('Vous ne pouvez pas désactiver votre propre compte.');
      if (user.role.code === 'COMPANY_ADMIN') await this.assertAnotherAdmin(id);
    }
    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.user.update({ where: { id }, data: { status }, include: userInclude });
      if (status === 'DISABLED') {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DISABLED' },
        });
      }
      return next;
    });
    await this.log(
      actor,
      status === 'DISABLED' ? 'user.disable' : 'user.enable',
      id,
      { status: user.status },
      { status },
    );
    return toDto(updated);
  }

  /** Mot de passe provisoire, à changer à la prochaine connexion ; les sessions sont fermées. */
  async resetPassword(actor: AuthUser, id: string): Promise<TemporaryPasswordResponse> {
    await this.find(id);
    const password = temporaryPassword();
    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: true },
        include: userInclude,
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
      return next;
    });
    await this.log(actor, 'user.password.reset', id);
    return { user: toDto(updated), temporaryPassword: password };
  }

  private async find(id: string): Promise<UserWithRole> {
    const user = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      include: userInclude,
    });
    if (!user) throw notFound('Utilisateur introuvable.');
    return user;
  }

  private async roleFor(actor: AuthUser, code: RoleCode) {
    const role = await this.db.role.findFirst({ where: { code } });
    if (!role) throw notFound('Rôle introuvable.');
    if (!isRoleAvailable(code, actor.modules)) {
      throw rule(
        "Ce rôle n'est pas disponible avec les modules de l'entreprise.",
        'docs/modules.md §5',
      );
    }
    return role;
  }

  /** Codes et emails uniques dans l'entreprise, sans tenir compte des majuscules (BR-USR-10). */
  private async assertUnique(
    code: string | undefined,
    email: string | undefined,
    excludeId?: string,
  ): Promise<void> {
    const not = excludeId ? { id: { not: excludeId } } : {};
    if (
      code &&
      (await this.db.user.findFirst({
        where: { ...not, code: { equals: code, mode: 'insensitive' } },
      }))
    ) {
      throw duplicate('code', 'Ce code est déjà utilisé.');
    }
    if (
      email &&
      (await this.db.user.findFirst({
        where: { ...not, email: { equals: email, mode: 'insensitive' } },
      }))
    ) {
      throw duplicate('email', 'Cet email est déjà utilisé.');
    }
  }

  /** L'entreprise garde toujours au moins un administrateur actif. */
  private async assertAnotherAdmin(excludeId: string): Promise<void> {
    const others = await this.db.user.count({
      where: {
        id: { not: excludeId },
        status: 'ACTIVE',
        deletedAt: null,
        role: { code: 'COMPANY_ADMIN' },
      },
    });
    if (others === 0) throw rule("L'entreprise doit garder au moins un administrateur actif.");
  }

  private log(
    actor: AuthUser,
    action: string,
    entityId: string,
    before?: Prisma.InputJsonValue,
    after?: Prisma.InputJsonValue,
  ) {
    return this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action,
      entity: 'User',
      entityId,
      before,
      after,
    });
  }
}
