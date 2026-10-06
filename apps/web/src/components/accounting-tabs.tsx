'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompanyAuth } from '@/lib/auth';

const TABS = [
  { href: '/app/versements', label: 'Versements', permission: 'settlements.read' },
  { href: '/app/paiements', label: 'Dettes et paiements', permission: 'payments.read' },
  { href: '/app/ecarts', label: 'Écarts', permission: 'discrepancies.read' },
  { href: '/app/retenues', label: 'Retenues', permission: 'deductions.manage' },
  { href: '/app/acomptes', label: 'Acomptes', permission: 'advances.manage' },
  { href: '/app/primes', label: 'Primes', permission: 'incentives.read' },
  { href: '/app/paie', label: 'Paie', permission: 'payroll.read' },
] as const;

/** Onglets de la comptabilité. */
export function AccountingTabs() {
  const { can } = CompanyAuth.useAuth();
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.filter((t) => can(t.permission)).map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
            pathname.startsWith(t.href)
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-primary'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
