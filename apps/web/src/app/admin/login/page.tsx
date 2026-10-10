'use client';

import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { LoginForm } from '@/components/login-form';
import { Field } from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { PlatformAuth } from '@/lib/auth';

/** Étape du deuxième facteur (phase 27) : enrôlement par QR code, ou code exigé. */
type Challenge = { kind: 'setup'; secret: string; qr: string } | { kind: 'code' };

export default function PlatformLoginPage() {
  const { status, login } = PlatformAuth.useAuth();
  const router = useRouter();
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  useEffect(() => {
    if (status === 'authenticated') router.replace('/admin');
  }, [status, router]);

  async function submit(form: FormData) {
    const creds = credentials ?? {
      email: String(form.get('email')),
      password: String(form.get('password')),
    };
    const code = challenge ? String(form.get('code') ?? '').trim() : undefined;
    try {
      await login({ ...creds, ...(code ? { code } : {}) });
    } catch (err) {
      if (!(err instanceof ApiClientError)) throw err;
      if (err.code === 'TOTP_SETUP') {
        const details = err.details as { secret: string; otpauthUri: string };
        const qr = await QRCode.toDataURL(details.otpauthUri, {
          width: 220,
          margin: 1,
          color: { dark: '#001850' },
        });
        setCredentials(creds);
        setChallenge({ kind: 'setup', secret: details.secret, qr });
        if (!code) return;
      } else if (err.code === 'TOTP_REQUIRED') {
        setCredentials(creds);
        setChallenge({ kind: 'code' });
        return;
      }
      throw err;
    }
  }

  return (
    <LoginForm title="Administration plateforme" subtitle="Super Admin" onSubmit={submit}>
      {!challenge && (
        <>
          <Field label="Email" name="email" type="email" required autoComplete="username" />
          <Field
            label="Mot de passe"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </>
      )}
      {challenge?.kind === 'setup' && (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-muted">
            Première connexion : scannez ce QR code avec une application d&apos;authentification
            (Google Authenticator, Microsoft Authenticator…), puis saisissez le code affiché.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={challenge.qr} alt="QR code du deuxième facteur" width={220} height={220} />
          <p className="text-xs text-muted">
            Ou saisissez la clé : <span className="font-mono break-all">{challenge.secret}</span>
          </p>
        </div>
      )}
      {challenge && (
        <Field
          label="Code à 6 chiffres"
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          autoFocus
        />
      )}
    </LoginForm>
  );
}
