import { verify } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS } from '@sellwasl/business-rules';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapPlatform, hiddenPrompt } from '../scripts/bootstrap-platform';
import { uuidv7 } from '../src/common/uuid';
import { type Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PLATFORM_EMAIL } from './helpers';

class Rollback extends Error {}

/** Initialisation de production : permissions et premier Super Admin (docs/deployment.md, étape 11). */
describe('initialisation de la plateforme', () => {
  const prisma = new PrismaClient({
    // Base de test : DATABASE_URL est déjà celle de la suite (test/env.ts)
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  // Les autres suites écrivent dans l'audit plateforme : il n'est jamais vide quand ce test tourne
  beforeAll(async () => {
    await prisma.platformAuditLog.create({
      data: { id: uuidv7(), action: 'test.bootstrap', entity: 'PlatformUser' },
    });
  });
  afterAll(() => prisma.$disconnect());

  /** Base neuve simulée : les comptes plateforme sont retirés, puis tout est annulé. */
  async function onFreshPlatform(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
    await expect(
      prisma.$transaction(async (tx) => {
        // L'audit plateforme est en ajout seul (déclencheur) et sans lien vers le compte : il reste
        await tx.platformSession.deleteMany();
        await tx.platformUser.deleteMany();
        await tx.permission.updateMany({ data: { description: 'ancienne' } });
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  it('crée le premier Super Admin et met le catalogue des permissions à jour', async () => {
    await onFreshPlatform(async (tx) => {
      const result = await bootstrapPlatform(tx, {
        email: '  Owner@SellWasl.dz ',
        name: 'Salah',
        password: 'Solide2026x',
      });
      expect(result).toEqual({ permissions: PERMISSIONS.length, account: 'CREATED' });
      const user = await tx.platformUser.findUniqueOrThrow({
        where: { email: 'owner@sellwasl.dz' },
      });
      expect(user).toMatchObject({ name: 'Salah', role: 'SUPER_ADMIN', status: 'ACTIVE' });
      expect(user.totpSecret).toBeNull();
      expect(await verify(user.passwordHash, 'Solide2026x')).toBe(true);
      const roles = await tx.permission.findUniqueOrThrow({ where: { code: 'roles.manage' } });
      expect(roles.description).toBe('Régler les permissions du superviseur');
    });
  });

  it('refuse un mot de passe faible ou absent, sans rien créer', async () => {
    await onFreshPlatform(async (tx) => {
      await expect(
        bootstrapPlatform(tx, { email: 'owner@sellwasl.dz', name: 'Salah', password: 'court1' }),
      ).rejects.toThrow('Au moins 8 caractères');
      await expect(
        bootstrapPlatform(tx, {
          email: 'owner@sellwasl.dz',
          name: 'Salah',
          password: 'sanschiffre',
        }),
      ).rejects.toThrow('Au moins un chiffre');
      await expect(
        bootstrapPlatform(tx, { email: 'owner@sellwasl.dz', name: 'Salah' }),
      ).rejects.toThrow('Mot de passe');
      await expect(
        bootstrapPlatform(tx, { email: 'pas-un-email', name: 'Salah', password: 'Solide2026x' }),
      ).rejects.toThrow('E-mail invalide');
      expect(await tx.platformUser.count()).toBe(0);
    });
  });

  it('relancé : le compte existant n’est pas touché, les permissions sont remises à jour', async () => {
    const before = await prisma.platformUser.findUniqueOrThrow({
      where: { email: PLATFORM_EMAIL },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        const result = await bootstrapPlatform(tx, {
          email: PLATFORM_EMAIL,
          name: 'Autre nom',
          password: 'Nouveau2026x',
        });
        expect(result).toEqual({ permissions: PERMISSIONS.length, account: 'EXISTS' });
        const after = await tx.platformUser.findUniqueOrThrow({ where: { email: PLATFORM_EMAIL } });
        expect(after.passwordHash).toBe(before.passwordHash);
        expect(after.name).toBe(before.name);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it('refuse de créer un second compte quand la plateforme en a déjà un', async () => {
    await expect(
      bootstrapPlatform(prisma, {
        email: 'second@sellwasl.dz',
        name: 'Second',
        password: 'Solide2026x',
      }),
    ).rejects.toThrow('déjà un compte');
    expect(await prisma.platformUser.count({ where: { email: 'second@sellwasl.dz' } })).toBe(0);
  });

  it('lit les deux saisies même reçues d’un bloc, sans les afficher', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompt = hiddenPrompt(input, output);
    input.write('Solide2026x\nSolide2026x\n');
    expect(await prompt.ask('Mot de passe : ')).toBe('Solide2026x');
    expect(await prompt.ask('Confirmez : ')).toBe('Solide2026x');
    prompt.close();
    expect(String(output.read() ?? '')).not.toContain('Solide2026x');
  });

  it('saisie interrompue : erreur, pas de fin silencieuse', async () => {
    const input = new PassThrough();
    const prompt = hiddenPrompt(input, new PassThrough());
    input.end();
    await expect(prompt.ask('Mot de passe : ')).rejects.toThrow('Saisie interrompue');
  });
});
