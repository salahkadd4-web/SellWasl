// Téléphone du Super Admin perdu : efface son deuxième facteur (phase 27, docs/security.md).
// Usage, sur le serveur : pnpm --filter @sellwasl/api platform:reset-2fa <email>
// À la connexion suivante, l'écran propose un nouvel enrôlement (QR code).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

type Client = Pick<PrismaClient, 'platformUser'>;

export async function resetPlatformTwoFactor(prisma: Client, email: string): Promise<void> {
  await prisma.platformUser.update({
    where: { email: email.trim().toLowerCase() },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('Usage : platform:reset-2fa <email>');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    await resetPlatformTwoFactor(prisma, email);
    console.log(
      `Deuxième facteur effacé pour ${email} : nouvel enrôlement à la prochaine connexion.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Lancé en ligne de commande (pas importé par un test)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/reset-platform-2fa.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
