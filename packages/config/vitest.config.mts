import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Couverture mesurée à chaque lancement ; seuils un peu sous le niveau atteint (fonds de carte)
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 80, branches: 95, functions: 95, lines: 80 },
    },
  },
});
