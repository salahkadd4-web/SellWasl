import { applyOps, loadState } from '@sellwasl/offline';
import { DATE, op, sellerRows } from '@sellwasl/offline/src/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import OrderScreen from '../app/seller/order/[visitId]';
import VisitScreen from '../app/seller/visit/[customerId]';
import { sendOperation } from '@/sync/operations';
import { TodayProvider } from '@/today/TodayContext';
import { fakeSync } from './fake-sync';

const started = () => [op('workday.start', { workdayId: 'w1', date: DATE })];
const visiting = () => [
  ...started(),
  op('visit.start', { visitId: 'v1', customerId: 'c1', mode: 'PHONE' }),
];
const withToday = (ui: React.ReactElement) => render(<TodayProvider>{ui}</TodayProvider>);

/** Visite et commande du pré-vendeur (UC-13, UC-14), calculées sur le téléphone. */
describe('visite', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ customerId: 'c1' });
    jest.mocked(sendOperation).mockClear();
  });

  it('journée non démarrée : la visite n’est pas proposée', async () => {
    fakeSync.local = loadState(sellerRows());
    await withToday(<VisitScreen />);
    expect(
      screen.getByText('Démarrez votre journée pour visiter, ajouter un client ou encaisser.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Commencer la visite' })).toBeNull();
  });

  it('visite par téléphone : action enregistrée sur le téléphone', async () => {
    fakeSync.local = applyOps(loadState(sellerRows()), started());
    await withToday(<VisitScreen />);
    expect(screen.getByText('Client du jour')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Par téléphone' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Commencer la visite' }));
    await waitFor(() =>
      expect(sendOperation).toHaveBeenCalledWith(
        'visit.start',
        expect.objectContaining({ customerId: 'c1', mode: 'PHONE', latitude: null }),
        'w1',
      ),
    );
  });
});

describe('commande', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ visitId: 'v1', customerId: 'c1' });
    jest.mocked(sendOperation).mockClear();
  });

  it('8 cartons de thon : total au prix de la grille, commande confirmée', async () => {
    fakeSync.local = applyOps(loadState(sellerRows()), visiting());
    await withToday(<OrderScreen />);
    await fireEvent.press(screen.getByText('Thon tomate'));
    await fireEvent.press(screen.getByRole('button', { name: 'carton' }));
    await fireEvent.changeText(screen.getByLabelText('Quantité'), '8');
    await fireEvent.press(screen.getByRole('button', { name: 'Ajouter au panier' }));
    // 8 × 5 800 DA (sous le palier de 10 cartons)
    expect(await screen.findByText(/Total : 46\s400 DA/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmer la commande' }));
    await waitFor(() =>
      expect(sendOperation).toHaveBeenCalledWith(
        'order.confirm',
        expect.objectContaining({
          visitId: 'v1',
          lines: [expect.objectContaining({ variantId: 'TOM', unitId: 'tom-ctn', qty: 8 })],
        }),
        'w1',
      ),
    );
  });
});
