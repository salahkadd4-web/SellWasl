'use client';

import Image from 'next/image';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ApiClientError } from '@/lib/api';
import { Alert, Button } from './ui';

/** Formulaire de connexion commun à l'espace entreprise et à l'administration plateforme. */
export function LoginForm({
  title,
  subtitle,
  children,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(new FormData(event.currentTarget));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Impossible de joindre le serveur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8">
      <form
        onSubmit={handle}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-sm"
      >
        <Image
          src="/logo.png"
          alt="SellWasl"
          width={180}
          height={120}
          className="mx-auto h-auto w-[180px]"
          priority
        />
        <div className="text-center">
          <h1 className="text-xl font-bold text-primary">{title}</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        {children}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </main>
  );
}
