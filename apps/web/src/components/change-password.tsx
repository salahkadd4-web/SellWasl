'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { Alert, Button, Card, Field } from './ui';

/** Changement du mot de passe provisoire, à la première connexion. */
export function ChangePasswordForm() {
  const { refreshMe } = CompanyAuth.useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    const currentPassword = String(form.get('current'));
    const newPassword = String(form.get('next'));
    if (newPassword !== String(form.get('confirm')))
      return setError('Les deux nouveaux mots de passe sont différents.');
    setBusy(true);
    setError(null);
    try {
      await api('company', '/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto flex max-w-md flex-col gap-3">
      <h1 className="text-xl font-bold text-primary">Choisissez votre mot de passe</h1>
      <p className="text-sm text-muted">
        Vous utilisez un mot de passe provisoire. Remplacez-le pour continuer.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <Field
          label="Mot de passe provisoire"
          name="current"
          type="password"
          required
          autoComplete="current-password"
        />
        <Field
          label="Nouveau mot de passe"
          name="next"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="Au moins 8 caractères."
        />
        <Field
          label="Confirmez le nouveau mot de passe"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  );
}
