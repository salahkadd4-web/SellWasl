// Tests d'écrans du mobile (phase 28, docs/testing.md) : jest-expo et React Native Testing Library.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // pnpm range les paquets sous node_modules/.pnpm : ceux de React Native et d'Expo sont transformés
  transformIgnorePatterns: [
    'node_modules/(?!(?:\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sellwasl/.*))',
  ],
  collectCoverage: true,
  collectCoverageFrom: ['app/**/*.tsx', 'src/**/*.{ts,tsx}', '!**/*.d.ts'],
  coverageReporters: ['text-summary', 'html'],
  // Seuils un peu sous le niveau atteint (phase 28)
  coverageThreshold: { global: { statements: 18, branches: 17, functions: 16, lines: 19 } },
};
