import { expect, test } from './fixtures';

test.use({ account: 'A-ADM' });

/** Stock : niveaux et entrée au dépôt (UC-40). */
test('niveaux de stock par article', async ({ page }) => {
  await page.goto('/app/stock');
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();
  await expect(page.getByText('Thon tomate').first()).toBeVisible();
});

test('entrée au dépôt : enregistrée puis listée', async ({ page }) => {
  const reference = `E2E-${Date.now()}`;
  await page.goto('/app/stock/entrees');
  await page.getByRole('button', { name: 'Nouvelle entrée' }).click();
  await page.getByLabel('Référence du bon').fill(reference);
  const article = page.getByLabel('Article').first();
  const value = await article
    .locator('option', { hasText: 'Thon tomate' })
    .first()
    .getAttribute('value');
  await article.selectOption(value!);
  await page.getByLabel('Quantité').first().fill('2');
  await page.getByRole('button', { name: 'Enregistrer l’entrée' }).click();
  await expect(page.getByText(reference).first()).toBeVisible();
});
