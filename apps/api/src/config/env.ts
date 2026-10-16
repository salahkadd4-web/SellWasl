import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-only-secret-change-me-in-production-0123456789';
/** Clé de chiffrement de développement (32 octets) : jamais en staging ni en production. */
const DEV_ENCRYPTION_KEY = Buffer.from('dev-only-encryption-key-32-bytes').toString('base64');
/** 32 octets en base64. */
const encryptionKey = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, '32 octets encodés en base64');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3001),
  /** Secret de signature des jetons d'accès. Obligatoire hors développement. */
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  /** Dossier des fichiers (imports CSV) en attendant le stockage objet S3 (architecture §13). */
  STORAGE_DIR: z.string().default('storage'),
  /**
   * Photos des produits sur Cloudinary : cloudinary://<clé>:<secret>@<cloud>. Absent : les photos
   * sont gardées dans STORAGE_DIR, sans redimensionnement (développement, tests).
   */
  /**
   * Nombre de proxys de confiance devant l'API (Caddy, répartiteur) : l'IP du client est lue dans
   * X-Forwarded-For. 0 : l'en-tête est ignoré (phase 27).
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Clé partagée avec le Web : l'adresse du client qu'il transmet n'est crue qu'avec elle
   * (docs/deployment.md, étape 13). Absente : seul TRUST_PROXY compte.
   */
  WEB_PROXY_SECRET: z.string().min(32, '32 caractères au moins').optional(),
  /** Clé AES-256 des données chiffrées en base (secrets TOTP) : 32 octets en base64. */
  DATA_ENCRYPTION_KEY: encryptionKey.optional(),
  /** Adresses ou plages CIDR autorisées à voir la plateforme, séparées par des virgules. */
  PLATFORM_ALLOWED_IPS: z.string().optional(),
  /** Erreurs envoyées à Sentry quand elle est renseignée. */
  SENTRY_DSN: z.string().url().optional(),
  CLOUDINARY_URL: z
    .string()
    .regex(/^cloudinary:\/\/[^:]+:[^@]+@[\w-]+$/, 'Format : cloudinary://<clé>:<secret>@<cloud>')
    .optional(),
});

export type Env = z.infer<typeof envSchema> & {
  JWT_ACCESS_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
};

/** Staging et production : aucune valeur de développement acceptée. */
export const isDeployed = (nodeEnv: string | undefined) =>
  nodeEnv === 'staging' || nodeEnv === 'production';

/** Variables d'environnement validées au démarrage : l'API refuse de démarrer si l'une manque. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuration invalide : ${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (isDeployed(env.NODE_ENV)) {
    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET === DEV_JWT_SECRET)
      throw new Error(
        'Configuration invalide : JWT_ACCESS_SECRET est obligatoire hors développement, et propre au serveur.',
      );
    if (!env.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY)
      throw new Error(
        'Configuration invalide : DATA_ENCRYPTION_KEY (32 octets en base64) est obligatoire hors développement.',
      );
  }
  return {
    ...env,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET,
    DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY ?? DEV_ENCRYPTION_KEY,
  };
}
