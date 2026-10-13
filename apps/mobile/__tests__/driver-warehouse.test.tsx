import { applyOps, loadState } from '@sellwasl/offline';
import { DATE, op, sellerRows } from '@sellwasl/offline/src/fixtures';
import type { DriverRouteDto, StockRowDto } from '@sellwasl/validation';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import DeliveryScreen from '../app/driver/delivery/[orderId]';
import DriverHome from '../app/driver/(tabs)/index';
import WarehouseHome from '../app/warehouse/index';
import WarehouseStock from '../app/warehouse/stock';
import { request } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { startWorkday } from '@/offline/workday';
import { sendOperation } from '@/sync/operations';
import { useWarehouses } from '@/warehouse/warehouses';
import { fakeSync } from './fake-sync';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), request: jest.fn() }));
jest.mock('@/warehouse/warehouses', () => ({ useWarehouses: jest.fn() }));

const me = (code: string, firstName: string, role: string) =>
  jest.mocked(useAuth).mockReturnValue({
    me: {
      user: { code, firstName, lastName: 'Test' },
      role: { code: role, name: role },
      permissions: [],
      modules: ['PRESALES', 'WAREHOUSE'],
    },
    profile: {
      userCode: code,
      firstName,
      lastName: 'Test',
      companyName: 'Distri Oran',
      roleName: role,
      roleCode: role,
      series: 'B',
    },
  } as unknown as ReturnType<typeof useAuth>);

/** Tournée du livreur : 12 cartons de thon (palier à 10 : 5 600 DA) à livrer à c1. */
function driverState(ops = [op('workday.start', { workdayId: 'w1', date: DATE })]) {
  const day: DriverRouteDto = {
    date: DATE,
    workday: null,
    loadToReceive: null,
    route: { id: 'r1', status: 'IN_PROGRESS', truckCode: 'TRUCK-01' },
    deliveries: [
      {
        orderId: 'o9',
        number: 'V07-B0009',
        status: 'OUT_FOR_DELIVERY',
        totalAmount: 12 * 5600,
        customerTypeId: 'DETAIL',
        orderDate: DATE,
        customer: {
          id: 'c1',
          name: 'Épicerie Amine',
          phone: null,
          address: 'Rue 1',
          latitude: 35.7,
          longitude: -0.6,
          debtAmount: 1000,
          isCreditAllowed: true,
          creditLimitAmount: 10_000,
        },
        lines: [
          {
            lineId: 'L1',
            kind: 'NORMAL',
            variantId: 'TOM',
            productName: 'Thon tomate',
            variantName: null,
            unitId: 'tom-ctn',
            unitName: 'carton',
            unitBaseQty: 20,
            preparedQty: 12,
            unitPrice: 5600,
            deliveredQty: null,
            bonusRuleId: null,
          },
        ],
        delivery: null,
      },
    ],
    progress: { delivered: 0, partial: 0, failed: 0, pending: 1, collected: 0 },
  };
  const state = loadState({ ...sellerRows('LIVREUR'), driverDay: [{ id: DATE, data: day }] });
  return applyOps(state, ops);
}

