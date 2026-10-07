import { testDatabaseUrl } from './test-database';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();

// Push : envoi en mémoire, sans envoi automatique (les tests appellent dispatch())
process.env.PUSH_PROVIDER = 'memory';
process.env.PUSH_AUTO = 'off';
