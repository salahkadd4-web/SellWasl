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

  test('formulaire envoyé pendant le chargement des types : le type affiché est envoyé', async ({
    page,
  }) => {
    // Types de clients lents à venir : le formulaire s'ouvre avant leur arrivée
    let release!: () => void;
    const typesHeld = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/customer-types', async (route) => {
      await typesHeld;
      await route.continue();
    });
    const name = `Client E2E lent ${Date.now()}`;
    await page.goto('/app/clients');
    await page.getByRole('button', { name: 'Nouveau client' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom', { exact: true }).fill(name);
    // Clic pendant le chargement : l'envoi attend les types
    const submitted = dialog.getByRole('button', { name: 'Créer le client' }).click();
    await page.waitForTimeout(500);
    release();
    await submitted;
    await expect(
      page.getByRole('dialog').filter({ hasText: name }).getByText('Hors partie'),
    ).toBeVisible();
  });
});
