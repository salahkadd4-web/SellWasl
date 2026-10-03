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
  },
});
