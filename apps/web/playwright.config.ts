import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout du Web (phase 28, docs/testing.md) : l'API compilée sur une base
 * dédiée (recréée et semée à chaque lancement) et le Web sur des ports à part.
 */
const API_PORT = 3101;
const WEB_PORT = 3100;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://sellwasl:sellwasl@localhost:5433/sellwasl_e2e';

export default defineConfig({
  testDir: 'e2e',
  // Une seule base partagée : les parcours passent l'un après l'autre
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Africa/Algiers',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/prepare-db.mjs && node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL,
        API_PORT: String(API_PORT),
        NODE_ENV: 'test',
        // Chaque connexion des parcours présente sa propre IP (fixtures.ts)
        TRUST_PROXY: '1',
        PUSH_PROVIDER: 'memory',
        PUSH_AUTO: 'off',
        STORAGE_DIR: '../api/storage',
      },
    },
    {
      // Compilé en production (pages prêtes, pas de compilation à la première visite) ; l'adresse
      // de l'API est figée dans la compilation, d'où un dossier à part
      command: `npx next build && npx next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/app/login`,
      timeout: 600_000,
      reuseExistingServer: false,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
        NEXT_DIST_DIR: '.next-e2e',
        // Espace plateforme : seule l'adresse transmise par le « proxy » du parcours est admise
        PLATFORM_ALLOWED_IPS: '127.0.0.1',
        TRUST_PROXY: '1',
      },
    },
  ],
});
