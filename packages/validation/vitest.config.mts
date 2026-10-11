import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Couverture mesurée à chaque lancement ; seuils un peu sous le niveau atteint (phase 28)
    // Branches et fonctions basses : les refine des schémas sont testés à travers l'API
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 82, branches: 4, functions: 24, lines: 85 },
    },
  },
});
