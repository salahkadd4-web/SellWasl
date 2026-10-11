import { describe, expect, it } from 'vitest';
import {
  auditFiltersSchema,
  changePasswordSchema,
  companySettingsSchema,
  createCustomerSchema,
  newPasswordSchema,
  ordersQuerySchema,
  platformLoginSchema,
} from './index';

/** Schémas partagés par l'API, le Web et le mobile (phase 28). */
describe('mots de passe (phase 27)', () => {
  it('8 caractères, une lettre et un chiffre', () => {
    expect(newPasswordSchema.safeParse('Solide2026').success).toBe(true);
    expect(newPasswordSchema.safeParse('Éèà12345').success).toBe(true);
    for (const weak of ['Ab1', 'abcdefgh', '12345678', 'x'.repeat(201) + '1'])
      expect(newPasswordSchema.safeParse(weak).success, weak).toBe(false);
  });

  it('changement : la règle s’applique au nouveau mot de passe', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'ancien',
      newPassword: 'abc',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('newPassword');
  });

  it('code du deuxième facteur : 6 chiffres, facultatif', () => {
    const base = { email: 'Admin@SellWasl.test ', password: 'SellWasl@2026' };
    expect(platformLoginSchema.parse(base).email).toBe('admin@sellwasl.test');
    expect(platformLoginSchema.safeParse({ ...base, code: '123456' }).success).toBe(true);
    expect(platformLoginSchema.safeParse({ ...base, code: '12345' }).success).toBe(false);
    expect(platformLoginSchema.safeParse({ ...base, code: '12345a' }).success).toBe(false);
  });
});

describe('pagination et tri (phase 25)', () => {
  it('limite 50 par défaut, 200 au plus, tri parmi la liste de la route', () => {
    const q = ordersQuerySchema.parse({});
    expect(q).toMatchObject({ limit: 50, sort: '-orderDate' });
    expect(ordersQuerySchema.parse({ limit: '200', sort: 'totalAmount' }).limit).toBe(200);
    expect(ordersQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ sort: 'customerId' }).success).toBe(false);
    expect(ordersQuerySchema.safeParse({ sort: '--orderDate' }).success).toBe(false);
  });
});

describe('journal d’audit (phase 26)', () => {
  it('filtres : action et fiche du catalogue, dates au format AAAA-MM-JJ', () => {
    expect(auditFiltersSchema.safeParse({ action: 'auth.login', entity: 'User' }).success).toBe(
      true,
    );
    expect(auditFiltersSchema.safeParse({ action: 'inconnue' }).success).toBe(false);
    expect(auditFiltersSchema.safeParse({ entity: 'Inconnue' }).success).toBe(false);
    expect(auditFiltersSchema.safeParse({ from: '11/10/2026' }).success).toBe(false);
    expect(auditFiltersSchema.safeParse({ userId: 'pas-un-uuid' }).success).toBe(false);
  });
});

describe('fiches', () => {
  const customer = {
    code: 'C-001',
    name: 'Épicerie Test',
    customerTypeId: '01a00000-0000-7000-8000-000000000000',
  };

  it('client : fréquence hebdomadaire et sans crédit par défaut', () => {
    const parsed = createCustomerSchema.parse(customer);
    expect(parsed).toMatchObject({
      frequency: 'WEEKLY',
      isCreditAllowed: false,
      creditLimitAmount: 0,
    });
  });

  it('client : position complète ou absente', () => {
    expect(createCustomerSchema.safeParse({ ...customer, latitude: 35.7 }).success).toBe(false);
    expect(
      createCustomerSchema.safeParse({ ...customer, latitude: 35.7, longitude: -0.6 }).success,
    ).toBe(true);
  });

  it('paramètres de l’entreprise : valeurs par défaut des règles réglables', () => {
    const settings = companySettingsSchema.parse({});
    expect(settings.workingDays).toEqual(['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU']);
    expect(settings.outOfZoneDistanceM).toBe(100);
    expect(settings.ticketWidthMm).toBe(58);
  });
});
