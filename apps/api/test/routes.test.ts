import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANY_AUTHENTICATED,
  IS_PLATFORM,
  IS_PUBLIC,
  MODULE,
  PERMISSION,
} from '../src/common/auth-context';
import { permissionDefinition } from '@sellwasl/business-rules';
import { startApp, type TestApp } from './helpers';

/** Phase 6 : aucune route n'est ouverte par oubli (docs/rbac.md §1, §10). */
describe('couverture des routes', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());

  it('chaque route est @Public, @PlatformOnly, @AnyAuthenticated ou déclare une permission connue', () => {
    const routes: string[] = [];
    const missing: string[] = [];
    for (const module of t.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
        if (!controller) continue;
        const proto = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          const label = `${method} ${controller.name}.${name}`;
          routes.push(label);
          const meta = (key: string) =>
            Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
          const permission = meta(PERMISSION) as string | undefined;
          if (permission && !permissionDefinition(permission))
            missing.push(`${label} : permission inconnue ${permission}`);
          if (
            !meta(IS_PUBLIC) &&
            !meta(IS_PLATFORM) &&
            !meta(ANY_AUTHENTICATED) &&
            !permission &&
            !meta(MODULE)
          ) {
            missing.push(label);
          }
        }
      }
    }
    expect(routes.length).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });

  it('seuls les fichiers autorisés utilisent le client Prisma non filtré', () => {
    // Authentification, plateforme et tâches système : avant ou au-dessus de l'entreprise (architecture §6).
    const allowed = new Set([
      'app.module.ts',
      'audit/audit.service.ts',
      'auth/auth.guard.ts',
      'auth/auth.service.ts',
      'auth/platform-auth.controller.ts',
      'auth/tokens.service.ts',
      'health/health.controller.ts',
      'modules/modules.service.ts',
      'platform/platform-companies.controller.ts',
      'prisma/prisma.module.ts',
      'prisma/prisma.service.ts',
      'tenancy/tenancy.module.ts',
      'tenancy/tenant-prisma.ts',
    ]);
    const root = join(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') walk(path);
        } else if (path.endsWith('.ts')) {
          const rel = path.slice(root.length + 1).replace(/\\/g, '/'); // chemins Windows
          if (readFileSync(path, 'utf8').includes('PrismaService') && !allowed.has(rel))
            offenders.push(rel);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
