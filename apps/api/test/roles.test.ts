import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { RolesService } from '../src/roles/roles.service';
import { startApp, type TestApp } from './helpers';

/** Phase 6 : P-10 donne ou retire au superviseur la modification des prix (docs/rbac.md §7). */
describe('permissions qui dépendent des paramètres', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());

  it('applique puis retire P-10', async () => {
    const raw = t.app.get(PrismaService);
    const roles = t.app.get(RolesService);
    const company = await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    const supervisorPermissions = async () =>
      (
        await raw.rolePermission.findMany({
          where: { role: { companyId: company.id, code: 'SUPERVISEUR' } },
        })
      ).map((p) => p.permissionCode);

    await raw.$transaction((tx) =>
      roles.applyPermissions(tx, company.id, {
        P08_driverCollectsOldDebts: true,
        P10_supervisorEditsPrices: true,
      }),
    );
    expect(await supervisorPermissions()).toContain('prices.update');

    await raw.$transaction((tx) =>
      roles.applyPermissions(tx, company.id, {
        P08_driverCollectsOldDebts: true,
        P10_supervisorEditsPrices: false,
      }),
    );
    expect(await supervisorPermissions()).not.toContain('prices.update');
  });
});
