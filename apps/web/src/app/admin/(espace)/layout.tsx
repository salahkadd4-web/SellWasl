'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { FullPageMessage } from '@/components/ui';
import { PlatformAuth } from '@/lib/auth';
import type { NavItem } from '@/lib/navigation';

const PLATFORM_NAV: NavItem[] = [
  {
    href: '/admin',
    label: 'Entreprises',
    permission: null,
    group: 'Pilotage',
    icon: 'building',
    bottom: 1,
  },
];

/** Espace Super Admin de la plateforme, responsive (phase 22). */
export default function PlatformSpaceLayout({ children }: { children: React.ReactNode }) {
  const { status, me, logout } = PlatformAuth.useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous') router.replace('/admin/login');
  }, [status, router]);

  if (status !== 'authenticated' || !me) return <FullPageMessage>Chargement…</FullPageMessage>;

  return (
    <AppShell
      subtitle="Plateforme"
      root="/admin"
      tone="platform"
      items={PLATFORM_NAV}
      user={{ name: me.email, detail: 'Super Admin' }}
      onLogout={() => void logout()}
    >
      {children}
    </AppShell>
  );
}
