import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api';
import { LoginForm } from './login-form';
import { Field } from './ui';

/** Formulaire de connexion commun à l'entreprise et à la plateforme. */
describe('LoginForm', () => {
  function renderForm(onSubmit: (form: FormData) => Promise<void>) {
    render(
      <LoginForm title="Espace entreprise" subtitle="Connexion" onSubmit={onSubmit}>
        <Field label="Identifiant" name="login" required />
        <Field label="Mot de passe" name="password" type="password" required />
      </LoginForm>,
    );
  }

  it('envoie les champs saisis', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(onSubmit);
    await userEvent.type(screen.getByLabelText('Identifiant'), 'A-SUP');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'SellWasl@2026');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    const form = onSubmit.mock.calls[0]![0] as FormData;
    expect(form.get('login')).toBe('A-SUP');
    expect(form.get('password')).toBe('SellWasl@2026');
  });

  it('affiche le message de l’API, ou un message générique sans réseau', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError(
          403,
          'ACCOUNT_LOCKED',
          'Compte bloqué 15 minutes après 5 mots de passe incorrects.',
        ),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderForm(onSubmit);
    await userEvent.type(screen.getByLabelText('Identifiant'), 'A-SUP');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/Compte bloqué 15 minutes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Impossible de joindre le serveur.')).toBeInTheDocument();
  });
});
