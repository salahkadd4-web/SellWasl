// Web (Next.js) : configuration officielle de Next.js (Core Web Vitals, React, hooks,
// accessibilité, TypeScript) et règles communes.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { ignores, react, shared } from './base.js';

export default [ignores, ...nextVitals, ...nextTs, shared, react];