describe('livreur', () => {
  beforeEach(() => {
    me('L01', 'Youcef', 'LIVREUR');
    jest.mocked(sendOperation).mockClear();
    jest.mocked(startWorkday).mockClear();
  });

  it('accueil : journée à démarrer, tournée du jour', async () => {
    fakeSync.local = driverState([]);
    await render(<DriverHome />);
    expect(screen.getByText('Bonjour Youcef')).toBeOnTheScreen();
    expect(screen.getByText('Journée non démarrée')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ma tournée' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Démarrer la journée' }));
    await waitFor(() => expect(startWorkday).toHaveBeenCalled());
  });

  it('livraison partielle : quantité corrigée (✓), annulation (✕), motif de refus exigé', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ orderId: 'o9' });
    fakeSync.local = driverState();
    await render(<DeliveryScreen />);
    expect(screen.getByText('12 / 12')).toBeOnTheScreen();
    // Correction abandonnée : rien ne change
    await fireEvent.press(screen.getByRole('button', { name: 'Thon tomate, livré 12 sur 12' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Moins Livré (carton)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Annuler la correction' }));
    expect(screen.getByText('12 / 12')).toBeOnTheScreen();
    expect(screen.getByText('Complet')).toBeOnTheScreen();
    // Correction validée : 10 cartons sur 12 préparés
    await fireEvent.press(screen.getByRole('button', { name: 'Thon tomate, livré 12 sur 12' }));
    await fireEvent.changeText(screen.getByLabelText('Quantité Livré (carton)'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Plus Livré (carton)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Plus Livré (carton)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Plus Livré (carton)' }));
    // Jamais au-delà du préparé
    expect(screen.getByLabelText('Quantité Livré (carton)').props.value).toBe('12');
    await fireEvent.changeText(screen.getByLabelText('Quantité Livré (carton)'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Valider la quantité livrée' }));
    expect(screen.getByText('10 / 12')).toBeOnTheScreen();
    expect(screen.getByText('Partiel')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Calculer le montant' }));
    expect(await screen.findByText(/Total : 56\s000 DA/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Montant encaissé (DA)'), '56000');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmer la livraison' }));
    // Sous le préparé : pas d'envoi sans motif (BR-RET-01)
    expect(screen.getByText('Choisissez le motif du refus.')).toBeOnTheScreen();
    expect(sendOperation).not.toHaveBeenCalled();
  });

  it('livraison complète : montant calculé au palier, encaissement, action en file', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ orderId: 'o9' });
    fakeSync.local = driverState();
    await render(<DeliveryScreen />);
    expect(screen.getByText('Épicerie Amine')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Calculer le montant' }));
    // 12 cartons × 5 600 DA (palier à partir de 10 cartons)
    expect(await screen.findByText(/Total : 67\s200 DA/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Montant encaissé (DA)'), '67200');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmer la livraison' }));
    await waitFor(() =>
      expect(sendOperation).toHaveBeenCalledWith(
        'delivery.confirm',
        expect.objectContaining({ orderId: 'o9' }),
        expect.anything(),
      ),
    );
  });
});

describe('magasinier', () => {
  beforeEach(() => me('M01', 'Rachid', 'MAGASINIER'));

  it('accueil : tournées à préparer, camions à décharger, articles sous le seuil', async () => {
    jest.mocked(request).mockImplementation(async (path: string) => {
      if (path === '/routes/preparing') return [{ status: 'LOCKED' }, { status: 'READY' }] as never;
      if (path === '/unloads/pending') return [{ workdayId: 'w1' }] as never;
      if (path === '/stock/alerts') return [{ variantId: 'TOM' }] as never;
      throw new Error(path);
    });
    await render(<WarehouseHome />);
    expect(await screen.findByText(/À décharger : 1/)).toBeOnTheScreen();
    expect(screen.getByText('1 article(s) sous leur seuil')).toBeOnTheScreen();
  });

  it('stock du dépôt : disponible et alerte de seuil', async () => {
    jest.mocked(useWarehouses).mockReturnValue({
      warehouses: [{ id: 'd1', code: 'DEPOT', name: 'Dépôt Oran', type: 'DEPOT' }],
      error: null,
    } as unknown as ReturnType<typeof useWarehouses>);
    const rows: StockRowDto[] = [
      {
        variantId: 'TOM',
        productName: 'Thon tomate',
        variantName: null,
        physical: 120,
        reserved: 20,
        available: 100,
        lowStockQty: 200,
        isLow: true,
      },
    ];
    jest.mocked(request).mockResolvedValue(rows as never);
    await render(<WarehouseStock />);
    expect(await screen.findByText('Thon tomate')).toBeOnTheScreen();
    expect(screen.getByText('Physique 120 · réservé 20')).toBeOnTheScreen();
    expect(screen.getByText('Sous le seuil (200)')).toBeOnTheScreen();
    expect(request).toHaveBeenCalledWith('/stock?warehouseId=d1');
  });
});
