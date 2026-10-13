import { applyOps, loadState } from '@sellwasl/offline';
import { customer, DATE, op, sellerRows } from '@sellwasl/offline/src/fixtures';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import CustomersScreen from '../app/seller/(tabs)/customers';
import SellerMapScreen from '../app/seller/(tabs)/map';
import { useAuth } from '@/auth/AuthContext';
import { mapProvider, resetMapProvider } from '@/map/provider';
import { directionsUrl } from '@/seller/customers';
import { CustomerMap } from '@/seller/CustomerMap';
import { TodayProvider } from '@/today/TodayContext';
import { fakeSync } from './fake-sync';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/location/useLocation', () => ({
  ...jest.requireActual('@/location/useLocation'),
  useCurrentPosition: () => ({ position: null, status: 'granted' }),
}));

/** Carte MapLibre simulée : les propriétés reçues par chaque élément sont gardées. */
const mockMap: Record<string, Record<string, unknown>> = {};
jest.mock('@maplibre/maplibre-react-native', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const element =
    (name: string) =>
    ({ children, ...props }: { children?: unknown; id?: string }) => {
      mockMap[props.id ?? name] = props;
      return createElement(View, { testID: props.id ?? name }, children as never);
    };
  return {
    TransformRequestManager: { addHeader: jest.fn() },
    Map: element('map'),
    Camera: element('camera'),
    Images: element('images'),
    GeoJSONSource: element('source'),
    Layer: element('layer'),
  };
});

const router = jest.requireMock<{ __router: { push: jest.Mock } }>('expo-router').__router;

/**
 * Secteur de trois clients : c1 (client du jour, visité), c2 (hors programme, numéro et adresse
 * sans position), c3 (ni numéro, ni adresse, ni position).
 */
function sectorState() {
  const base = sellerRows();
  return applyOps(
    loadState({
      ...base,
      customer: [
        { id: 'c1', data: customer },
        {
          id: 'c2',
          data: {
            ...customer,
            id: 'c2',
            code: 'CL-002',
            name: 'Supérette Bir El Djir',
            phone: '0555 12 34 56',
            address: 'Cité 20 août, Bir El Djir',
            latitude: null,
            longitude: null,
            customerType: { id: 'SUP', code: 'SUPERETTE', name: 'Supérette' },
            debtAmount: 0,
          },
        },
        {
          id: 'c3',
          data: {
            ...customer,
            id: 'c3',
            code: 'CL-003',
            name: 'Kiosque Sans Fiche',
            phone: null,
            address: null,
            latitude: null,
            longitude: null,
            debtAmount: 0,
          },
        },
      ],
    }),
    [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op('visit.start', { visitId: 'v1', customerId: 'c1', mode: 'PHONE' }),
      op('visit.close_no_order', { visitId: 'v1', reasonId: 'r1' }),
    ],
  );
}

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
  router.push.mockClear();
  resetMapProvider();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

describe('itinéraire Google Maps', () => {
  it('position du client, sinon adresse précise, sinon rien', () => {
    expect(directionsUrl({ latitude: 35.7, longitude: -0.6 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.7,-0.6&travelmode=driving',
    );
    expect(
      directionsUrl({ latitude: null, longitude: null, address: 'Cité 20 août, Bir El Djir' }),
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Cit%C3%A9%2020%20ao%C3%BBt%2C%20Bir%20El%20Djir&travelmode=driving',
    );
    expect(directionsUrl({ latitude: null, longitude: null, address: 'Oran' })).toBeNull();
    expect(directionsUrl({ latitude: 95, longitude: -0.6, address: null })).toBeNull();
  });
});

describe('visites (liste des clients)', () => {
  const show = async () =>
    render(
      <TodayProvider>
        <CustomersScreen />
      </TodayProvider>,
    );

  it('compteurs, filtres d’état et recherche combinés', async () => {
    fakeSync.local = sectorState();
    await show();
    expect(screen.getByRole('tab', { name: 'Clients du jour (1)' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Épicerie Amine, Visité')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Tout le secteur (3)' }));
    expect(screen.getByText('3 clients')).toBeOnTheScreen();
    expect(screen.getByText('Supérette')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'À visiter' }));
    expect(screen.getByText('2 clients')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Épicerie Amine, Visité')).toBeNull();
    await fireEvent.changeText(
      screen.getByLabelText('Rechercher : nom, code, adresse, téléphone'),
      'bir el',
    );
    expect(screen.getByText('1 client')).toBeOnTheScreen();
    expect(screen.getByLabelText('Supérette Bir El Djir, Hors programme')).toBeOnTheScreen();
    // Recherche par téléphone, avec le filtre « Hors programme »
    await fireEvent.changeText(
      screen.getByLabelText('Rechercher : nom, code, adresse, téléphone'),
      '0555 123',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Hors programme' }));
    expect(screen.getByText('1 client')).toBeOnTheScreen();
  });

  // Les actions du glissement sont aussi rendues (simulation) : la feuille « ⋯ » est la dernière
  it('« ⋯ » : Visiter, Localiser sur l’adresse, Appeler ; actions impossibles grisées', async () => {
    fakeSync.local = sectorState();
    await show();
    await fireEvent.press(screen.getByRole('tab', { name: 'Tout le secteur (3)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Actions pour Kiosque Sans Fiche' }));
    expect(screen.getByText('Ni position ni adresse précise')).toBeOnTheScreen();
    expect(screen.getByText('Aucun numéro')).toBeOnTheScreen();
    expect(
      screen
        .getAllByRole('button', { name: 'Appeler' })
        .some((b) => b.props.accessibilityState?.disabled),
    ).toBe(true);
    await fireEvent.press(screen.getByLabelText('Fermer'));

    await fireEvent.press(
      screen.getByRole('button', { name: 'Actions pour Supérette Bir El Djir' }),
    );
    const call = screen
      .getAllByRole('button', { name: 'Appeler' })
      .filter((b) => !b.props.accessibilityState?.disabled)
      .at(-1)!;
    await fireEvent.press(call);
    expect(Linking.openURL).toHaveBeenCalledWith('tel:0555123456');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Actions pour Supérette Bir El Djir' }),
    );
    const locate = screen
      .getAllByRole('button', { name: 'Localiser' })
      .filter((b) => !b.props.accessibilityState?.disabled)
      .at(-1)!;
    await fireEvent.press(locate);
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('destination=Cit%C3%A9%2020%20ao%C3%BBt'),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Actions pour Supérette Bir El Djir' }),
    );
    const visit = screen
      .getAllByRole('button', { name: 'Visiter' })
      .filter((b) => !b.props.accessibilityState?.disabled)
      .at(-1)!;
    await fireEvent.press(visit);
    // L'écran de visite s'ouvre : la visite ne démarre que par son bouton
    expect(router.push).toHaveBeenCalledWith('/seller/visit/c2');
  });

  it('journée non démarrée : Visiter grisé, avec la raison', async () => {
    fakeSync.local = loadState(sellerRows());
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Actions pour Épicerie Amine' }));
    expect(screen.getByText('Démarrez votre journée')).toBeOnTheScreen();
  });
});

