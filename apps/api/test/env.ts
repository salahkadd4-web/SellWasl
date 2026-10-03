import { testDatabaseUrl } from './test-database';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
