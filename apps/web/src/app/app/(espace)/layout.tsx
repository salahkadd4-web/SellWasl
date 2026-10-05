'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChangePasswordForm } from '@/components/change-password';
import { FullPageMessage } from '@/components/ui';
import { CompanyAuth } from '@/lib/auth';

const NAV = [
  { href: '/app', label: 'Accueil', permission: null },
  { href: '/app/clients', label: 'Clients', permission: 'customers.read' },
  { href: '/app/produits', label: 'Produits', permission: 'products.read' },
  { href: '/app/secteurs', label: 'Secteurs', permission: 'territories.read' },
  { href: '/app/planning', label: 'Planning', permission: 'territories.read' },
  { href: '/app/journees', label: 'Journées', permission: 'workdays.read' },
  { href: '/app/commandes', label: 'Commandes', permission: 'orders.read' },
  { href: '/app/attente', label: 'Lignes en attente', permission: 'pending_lines.process' },
  { href: '/app/tournees', label: 'Tournées', permission: 'preparation.launch' },
  { href: '/app/quotas', label: 'Quotas', permission: 'quotas.read' },
  { href: '/app/objectifs', label: 'Objectifs', permission: 'objectives.read' },
  { href: '/app/stock', label: 'Stock', permission: 'stock.read' },
  { href: '/app/versements', label: 'Versements', permission: 'settlements.read' },
  { href: '/app/paiements', label: 'Dettes et paiements', permission: 'payments.read' },
  { href: '/app/utilisateurs', label: 'Utilisateurs', permission: 'users.read' },
  { href: '/app/appareils', label: 'Appareils', permission: 'devices.read' },
  { href: '/app/parametres', label: 'Paramètres', permission: 'settings.read' },
] as const;

/** Espace entreprise : réservé aux sessions Web valides (docs/rbac.md §9). */
export default function CompanySpaceLayout({ children }: { children: React.ReactNode }) {
  const { status, me, logout, can } = CompanyAuth.useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/app/login');
  }, [status, router]);

  if (status !== 'authenticated' || !me) return <FullPageMessage>Chargement…</FullPageMessage>;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="bg-primary text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-lg font-bold">SellWasl</p>
            <p className="text-xs text-white/80">{me.company.name}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline">
              {me.user.firstName} {me.user.lastName} · {me.role.name}
            </span>
            <button
              onClick={() => void logout()}
              className="rounded-lg border border-white/30 px-3 py-1.5 hover:bg-white/10"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {NAV.filter((item) => item.permission === null || can(item.permission)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                pathname === item.href ||
                (item.href !== '/app' && pathname.startsWith(`${item.href}/`))
                  ? 'border-accent text-white'
                  : 'border-transparent text-white/70 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Mot de passe provisoire : à changer avant toute autre action (UC-80). */}
        {me.mustChangePassword ? <ChangePasswordForm /> : children}
      </main>
    </div>
  );
}
