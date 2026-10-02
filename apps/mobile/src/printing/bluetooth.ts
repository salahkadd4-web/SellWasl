import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic, { type BluetoothDevice } from 'react-native-bluetooth-classic';

/**
 * Transport Bluetooth classique (SPP) vers l'imprimante (architecture §13.1).
 * Isolé ici pour pouvoir changer de bibliothèque sans toucher aux tickets.
 */

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
  const enabled = await RNBluetoothClassic.isBluetoothEnabled();
  if (!enabled) {
    throw new Error('Le Bluetooth est désactivé.');
  }
  return RNBluetoothClassic.getBondedDevices();
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
  const alreadyConnected = await RNBluetoothClassic.isDeviceConnected(address);
  const device = alreadyConnected
    ? await RNBluetoothClassic.getConnectedDevice(address)
    : await RNBluetoothClassic.connectToDevice(address);
  const ok = await device.write(toBase64(bytes), 'base64');
  if (!ok) {
    throw new Error("L'imprimante n'a pas accepté les données.");
  }
}
