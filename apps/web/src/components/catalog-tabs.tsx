'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompanyAuth } from '@/lib/auth';

const TABS = [
  { href: '/app/produits', label: 'Catalogue', permission: 'products.read' },
  { href: '/app/produits/bonus', label: 'Règles de bonus', permission: 'prices.read' },
  { href: '/app/produits/simulateur', label: 'Simulateur', permission: 'prices.read' },
  { href: '/app/produits/fournisseurs', label: 'Fournisseurs', permission: 'products.read' },
  { href: '/app/produits/import', label: 'Importer', permission: 'imports.run' },
] as const;

/** Onglets des écrans du catalogue. */
export function CatalogTabs() {
  const { can } = CompanyAuth.useAuth();
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => can(t.permission)).map((t) => {
        const active =
          t.href === '/app/produits'
            ? pathname === t.href || /^\/app\/produits\/[0-9a-f-]{36}/.test(pathname)
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-primary'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
