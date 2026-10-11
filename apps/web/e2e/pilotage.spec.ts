import { expect, test } from './fixtures';

test.use({ account: 'A-SUP' });

/** Accueil et rapports du superviseur. */
test('accueil : salutation, modules actifs et accès', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Modules actifs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Votre accès' })).toBeVisible();
});

test('rapports : la page s’affiche sans erreur', async ({ page }) => {
  await page.goto('/app/rapports');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/Erreur inattendue/)).toHaveCount(0);
});
