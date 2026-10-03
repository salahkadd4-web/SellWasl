import { colors } from '@sellwasl/config';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import {
  ensureBluetoothPermissions,
  isBluetoothPrintingAvailable,
  listPairedPrinters,
  printBytes,
} from '@/printing/bluetooth';
import { encodeTestTicket, type TicketWidth } from '@/printing/receipt';

/** Test d'impression sur imprimante réelle (plan, phase 2 ; architecture §13.2). */
export default function PrinterTestScreen() {
  const [width, setWidth] = useState<TicketWidth>(58);
  const [printers, setPrinters] = useState<BluetoothDevice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPrinters() {
    setMessage(null);
    try {
      if (!(await ensureBluetoothPermissions())) {
        setMessage('Autorisation Bluetooth refusée.');
        return;
      }
      const devices = await listPairedPrinters();
      setPrinters(devices);
      if (devices.length === 0) {
        setMessage("Aucune imprimante appairée. Appairez-la d'abord dans les réglages Bluetooth.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function print(address: string) {
    setBusy(true);
    setMessage(null);
    const started = Date.now();
    try {
      await printBytes(address, encodeTestTicket(width, new Date()));
      setMessage(`Ticket envoyé en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!isBluetoothPrintingAvailable()) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          L'impression Bluetooth n'est pas disponible dans Expo Go. Elle fonctionne dans la version
          compilée de l'application (voir le README).
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {([58, 80] as const).map((w) => (
          <Pressable
            key={w}
            onPress={() => setWidth(w)}
            style={[styles.chip, width === w && styles.chipActive]}
          >
            <Text style={[styles.chipText, width === w && styles.chipTextActive]}>{w} mm</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.primary} onPress={() => void loadPrinters()}>
        <Text style={styles.primaryText}>Chercher les imprimantes appairées</Text>
      </Pressable>

      {message && <Text style={styles.message}>{message}</Text>}

      <FlatList
        data={printers}
        keyExtractor={(p) => p.address}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.printer}
            disabled={busy}
            onPress={() => void print(item.address)}
          >
            <Text style={styles.printerName}>{item.name || 'Imprimante sans nom'}</Text>
            <Text style={styles.printerAddress}>{item.address}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDark, fontWeight: '600' },
  chipTextActive: { color: colors.background },
  primary: { backgroundColor: colors.primary, borderRadius: 10, padding: 16, alignItems: 'center' },
  primaryText: { color: colors.background, fontWeight: '700' },
  message: { color: colors.textDark },
  printer: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 16 },
  printerName: { fontWeight: '600', color: colors.textDark },
  printerAddress: { color: colors.muted, marginTop: 4 },
});
