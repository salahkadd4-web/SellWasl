import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC conserve les métadonnées de décorateurs dont NestJS a besoin pour l'injection.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Couverture mesurée à chaque lancement ; seuils un peu sous le niveau atteint (phase 28)
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/main.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 87, branches: 72, functions: 90, lines: 89 },
    },
  },
});
