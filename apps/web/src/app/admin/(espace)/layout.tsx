'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageMessage } from '@/components/ui';
import { PlatformAuth } from '@/lib/auth';

export default function PlatformSpaceLayout({ children }: { children: React.ReactNode }) {
  const { status, me, logout } = PlatformAuth.useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous') router.replace('/admin/login');
  }, [status, router]);

  if (status !== 'authenticated' || !me) return <FullPageMessage>Chargement…</FullPageMessage>;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="bg-text-dark text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-lg font-bold">SellWasl · Plateforme</p>
            <p className="text-xs text-white/80">{me.email}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
