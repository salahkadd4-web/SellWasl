import { test as base, expect } from '@playwright/test';

/** API des parcours (playwright.config.ts). */
export const API_URL = 'http://localhost:3101';
let attempt = 0;

/**
 * - Aucun appel hors de la machine (tuiles de carte, polices…) : les parcours ne dépendent pas
 *   d'Internet.
 * - `account` : session ouverte par l'API avant le test, une par test. Le jeton de
 *   rafraîchissement est renouvelé à chaque usage (un jeton rejoué révoque la session) : une
 *   session enregistrée ne peut pas servir à plusieurs tests.
 */
export const test = base.extend<{ noInternet: void; account: string | null; session: void }>({
  noInternet: [
    async ({ context }, use) => {
      await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
      await use();
    },
    { auto: true },
  ],
  account: [null, { option: true }],
  session: [
    async ({ account, context }, use) => {
      if (account) {
        attempt += 1;
        // Une IP par connexion : la limite de 10 connexions par minute vise une seule adresse
        const reply = await context.request.post(`${API_URL}/api/v1/auth/login`, {
          data: { companyCode: 'DISTRI-ORAN', login: account, password: 'SellWasl@2026' },
          headers: { 'X-Forwarded-For': `10.250.${(attempt >> 8) & 255}.${attempt & 255}` },
        });
        expect(reply.ok(), await reply.text()).toBeTruthy();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
