import { loadState } from '@sellwasl/offline';
import { sellerRows } from '@sellwasl/offline/src/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SellerDashboard from '../app/seller/index';
import { useAuth } from '@/auth/AuthContext';
import { startWorkday } from '@/offline/workday';
import { TodayProvider } from '@/today/TodayContext';
import { fakeSync } from './fake-sync';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));

/** Accueil du vendeur (UC-02) : journée, clients du jour, encaissé — calculés sur le téléphone. */
describe('accueil du vendeur', () => {
  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({
      me: {
        user: { code: 'V07', firstName: 'Ahmed', lastName: 'Kaci' },
        role: { code: 'PRE_VENDEUR', name: 'Pré-vendeur' },
        permissions: ['workdays.own', 'orders.own'],
        modules: ['PRESALES'],
      },
      profile: null,
    } as unknown as ReturnType<typeof useAuth>);
    jest.mocked(startWorkday).mockClear();
  });

  const show = async () =>
    render(
      <TodayProvider>
        <SellerDashboard />
      </TodayProvider>,
    );

  it('journée non démarrée : secteur, partie, client du jour ; démarrage', async () => {
    fakeSync.local = loadState(sellerRows());
    await show();
    expect(screen.getByText('Bonjour Ahmed')).toBeOnTheScreen();
    expect(screen.getByText('V07 · Secteur S1 · Partie 1')).toBeOnTheScreen();
    expect(screen.getByText('Journée non démarrée')).toBeOnTheScreen();
    expect(screen.getByText(/Clients du jour : 0 \/ 1/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Démarrer la journée' }));
    await waitFor(() => expect(startWorkday).toHaveBeenCalled());
  });

  it('journée en cours : clôture proposée, plus de démarrage', async () => {
    fakeSync.local = loadState({
      ...sellerRows(),
      workday: [
        {
          id: 'w1',
          data: {
            id: 'w1',
            date: '2027-06-05',
            status: 'IN_PROGRESS',
            startedAt: '2027-06-05T07:00:00.000Z',
            closedAt: null,
          },
        },
      ],
    });
    await show();
    expect(screen.getByText('Journée en cours')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Clôturer la journée' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Démarrer la journée' })).toBeNull();
  });

  it('avant la première synchronisation : message, sans journée', async () => {
    fakeSync.local = loadState({});
    await show();
    expect(screen.getByText('Première synchronisation en cours…')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Démarrer la journée' })).toBeNull();
  });
});
