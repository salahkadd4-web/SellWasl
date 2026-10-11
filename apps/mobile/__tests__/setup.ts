// Modules natifs simulés : aucun appareil ni réseau dans les tests d'écrans (phase 28).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissTo: jest.fn(),
  };
  return {
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: (effect: () => void) => {
      const { useEffect } = jest.requireActual<typeof import('react')>('react');
      useEffect(effect, [effect]);
    },
    Link: ({ children }: { children: unknown }) => children,
    __router: router,
  };
});
// Le réseau réel est interdit : un appel non simulé fait échouer le test
globalThis.fetch = jest.fn(async () => {
  throw new Error('Réseau interdit dans les tests d’écrans.');
}) as unknown as typeof fetch;

// Synchronisation, position, file d'envoi : simulées (le test choisit l'état local)
jest.mock('@/offline/SyncProvider', () => jest.requireActual('./fake-sync'));
jest.mock('@/device/heartbeat', () => ({
  setPositionSharing: jest.fn(),
  useHeartbeat: jest.fn(),
}));
jest.mock('@/offline/workday', () => ({
  START_NEEDS_NETWORK: 'Réseau nécessaire',
  startWorkday: jest.fn(async () => undefined),
}));
jest.mock('@/sync/operations', () => ({
  ...jest.requireActual('@/sync/operations'),
  sendOperation: jest.fn(async () => ({})),
}));
// Date du téléphone : celle des jeux de données de @sellwasl/offline
jest.mock('@/offline/ids', () => ({
  ...jest.requireActual('@/offline/ids'),
  phoneDate: () => '2027-06-05',
}));
// Impression Bluetooth : simulée
jest.mock('@/printing/printer', () => ({
  ...jest.requireActual('@/printing/printer'),
  printAfter: jest.fn(),
}));
// Position GPS : un point fixe
jest.mock('@/location/useLocation', () => ({
  ...jest.requireActual('@/location/useLocation'),
  readPosition: jest.fn(async () => ({ latitude: 35.7, longitude: -0.6 })),
}));
