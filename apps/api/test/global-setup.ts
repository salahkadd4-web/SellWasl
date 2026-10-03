import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { testDatabaseUrl } from './test-database';

/** Recrée la base de test, applique les migrations et charge les données de démonstration. */
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const database = url.pathname.slice(1);
  if (!database.endsWith('_test')) throw new Error(`Base de test refusée : ${database}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${database}"`);
  await client.end();

  const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' };
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
}
