import * as SecureStore from 'expo-secure-store';

/**
 * Données d'association et de session, dans le stockage chiffré du téléphone (architecture §16).
 * Le jeton d'accès reste en mémoire ; seul le jeton de rafraîchissement est conservé.
 */
const KEYS = {
  deviceId: 'sellwasl.deviceId',
  refreshToken: 'sellwasl.refreshToken',
  profile: 'sellwasl.profile',
  /** Dernier numéro d'ordre des opérations envoyées (docs/api.md §6.1). */
  deviceSeq: 'sellwasl.deviceSeq',
  /** Opération partie sans réponse du serveur, renvoyée avant toute autre. */
  pendingOp: 'sellwasl.pendingOp',
  /** Dernière séquence des reçus de dette de cet appareil (ARC-11). */
  receiptSeq: 'sellwasl.receiptSeq',
} as const;

/** Ce que l'écran de connexion affiche sans réseau : à qui appartient ce téléphone. */
export interface DeviceProfile {
  userCode: string;
  firstName: string;
  lastName: string;
  companyName: string;
  roleName: string;
  /** Absent des profils enregistrés avant la phase 15. */
  roleCode?: string;
  series: string;
}

export const secureStorage = {
  getDeviceId: () => SecureStore.getItemAsync(KEYS.deviceId),
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.refreshToken),
  async getProfile(): Promise<DeviceProfile | null> {
    const raw = await SecureStore.getItemAsync(KEYS.profile);
    return raw ? (JSON.parse(raw) as DeviceProfile) : null;
  },
  async saveDevice(deviceId: string, profile: DeviceProfile): Promise<void> {
    await SecureStore.setItemAsync(KEYS.deviceId, deviceId);
    await SecureStore.setItemAsync(KEYS.profile, JSON.stringify(profile));
  },
  setRefreshToken: (token: string) => SecureStore.setItemAsync(KEYS.refreshToken, token),
  clearRefreshToken: () => SecureStore.deleteItemAsync(KEYS.refreshToken),
  async getNumber(key: 'deviceSeq' | 'receiptSeq'): Promise<number> {
    return Number((await SecureStore.getItemAsync(KEYS[key])) ?? '0') || 0;
  },
  setNumber: (key: 'deviceSeq' | 'receiptSeq', value: number) =>
    SecureStore.setItemAsync(KEYS[key], String(value)),
  getPendingOp: () => SecureStore.getItemAsync(KEYS.pendingOp),
  setPendingOp: (value: string | null) =>
    value
      ? SecureStore.setItemAsync(KEYS.pendingOp, value)
      : SecureStore.deleteItemAsync(KEYS.pendingOp),
  async clearAll(): Promise<void> {
    await Promise.all(Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key)));
  },
};
