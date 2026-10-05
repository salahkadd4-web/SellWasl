'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompanyAuth } from '@/lib/auth';

const TABS = [
  { href: '/app/stock', label: 'Stock', permission: 'stock.read' },
  { href: '/app/stock/entrees', label: 'Entrées', permission: 'stock.read' },
  { href: '/app/stock/inventaires', label: 'Inventaires', permission: 'stock.read' },
  { href: '/app/stock/chargements', label: 'Chargements', permission: 'loads.read' },
  { href: '/app/stock/dechargements', label: 'Déchargements', permission: 'loads.read' },
  { href: '/app/stock/mouvements', label: 'Mouvements', permission: 'stock.read' },
] as const;

/** Onglets des écrans du stock. */
export function StockTabs() {
  const { can } = CompanyAuth.useAuth();
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => can(t.permission)).map((t) => {
        const active = t.href === '/app/stock' ? pathname === t.href : pathname.startsWith(t.href);
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
