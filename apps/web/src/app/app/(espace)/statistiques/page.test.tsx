import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import StatisticsPage from './page';

const auth = {
  me: { modules: ['ANALYTICS', 'RETURNS_ANALYSIS'] },
  can: (_permission: string) => true,
};
vi.mock('@/lib/auth', () => ({ CompanyAuth: { useAuth: () => auth } }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

const rate = { rate: 20, volume: 5, insufficient: false };
const RESPONSES: [string, unknown][] = [
  ['/territories', [{ id: 't1', code: '3101', name: 'Oran Est' }]],
  [
    '/users',
    [
      {
        id: 'u1',
        code: 'V07',
        firstName: 'Ahmed',
        lastName: 'Kaci',
        status: 'ACTIVE',
        role: { code: 'PRE_VENDEUR' },
      },
      {
        id: 'u2',
        code: 'L01',
        firstName: 'Youcef',
        lastName: 'Belkacem',
        status: 'ACTIVE',
        role: { code: 'LIVREUR' },
      },
    ],
  ],
  ['/products', [{ id: 'p1', name: 'Thon' }]],
  [
    '/reports/sales-trend',
    { unit: 'DAY', points: [{ start: '2026-10-01', orders: 2, revenue: 3000 }] },
  ],
  [
    '/reports/presales',
    {
      bySeller: [
        {
          key: 'u1',
          label: 'Ahmed Kaci (V07)',
          visits: 4,
          orders: 2,
          conversion: rate,
          revenue: 3000,
        },
      ],
      byTerritory: [],
    },
  ],
  [
    '/returns/trend',
    {
      unit: 'DAY',
      points: [
        {
          start: '2026-10-01',
          refusedValue: 500,
          returnedValue: 300,
          resoldValue: 200,
          refusalRate: rate,
        },
      ],
    },
  ],
];

const calls = () => vi.mocked(api).mock.calls.map((c) => c[1] as string);

/** Page Statistiques : un graphique à la fois, filtres propres à chacun. */
describe('page Statistiques', () => {
  beforeEach(() => {
    auth.me.modules = ['ANALYTICS', 'RETURNS_ANALYSIS'];
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation((_scope, path) => {
      const found = RESPONSES.find(([prefix]) => path.startsWith(prefix));
      return Promise.resolve(found ? found[1] : {}) as never;
    });
  });

  it('quatre graphiques ; Ventes : filtres secteur, vendeur et produit', async () => {
    render(<StatisticsPage />);
    for (const name of ['Ventes', 'Classement', 'Top 10', 'Retours'])
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    expect(await screen.findByLabelText('Vendeur')).toBeInTheDocument();
    expect(screen.getByLabelText('Secteur')).toBeInTheDocument();
    expect(screen.getByLabelText('Produit')).toBeInTheDocument();
    expect(screen.queryByLabelText('Livreur')).toBeNull();
    await waitFor(() =>
      expect(calls().some((p) => p.startsWith('/reports/sales-trend?'))).toBe(true),
    );
  });

  it('chaque graphique garde ses filtres ; le vendeur choisi est envoyé à l’API', async () => {
    render(<StatisticsPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Vendeur'), 'u1');
    await waitFor(() =>
      expect(
        calls().some((p) => p.startsWith('/reports/sales-trend?') && p.includes('userId=u1')),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Classement' }));
    expect(screen.queryByLabelText('Vendeur')).toBeNull();
    expect(screen.queryByLabelText('Produit')).toBeNull();
    expect(await screen.findByText(/Ahmed Kaci \(V07\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Ventes' }));
    expect((screen.getByLabelText('Vendeur') as HTMLSelectElement).value).toBe('u1');
  });

  it('Retours : le livreur est proposé ; vendeur et livreur partent sous leurs noms', async () => {
    render(<StatisticsPage />);
    await userEvent.click(screen.getByRole('tab', { name: 'Retours' }));
    await userEvent.selectOptions(await screen.findByLabelText('Livreur'), 'u2');
    await userEvent.selectOptions(screen.getByLabelText('Vendeur'), 'u1');
    await waitFor(() =>
      expect(
        calls().some(
          (p) =>
            p.startsWith('/returns/trend?') &&
            p.includes('driverId=u2') &&
            p.includes('sellerId=u1'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole('list', { name: 'Légende' })).toBeInTheDocument();
  });

  it('sans le module d’analyse des retours : pas de graphique Retours', () => {
    auth.me.modules = ['ANALYTICS'];
    render(<StatisticsPage />);
    expect(screen.queryByRole('tab', { name: 'Retours' })).toBeNull();
  });
});
