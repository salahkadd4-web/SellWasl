import { totpCode } from '../../api/src/auth/totp';
import { expect, test } from './fixtures';

/** Journal d'audit (admin) et espace plateforme avec deuxième facteur. */
test.describe('journal d’audit', () => {
  test.use({ account: 'A-ADM' });

  test('les connexions apparaissent, avec leur détail', async ({ page }) => {
    await page.goto('/app/audit');
    await expect(page.getByRole('heading', { name: "Journal d'audit" })).toBeVisible();
    const login = page.locator('main button').filter({ hasText: 'Connexion' }).first();
    await expect(login).toBeVisible();
    await login.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('IP', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Navigateur', { exact: true })).toBeVisible();
  });
});

test('super-admin : enrôlement du deuxième facteur puis liste des entreprises', async ({
  page,
}) => {
  // Hors de la liste d'IP, l'espace plateforme n'existe pas (phase 27)
  const hidden = await page.goto('/admin/login');
  expect(hidden?.status()).toBe(404);
  // Depuis une adresse autorisée (le proxy de confiance transmet l'IP du client)
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '127.0.0.1' });
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('superadmin@sellwasl.test');
  await page.getByLabel('Mot de passe').fill('SellWasl@2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  // Première connexion : QR code et clé à saisir à la main
  await expect(page.getByAltText('QR code du deuxième facteur')).toBeVisible();
  const key = (await page.getByText(/Ou saisissez la clé/).innerText()).split(':').pop()!.trim();
  await page.getByLabel('Code à 6 chiffres').fill(totpCode(key, Math.floor(Date.now() / 30_000)));
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Entreprises' })).toBeVisible();
  await expect(page.getByText('DISTRI-ORAN').first()).toBeVisible();
});
