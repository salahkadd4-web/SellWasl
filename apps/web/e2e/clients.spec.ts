import { expect, test } from './fixtures';

test.use({ account: 'A-SUP' });

/** Clients : liste, recherche, fiche et création (UC-11, UC-12). */
test.describe('clients', () => {
  test('liste, recherche et fiche', async ({ page }) => {
    await page.goto('/app/clients');
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
    const rows = page.locator('main button').filter({ hasText: 'Chaque semaine' });
    await expect(rows.first()).toBeVisible();
    // Recherche sur le début du nom du premier client affiché
    const name = (await rows.first().innerText())
      .split('\n')[0]!
      .trim()
      .split(' ')
      .slice(0, 2)
      .join(' ');
    await page.getByLabel('Recherche').fill(name);
    const found = page.locator('main button').filter({ hasText: name }).first();
    await expect(found).toBeVisible();
    await found.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('création d’un client hors partie', async ({ page }) => {
    const name = `Client E2E ${Date.now()}`;
    await page.goto('/app/clients');
    await page.getByRole('button', { name: 'Nouveau client' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Créer le client' }).click();
    // La fiche du nouveau client s'ouvre : hors partie, puisque sans position
    const sheet = page.getByRole('dialog').filter({ hasText: name });
    await expect(sheet.getByText('Hors partie')).toBeVisible();
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByLabel('Recherche').fill(name);
    await expect(page.locator('main button').filter({ hasText: name })).toBeVisible();
  });
});
