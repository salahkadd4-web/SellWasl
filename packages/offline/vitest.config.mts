import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Couverture mesurée à chaque lancement ; seuils un peu sous le niveau atteint (phase 28)
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 80, branches: 60, functions: 77, lines: 84 },
    },
  },
});
