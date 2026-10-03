import 'dotenv/config';

/** Base de test séparée : même serveur que DATABASE_URL, base « <nom>_test ». */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://sellwasl:sellwasl@localhost:5433/sellwasl',
  );
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return url.toString();
}
