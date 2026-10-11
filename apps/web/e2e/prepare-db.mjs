// Base des parcours Playwright (phase 28) : recréée, migrée et semée avant le démarrage de l'API.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
const database = url.pathname.slice(1);
if (!database.endsWith('_e2e')) throw new Error(`Base des parcours refusée : ${database}`);

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
await client.query(`CREATE DATABASE "${database}"`);
await client.end();

const api = fileURLToPath(new URL('../../api', import.meta.url));
const env = { ...process.env, DATABASE_URL: url.toString() };
execSync('npx prisma migrate deploy', { cwd: api, env, stdio: 'ignore' });
execSync('npx tsx prisma/seed.ts', { cwd: api, env, stdio: 'ignore' });
console.log(`Base ${database} prête.`);