describe('carte des clients', () => {
  it('MapPin vert pour la visite réalisée, rouge sinon ; légende et clients sans position', async () => {
    fakeSync.local = sectorState();
    await render(
      <TodayProvider>
        <SellerMapScreen />
      </TodayProvider>,
    );
    // Sans clé MapTiler (tests) : OpenStreetMap, choisi sans requête
    await screen.findByTestId('customers');
    expect(screen.getByText('Visite non réalisée')).toBeOnTheScreen();
    expect(screen.getByText('Visite réalisée')).toBeOnTheScreen();
    const features = () =>
      (mockMap.customers!.data as { features: { properties: { id: string; done: boolean } }[] })
        .features;
    expect(features()).toEqual([expect.objectContaining({ properties: { id: 'c1', done: true } })]);
    expect(mockMap['customers-pins']!.layout).toMatchObject({
      'icon-image': ['case', ['get', 'done'], 'pin-green', 'pin-red'],
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Tous les clients (3)' }));
    // c2 et c3 sans position : signalés, pas de punaise inventée
    expect(screen.getByText('2 clients sans position')).toBeOnTheScreen();
    expect(features()).toHaveLength(1);
    // Appui sur la punaise : panneau avec l'adresse et les trois actions
    const onPress = mockMap.customers!.onPress as (e: unknown) => void;
    await act(async () => onPress({ nativeEvent: { features: [{ properties: { id: 'c1' } }] } }));
    expect(screen.getByText('Rue 1')).toBeOnTheScreen();
    for (const name of ['Visiter', 'Localiser', 'Appeler'])
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    expect(screen.getByText('Appeler : Aucun numéro')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Localiser' }));
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=35.7,-0.6&travelmode=driving',
    );
  });
});

describe('fond de carte : MapTiler, sinon OpenStreetMap', () => {
  const point = [{ id: 'p1', latitude: 35.7, longitude: -0.6, done: false }];
  const showMap = () => render(<CustomerMap points={point} position={null} onSelect={() => {}} />);
  const replying = (status: number) =>
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status } as Response);

  it('clé absente : style OSM et attribution OpenStreetMap', async () => {
    await showMap();
    await screen.findByTestId('map');
    expect(mockMap.map!.mapStyle).toMatchObject({ sources: { osm: { type: 'raster' } } });
    expect(screen.getByText('© OpenStreetMap contributors')).toBeOnTheScreen();
  });

  it('clé acceptée : style MapTiler et attribution MapTiler', async () => {
    replying(200);
    await mapProvider('cle-test');
    await showMap();
    await screen.findByTestId('map');
    expect(mockMap.map!.mapStyle).toBe(
      'https://api.maptiler.com/maps/streets-v2/style.json?key=cle-test',
    );
    expect(screen.getByText('© MapTiler © OpenStreetMap contributors')).toBeOnTheScreen();
  });

  it('clé refusée (403) : OpenStreetMap', async () => {
    replying(403);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await mapProvider('mauvaise-cle');
    await showMap();
    await screen.findByTestId('map');
    expect(mockMap.map!.mapStyle).toMatchObject({ sources: { osm: { type: 'raster' } } });
  });

  it('style MapTiler en échec : bascule OSM ; OSM en échec : message', async () => {
    replying(200);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await mapProvider('cle-test');
    await showMap();
    await screen.findByTestId('map');
    await act(async () => (mockMap.map!.onDidFailLoadingMap as () => void)());
    expect(mockMap.map!.mapStyle).toMatchObject({ sources: { osm: { type: 'raster' } } });
    expect(screen.getByText('© OpenStreetMap contributors')).toBeOnTheScreen();
    await act(async () => (mockMap.map!.onDidFailLoadingMap as () => void)());
    expect(
      screen.getByText('Fond de carte indisponible : les punaises restent affichées.'),
    ).toBeOnTheScreen();
  });
});
