// Initialisation d'une base neuve : catalogue des permissions et premier Super Admin
// (docs/deployment.md, étape 11). Relançable : les permissions sont remises à jour, un compte existant
// n'est jamais modifié. Usage, depuis un poste, avec DATABASE_URL de la base visée :
//   pnpm --filter @sellwasl/api platform:bootstrap <email> ["Nom"]
// Le mot de passe est demandé deux fois, sans s'afficher.
import 'dotenv/config';
import { createInterface } from 'node:readline';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS } from '@sellwasl/business-rules';
import { newPasswordSchema } from '@sellwasl/validation';
import { z } from 'zod';
import { hashPassword } from '../src/auth/passwords';
import { uuidv7 } from '../src/common/uuid';
import { PrismaClient } from '../src/generated/prisma/client';

type Db = Pick<PrismaClient, 'permission' | 'platformUser'>;

const emailSchema = z.email('E-mail invalide');

/** Catalogue des permissions (docs/rbac.md §4) : ajoutées ou remises à jour. */
export async function syncPermissions(db: Pick<PrismaClient, 'permission'>): Promise<number> {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, scope: p.scope },
      create: { code: p.code, description: p.description, scope: p.scope },
    });
  }
  return PERMISSIONS.length;
}

/**
 * Compte à créer ou déjà présent. Refuse quand la plateforme a déjà un autre compte : le script
 * ne crée que le premier Super Admin.
 */
export async function accountState(db: Db, rawEmail: string): Promise<'NEW' | 'EXISTS'> {
  const email = normalizeEmail(rawEmail);
  if (await db.platformUser.findUnique({ where: { email } })) return 'EXISTS';
  if ((await db.platformUser.count()) > 0) {
    throw new Error(
      'La plateforme a déjà un compte : ce script ne crée que le premier Super Admin.',
    );
  }
  return 'NEW';
}

function normalizeEmail(raw: string): string {
  const parsed = emailSchema.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) throw new Error('E-mail invalide.');
  return parsed.data;
}

/** Permissions, puis Super Admin s'il n'existe pas. À lancer dans une transaction. */
export async function bootstrapPlatform(
  db: Db,
  input: { email: string; name: string; password?: string },
): Promise<{ permissions: number; account: 'CREATED' | 'EXISTS' }> {
  const email = normalizeEmail(input.email);
  const state = await accountState(db, email);
  if (state === 'NEW') {
    if (!input.password) throw new Error('Mot de passe obligatoire pour créer le compte.');
    const checked = newPasswordSchema.safeParse(input.password);
    if (!checked.success) throw new Error(checked.error.issues.map((i) => i.message).join(', '));
  }
  const permissions = await syncPermissions(db);
  if (state === 'EXISTS') return { permissions, account: 'EXISTS' };
  await db.platformUser.create({
    data: {
      id: uuidv7(),
      email,
      name: input.name.trim().slice(0, 120) || 'Super Admin',
      passwordHash: await hashPassword(input.password!),
    },
  });
  return { permissions, account: 'CREATED' };
}

const INTERRUPTED = 'Saisie interrompue : rien n’a été créé.';

/**
 * Saisie masquée : rien ne s'affiche pendant la frappe. Les lignes sont mises en file, pour que
 * deux réponses reçues d'un bloc ne se perdent pas ; une fin de saisie est une erreur.
 */
export function hiddenPrompt(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
) {
  const terminal = (input as { isTTY?: boolean }).isTTY === true;
  const rl = createInterface({ input, output, terminal });
  // Au clavier, readline réaffiche la frappe : cet affichage est coupé
  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => undefined;
  const lines: string[] = [];
  let waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (!waiting) return void lines.push(line);
    const { resolve } = waiting;
    waiting = null;
    resolve(line);
  });
  rl.on('close', () => {
    closed = true;
    waiting?.reject(new Error(INTERRUPTED));
    waiting = null;
  });
  return {
    ask: async (question: string): Promise<string> => {
      output.write(question);
      const next = lines.shift();
      const answer =
        next ??
        (closed
          ? Promise.reject(new Error(INTERRUPTED))
          : new Promise<string>((resolve, reject) => (waiting = { resolve, reject })));
      try {
        return await answer;
      } finally {
        output.write('\n');
      }
    },
    close: () => rl.close(),
  };
}

async function main(): Promise<void> {
  const [email, name = 'Super Admin'] = process.argv.slice(2);
  if (!email) throw new Error('Usage : platform:bootstrap <email> ["Nom"]');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    let password: string | undefined;
    if ((await accountState(prisma, email)) === 'NEW') {
      console.log('Mot de passe du Super Admin : 8 caractères au moins, une lettre et un chiffre');
      console.log('(12 caractères ou plus conseillés). Rien ne s’affiche pendant la saisie.');
      const prompt = hiddenPrompt();
      try {
        password = await prompt.ask('Mot de passe : ');
        if ((await prompt.ask('Confirmez : ')) !== password)
          throw new Error('Les deux saisies sont différentes : rien n’a été créé.');
      } finally {
        prompt.close();
      }
    }
    const result = await prisma.$transaction((tx) =>
      bootstrapPlatform(tx, { email, name, password }),
    );
    console.log(`✔ ${result.permissions} permissions à jour.`);
    if (result.account === 'EXISTS') {
      console.log(`✔ Compte ${email} déjà présent : inchangé.`);
      return;
    }
    console.log(`✔ Super Admin créé : ${email.trim().toLowerCase()}`);
    console.log('Ensuite (docs/deployment.md, étape 12) :');
    console.log('  1. PLATFORM_ALLOWED_IPS : votre adresse IP, sur l’API et sur le Web ;');
    console.log('  2. /admin/login : e-mail et mot de passe ;');
    console.log('  3. scannez le QR code avec une application d’authentification, puis saisissez');
    console.log('     le code à 6 chiffres.');
  } finally {
    await prisma.$disconnect();
  }
}

// Lancé en ligne de commande (pas importé par un test)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/bootstrap-platform.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
