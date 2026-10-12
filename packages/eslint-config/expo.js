// Mobile (Expo) : configuration officielle d'Expo (React, hooks, imports, TypeScript) et règles
// communes.
import expoConfig from 'eslint-config-expo/flat.js';
import { ignores, react, shared } from './base.js';

export default [ignores, ...expoConfig, shared, react];
