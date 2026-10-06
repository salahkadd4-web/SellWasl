'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { bottomItems, isActive, NAV_GROUPS, type NavItem } from '@/lib/navigation';

const COLLAPSED_KEY = 'sellwasl.sidebarCollapsed';

interface Props {
  /** Nom affiché sous le logo (entreprise ou « Plateforme »). */
  subtitle: string;
  /** Racine de l'espace (« /app », « /admin ») : l'accueil n'est actif que sur elle. */
  root: string;
  items: NavItem[];
  user: { name: string; detail: string };
  /** Code du rôle : choix des entrées de la barre du bas. */
  roleCode?: string;
  tone?: 'company' | 'platform';
  onLogout: () => void;
  children: ReactNode;
}

/**
 * Mise en page responsive (phase 22) : barre latérale repliable sur desktop, panneau sur
 * tablette, en-tête compact et barre du bas avec « Plus » sur smartphone.
 */
export function AppShell({
  subtitle,
  root,
  items,
  user,
  roleCode,
  tone = 'company',
  onLogout,
  children,
}: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const bar = tone === 'company' ? 'bg-primary' : 'bg-text-dark';
  const current = items.find((i) => isActive(i, pathname, root));
  const bottom = bottomItems(items, roleCode);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // Préférence non mémorisable : barre dépliée
    }
  }, []);

  // Le panneau se ferme au changement de page et à la touche Échap
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // Préférence non mémorisable
      }
      return !c;
    });
  }

  const menu = (compact: boolean) => (
    <nav aria-label="Menu principal" className="flex flex-col gap-4 py-3">
      {NAV_GROUPS.map((group) => {
        const entries = items.filter((i) => i.group === group);
        if (entries.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-0.5">
            {!compact && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-white/50">
                {group}
              </p>
            )}
            {entries.map((item) => {
              const active = isActive(item, pathname, root);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={compact ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                    active
                      ? 'bg-white/15 text-white'
                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                  } ${compact ? 'justify-center' : ''}`}
                >
                  <Icon name={item.icon} />
                  {!compact && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const brand = (compact: boolean) => (
    <div className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`}>
      <Image
        src="/icon-192.png"
        alt=""
        width={36}
        height={36}
        className="size-9 rounded-lg bg-white"
      />
      {!compact && (
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight">SellWasl</span>
          <span className="block truncate text-xs text-white/75">{subtitle}</span>
        </span>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-surface">
      {/* Desktop : barre latérale */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col overflow-y-auto px-3 py-4 text-white lg:flex ${bar} ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {brand(collapsed)}
        <div className="flex-1">{menu(collapsed)}</div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm text-white/70 hover:bg-white/10"
        >
          <Icon name="collapse" className={`size-5 transition ${collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && 'Replier'}
        </button>
      </aside>

      <div className={collapsed ? 'lg:pl-20' : 'lg:pl-64'}>
        {/* En-tête : compact sur smartphone et tablette, utilisateur sur desktop */}
        <header
          className={`sticky top-0 z-20 flex min-h-14 items-center gap-3 px-4 pt-[env(safe-area-inset-top)] text-white lg:bg-white lg:text-text-dark lg:shadow-sm ${bar}`}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
            className="hidden min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10 sm:flex lg:hidden"
          >
            <Icon name="menu" className="size-6" />
          </button>
          <div className="lg:hidden">{brand(true)}</div>
          <p className="min-w-0 flex-1 truncate text-base font-semibold">{current?.label ?? ''}</p>
          <span className="hidden text-right text-sm lg:block">
            <span className="block font-medium">{user.name}</span>
            <span className="block text-xs text-muted">{user.detail}</span>
          </span>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Déconnexion"
            className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-sm hover:bg-white/10 lg:border lg:border-border lg:hover:bg-surface"
          >
            <Icon name="logout" />
            <span className="hidden lg:inline">Déconnexion</span>
          </button>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-6">
          {children}
        </main>
      </div>

      {/* Smartphone : barre du bas */}
      <nav
        aria-label="Navigation rapide"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {bottom.map((item) => {
          const active = isActive(item, pathname, root);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
                active ? 'text-primary' : 'text-muted'
              }`}
            >
              <Icon name={item.icon} className="size-6" />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
            open || (current && !bottom.includes(current)) ? 'text-primary' : 'text-muted'
          }`}
        >
          <Icon name="more" className="size-6" />
          Plus
        </button>
      </nav>

      {/* Tablette et smartphone : menu complet en panneau */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panel}
            className={`absolute inset-y-0 left-0 flex w-full flex-col overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-white sm:w-80 ${bar}`}
          >
            <div className="flex items-center justify-between gap-3">
              {brand(false)}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10"
              >
                <Icon name="close" className="size-6" />
              </button>
            </div>
            <p className="mt-4 px-3 text-sm text-white/80">
              {user.name} · {user.detail}
            </p>
            <div className="flex-1">{menu(false)}</div>
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 hover:bg-white/10"
            >
              <Icon name="logout" />
              Déconnexion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
