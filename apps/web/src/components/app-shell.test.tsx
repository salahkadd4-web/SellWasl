import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/lib/navigation';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/clients' }));

const items: NavItem[] = [
  { href: '/app', label: 'Accueil', permission: null, group: 'Pilotage', icon: 'home' },
  { href: '/app/clients', label: 'Clients', permission: null, group: 'Terrain', icon: 'store' },
];

/** Barre latérale du Web : dépliée (icônes et libellés) ou repliée (icônes), au choix. */
describe('menu latéral', () => {
  afterEach(() => localStorage.clear());

  const show = () =>
    render(
      <AppShell
        subtitle="Distri Oran"
        root="/app"
        items={items}
        user={{ name: 'Nadia Haddad', detail: 'Superviseur' }}
        onLogout={() => {}}
      >
        <p>contenu</p>
      </AppShell>,
    );
  const sidebar = () => within(screen.getByRole('complementary'));

  it('replier puis déplier depuis le bouton du haut ; le choix est mémorisé', async () => {
    show();
    expect(sidebar().getByText('Clients')).toBeInTheDocument();
    await userEvent.click(sidebar().getByRole('button', { name: 'Replier le menu' }));
    expect(sidebar().queryByText('Clients')).toBeNull();
    expect(sidebar().getByTitle('Clients')).toBeInTheDocument();
    expect(localStorage.getItem('sellwasl.sidebarCollapsed')).toBe('1');
    await userEvent.click(sidebar().getByRole('button', { name: 'Déplier le menu' }));
    expect(sidebar().getByText('Clients')).toBeInTheDocument();
    expect(localStorage.getItem('sellwasl.sidebarCollapsed')).toBe('0');
  });

  it('menu replié lors d’une visite précédente : le bouton pour le déplier est en tête', async () => {
    localStorage.setItem('sellwasl.sidebarCollapsed', '1');
    show();
    const unfold = await sidebar().findByRole('button', { name: 'Déplier le menu' });
    // Avant la liste des entrées : visible sans faire défiler le menu
    const nav = sidebar().getByRole('navigation', { name: 'Menu principal' });
    expect(unfold.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
