import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { BluetoothDevice } from 'react-native-bluetooth-classic';

/**
 * Transport Bluetooth classique (SPP) vers l'imprimante (architecture §13.1).
 * Isolé ici pour pouvoir changer de bibliothèque sans toucher aux tickets.
 */

/**
 * Le module natif n'existe que dans une version compilée de l'application (EAS ou expo run:android),
 * pas dans Expo Go : on le charge à la demande pour que le reste de l'application fonctionne partout.
 */
export function isBluetoothPrintingAvailable(): boolean {
  return Platform.OS === 'android' && NativeModules.RNBluetoothClassic != null;
}

function bluetooth(): typeof import('react-native-bluetooth-classic').default {
  if (!isBluetoothPrintingAvailable()) {
    throw new Error(
      "L'impression Bluetooth exige la version compilée de l'application (pas Expo Go).",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-bluetooth-classic').default;
}

/** Android 12 et plus : permissions demandées au premier usage de l'imprimante (architecture §9.2). */
export async function ensureBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const location = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return location === PermissionsAndroid.RESULTS.GRANTED;
}

/** Imprimantes déjà appairées dans les réglages Bluetooth d'Android. */
export async function listPairedPrinters(): Promise<BluetoothDevice[]> {
  const enabled = await bluetooth().isBluetoothEnabled();
  if (!enabled) {
    throw new Error('Le Bluetooth est désactivé.');
  }
  return bluetooth().getBondedDevices();
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}

/** Se connecte si besoin, puis envoie les octets ESC/POS. */
export async function printBytes(address: string, bytes: Uint8Array): Promise<void> {
  const alreadyConnected = await bluetooth().isDeviceConnected(address);
  const device = alreadyConnected
    ? await bluetooth().getConnectedDevice(address)
    : await bluetooth().connectToDevice(address);
  const ok = await device.write(toBase64(bytes), 'base64');
  if (!ok) {
    throw new Error("L'imprimante n'a pas accepté les données.");
  }
}
