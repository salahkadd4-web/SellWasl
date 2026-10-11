import { expect, test } from './fixtures';

test.use({ account: 'A-ADM' });

/** Produits et secteurs (catalogue, carte). */
test('produits : liste et fiche d’un produit', async ({ page }) => {
  await page.goto('/app/produits');
  await expect(page.getByRole('heading', { name: 'Produits' })).toBeVisible();
  await page.getByText('Thon tomate').first().click();
  await expect(page.getByRole('heading', { name: /Thon tomate/ })).toBeVisible();
});

test('secteurs : liste et carte, sans Internet', async ({ page }) => {
  await page.goto('/app/secteurs');
  await expect(page.getByRole('heading', { name: 'Secteurs' })).toBeVisible();
  await expect(page.getByText('3101').first()).toBeVisible();
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
});
