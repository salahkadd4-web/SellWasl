import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { ChangePasswordForm } from './change-password';

const refreshMe = vi.fn();
vi.mock('@/lib/auth', () => ({ CompanyAuth: { useAuth: () => ({ refreshMe }) } }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

/** Changement du mot de passe provisoire (phase 27 : règle des mots de passe). */
describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.mocked(api).mockClear();
    refreshMe.mockClear();
  });

  async function fill(current: string, next: string, confirm: string) {
    render(<ChangePasswordForm />);
    await userEvent.type(screen.getByLabelText('Mot de passe provisoire'), current);
    await userEvent.type(screen.getByLabelText(/^Nouveau mot de passe/), next);
    await userEvent.type(screen.getByLabelText('Confirmez le nouveau mot de passe'), confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  }

  it('annonce la règle des mots de passe', () => {
    render(<ChangePasswordForm />);
    expect(
      screen.getByText('Au moins 8 caractères, avec une lettre et un chiffre.'),
    ).toBeInTheDocument();
  });

  it('confirmation différente : refus sans appel à l’API', async () => {
    await fill('ABCD-2345', 'Solide2026', 'Solide2027');
    expect(
      screen.getByText('Les deux nouveaux mots de passe sont différents.'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('enregistre puis recharge le profil', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await fill('ABCD-2345', 'Solide2026', 'Solide2026');
    expect(api).toHaveBeenCalledWith('company', '/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'ABCD-2345', newPassword: 'Solide2026' }),
    });
    expect(refreshMe).toHaveBeenCalled();
  });
});
