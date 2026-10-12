// Configuration ESLint commune (phase 29, docs/ci-cd.md) : règles recommandées de JavaScript et de
// TypeScript, sans analyse de types (rapide ; les types sont vérifiés par `pnpm typecheck`).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Dossiers produits par les outils : jamais analysés. */
export const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.next-e2e/**',
    '**/.expo/**',
    '**/android/**',
    '**/ios/**',
    '**/generated/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/next-env.d.ts',
  ],
};

/** Règles ajoutées à toutes les configurations. */
export const shared = {
  files: ['**/*.{ts,tsx,mts,cts}'],
  rules: {
    // `_` en tête : paramètre ou variable volontairement inutilisé
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
};

/** Web et mobile : règles React ajustées. */
export const react = {
  rules: {
    // Le texte affiché est en français : les apostrophes y sont voulues. Seuls `>` et `}` restent
    // signalés (le plus souvent une balise ou une accolade mal fermée).
    'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
    // Règles écrites pour le React Compiler, que le projet n'utilise pas : elles refusent des usages
    // courants et sûrs (chargement dans un effet, `useRef(new Animated.Value(0)).current`,
    // `Date.now()` dans un gestionnaire). Les règles des hooks et des dépendances restent actives.
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/refs': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
  },
};

export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  shared,
);
