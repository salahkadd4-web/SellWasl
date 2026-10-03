import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-only-secret-change-me-in-production-0123456789';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3001),
  /** Secret de signature des jetons d'accès. Obligatoire hors développement. */
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  /** Dossier des fichiers (imports CSV) en attendant le stockage objet S3 (architecture §13). */
  STORAGE_DIR: z.string().default('storage'),
});

export type Env = z.infer<typeof envSchema> & { JWT_ACCESS_SECRET: string };

/** Variables d'environnement validées au démarrage : l'API refuse de démarrer si l'une manque. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuration invalide : ${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (!env.JWT_ACCESS_SECRET && ['staging', 'production'].includes(env.NODE_ENV)) {
    throw new Error(
      'Configuration invalide : JWT_ACCESS_SECRET est obligatoire hors développement.',
    );
  }
  return { ...env, JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET };
}
