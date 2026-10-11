import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests de composants et d'utilitaires du Web (phase 28) ; les parcours sont dans e2e/ (Playwright).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    // Saisie simulée caractère par caractère : lente sous jsdom au premier test
    testTimeout: 20_000,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'html'],
      // Seuils bas : les pages et les grands composants sont couverts par les parcours Playwright
      thresholds: { statements: 13, branches: 10, functions: 9, lines: 14 },
    },
  },
});
