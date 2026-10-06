import { receiptByNumber } from '@sellwasl/offline';
import type { DaySummaryDto, ReceiptPrintDto, TicketSettingsDto } from '@sellwasl/validation';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { request } from '@/api/client';
import { currentLocal } from '@/offline/engine';
import { errorMessage } from '@/seller/format';
import { isBluetoothPrintingAvailable, printBytes } from './bluetooth';
import { encodeDaySummary, encodeReceipt } from './receipt';

/**
 * Impression des bons (BR-IMP-01 à 06) : imprimante choisie une fois et gardée sur le téléphone,
 * contenu construit sur le téléphone, même sans réseau (phase 23). Une impression ratée ne bloque
 * jamais le travail : le bon reste réimprimable depuis « Bons du jour ».
 */
const PRINTER_KEY = 'sellwasl.printer';

export interface SavedPrinter {
  address: string;
  name: string;
}

export async function savedPrinter(): Promise<SavedPrinter | null> {
  try {
    const raw = await SecureStore.getItemAsync(PRINTER_KEY);
    return raw ? (JSON.parse(raw) as SavedPrinter) : null;
  } catch {
    return null;
  }
}

export async function savePrinter(printer: SavedPrinter): Promise<void> {
  await SecureStore.setItemAsync(PRINTER_KEY, JSON.stringify(printer));
}

/** Format du ticket réglé par l'administrateur, reçu à la synchronisation. */
async function ticketSettings(): Promise<TicketSettingsDto> {
  const ticket = (await currentLocal()).settings?.ticket;
  if (ticket) return ticket;
  return request<TicketSettingsDto>('/me/ticket');
}

async function send(encode: (ticket: TicketSettingsDto) => Uint8Array): Promise<string | null> {
  try {
    if (!isBluetoothPrintingAvailable())
      return "L'impression exige la version compilée de l'application (pas Expo Go).";
    const printer = await savedPrinter();
    if (!printer) return 'Aucune imprimante choisie : choisissez-la dans « Bons du jour ».';
    await printBytes(printer.address, encode(await ticketSettings()));
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}

/** Imprime un bon du jour ; renvoie le message d'erreur, ou null. */
export async function printReceipt(
  number: string,
  options: { duplicate: boolean; receipt?: ReceiptPrintDto },
): Promise<string | null> {
  try {
    const receipt = options.receipt ?? receiptByNumber(await currentLocal(), number);
    if (!receipt) return `Bon ${number} introuvable.`;
    return send((ticket) => encodeReceipt(receipt, ticket, { duplicate: options.duplicate }));
  } catch (e) {
    return errorMessage(e);
  }
}

export async function printDaySummary(summary: DaySummaryDto): Promise<string | null> {
  return send((ticket) => encodeDaySummary(summary, ticket));
}

/** Après une livraison, une vente ou un encaissement : impression du bon, sans bloquer. */
export function printAfter(number: string): void {
  void printReceipt(number, { duplicate: false }).then((failure) => {
    if (failure)
      Alert.alert(
        'Bon non imprimé',
        `${failure}\nVous pourrez le réimprimer depuis « Bons du jour ».`,
      );
  });
}
