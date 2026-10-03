'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoginForm } from '@/components/login-form';
import { Field } from '@/components/ui';
import { PlatformAuth } from '@/lib/auth';

export default function PlatformLoginPage() {
  const { status, login } = PlatformAuth.useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'authenticated') router.replace('/admin');
  }, [status, router]);

  return (
    <LoginForm
      title="Administration plateforme"
      subtitle="Super Admin"
      onSubmit={(form) =>
        login({ email: String(form.get('email')), password: String(form.get('password')) })
      }
    >
      <Field label="Email" name="email" type="email" required autoComplete="username" />
      <Field
        label="Mot de passe"
        name="password"
        type="password"
        required
        autoComplete="current-password"
      />
    </LoginForm>
  );
}
