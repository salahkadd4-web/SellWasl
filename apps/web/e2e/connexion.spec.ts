import { expect, test } from './fixtures';

/** Connexion et déconnexion (sans session enregistrée). */
test.describe('connexion', () => {
  test('mauvais mot de passe : message clair', async ({ page }) => {
    await page.goto('/app/login');
    await page.getByLabel("Code de l'entreprise").fill('DISTRI-ORAN');
    await page.getByLabel('Identifiant').fill('A-CPT');
    await page.getByLabel('Mot de passe').fill('Mauvais123');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert').or(page.getByText(/incorrect/i))).toBeVisible();
  });

  test('connexion, accueil, puis déconnexion', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/login$/);
    await page.getByLabel("Code de l'entreprise").fill('DISTRI-ORAN');
    await page.getByLabel('Identifiant').fill('A-CPT');
    await page.getByLabel('Mot de passe').fill('SellWasl@2026');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/app\/login$/);
  });
});
