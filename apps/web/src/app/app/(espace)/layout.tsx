'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { ChangePasswordForm } from '@/components/change-password';
import { NotificationBell } from '@/components/notification-bell';
import { FullPageMessage } from '@/components/ui';
import { CompanyAuth } from '@/lib/auth';
import { COMPANY_NAV, visibleItems } from '@/lib/navigation';

/** Espace entreprise : réservé aux sessions Web valides (docs/rbac.md §9), responsive (phase 22). */
export default function CompanySpaceLayout({ children }: { children: React.ReactNode }) {
  const { status, me, logout, can } = CompanyAuth.useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/app/login');
  }, [status, router]);

  if (status !== 'authenticated' || !me) return <FullPageMessage>Chargement…</FullPageMessage>;

  return (
    <AppShell
      subtitle={me.company.name}
      root="/app"
      items={visibleItems(COMPANY_NAV, can, me.modules)}
      user={{ name: `${me.user.firstName} ${me.user.lastName}`, detail: me.role.name }}
      roleCode={me.role.code}
      onLogout={() => void logout()}
      headerExtra={<NotificationBell />}
    >
      {/* Mot de passe provisoire : à changer avant toute autre action (UC-80). */}
      {me.mustChangePassword ? <ChangePasswordForm /> : children}
    </AppShell>
  );
}
