import { expect, test } from './fixtures';

test.use({ account: 'A-ADM' });

/** Commandes, tournées et livraisons. */
test('commandes : la liste du jour s’affiche', async ({ page }) => {
  await page.goto('/app/commandes');
  await expect(page.getByRole('heading', { name: 'Commandes' })).toBeVisible();
  await expect(page.getByText(/commande\(s\)|Aucune commande\./).first()).toBeVisible();
});

test('tournées : préparation et livraisons de la date', async ({ page }) => {
  await page.goto('/app/tournees');
  await expect(page.getByRole('heading', { name: 'Tournées' })).toBeVisible();
  await expect(page.getByText(/Erreur inattendue/)).toHaveCount(0);
});
