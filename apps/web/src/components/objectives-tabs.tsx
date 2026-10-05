'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompanyAuth } from '@/lib/auth';

const TABS = [
  { href: '/app/objectifs', label: 'Vendeurs', permission: 'objectives.read' },
  { href: '/app/objectifs/livreurs', label: 'Livreurs', permission: 'objectives.read' },
] as const;

/** Onglets des objectifs : vendeurs et livreurs. */
export function ObjectivesTabs() {
  const { can } = CompanyAuth.useAuth();
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => can(t.permission)).map((t) => {
        const active =
          t.href === '/app/objectifs' ? pathname === t.href : pathname.startsWith(t.href);
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
