'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoginForm } from '@/components/login-form';
import { Field } from '@/components/ui';
import { CompanyAuth, rememberedCompany } from '@/lib/auth';

export default function CompanyLoginPage() {
  const { status, login } = CompanyAuth.useAuth();
  const router = useRouter();
  const [company, setCompany] = useState('');

  useEffect(() => setCompany(rememberedCompany.get()), []);
  useEffect(() => {
    if (status === 'authenticated') router.replace('/app');
  }, [status, router]);

  return (
    <LoginForm
      title="Espace entreprise"
      subtitle="Administrateur, superviseur, comptable"
      onSubmit={async (form) => {
        const companyCode = String(form.get('companyCode') ?? '').trim();
        await login({
          companyCode,
          login: String(form.get('login')),
          password: String(form.get('password')),
        });
        rememberedCompany.set(companyCode);
      }}
    >
      <Field
        label="Code de l'entreprise"
        name="companyCode"
        required
        autoCapitalize="characters"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="DISTRI-ORAN"
      />
      <Field
        label="Identifiant"
        name="login"
        required
        autoComplete="username"
        placeholder="Code ou email"
      />
      <Field
        label="Mot de passe"
        name="password"
        type="password"
        required
        autoComplete="current-password"
      />
      <p className="text-xs text-muted">
        Vendeurs, livreurs et magasiniers : utilisez l'application mobile SellWasl, qui fonctionne
        sans connexion.
      </p>
    </LoginForm>
  );
}
