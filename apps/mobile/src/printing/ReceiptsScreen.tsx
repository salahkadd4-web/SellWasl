import { colors } from '@sellwasl/config';
import type { DaySummaryDto, ReceiptPrintDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import { request } from '@/api/client';
import { errorMessage, formatDA } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';
import {
  ensureBluetoothPermissions,
  isBluetoothPrintingAvailable,
  listPairedPrinters,
} from './bluetooth';
import {
  printDaySummary,
  printReceipt,
  type SavedPrinter,
  savedPrinter,
  savePrinter,
} from './printer';

const KIND = { DELIVERY: 'Livraison', SALE: 'Vente', DEBT: 'Reçu de dette' } as const;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' });

/**
 * Bons du jour (UC-34, UC-35) : imprimante du téléphone, réimpression marquée « DUPLICATA » et
 * tracée (BR-IMP-03), récapitulatif de la journée (BR-PAY-07).
 */
export function ReceiptsScreen({ reprint }: { reprint: (number: string) => Promise<unknown> }) {
  const [receipts, setReceipts] = useState<ReceiptPrintDto[] | null>(null);
  const [summary, setSummary] = useState<DaySummaryDto | null>(null);
  const [printer, setPrinter] = useState<SavedPrinter | null>(null);
  const [paired, setPaired] = useState<BluetoothDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        request<ReceiptPrintDto[]>('/me/receipts'),
        request<DaySummaryDto>('/me/day-summary'),
      ]);
      setReceipts(r);
      setSummary(s);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    void savedPrinter().then(setPrinter);
  }, [load]);

  async function choosePrinter() {
    setError(null);
    try {
      if (!(await ensureBluetoothPermissions())) return setError('Autorisation Bluetooth refusée.');
      const devices = await listPairedPrinters();
      if (devices.length === 0)
        return setError(
          "Aucune imprimante appairée : appairez-la d'abord dans les réglages Bluetooth.",
        );
      setPaired(devices);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function pick(device: BluetoothDevice) {
    const chosen = { address: device.address, name: device.name || device.address };
    await savePrinter(chosen);
    setPrinter(chosen);
    setPaired(null);
  }

  async function run(key: string, action: () => Promise<string | null>, done: string) {
    setError(null);
    setInfo(null);
    setBusy(key);
    try {
      const failure = await action();
      if (failure) setError(failure);
      else setInfo(done);
    } finally {
      setBusy(null);
    }
  }

  function duplicate(receipt: ReceiptPrintDto) {
    void run(
      receipt.number,
      async () => {
        // La réimpression est tracée avant d'imprimer (BR-IMP-03)
        try {
          await reprint(receipt.number);
        } catch (e) {
          return errorMessage(e);
        }
        const failure = await printReceipt(receipt.number, { duplicate: true, receipt });
        void load();
        return failure;
      },
      `Duplicata du bon ${receipt.number} imprimé.`,
    );
  }

  if (!receipts && !error)
    return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Imprimer, réimprimer et clôturer la caisse du jour.">Bons du jour</Title>

      <Card title="Imprimante">
        {isBluetoothPrintingAvailable() ? (
          <>
            <Text style={styles.line}>{printer ? printer.name : 'Aucune imprimante choisie'}</Text>
            {paired ? (
              paired.map((d) => (
                <PrimaryButton
                  key={d.address}
                  title={d.name || d.address}
                  variant="secondary"
                  onPress={() => void pick(d)}
                />
              ))
            ) : (
              <PrimaryButton
                title={printer ? "Changer d'imprimante" : "Choisir l'imprimante"}
                variant="secondary"
                onPress={() => void choosePrinter()}
              />
            )}
          </>
        ) : (
          <Message tone="info">
            L'impression Bluetooth fonctionne dans la version compilée de l'application, pas dans
            Expo Go.
          </Message>
        )}
      </Card>

      {error ? <Message>{error}</Message> : null}
      {info ? <Message tone="info">{info}</Message> : null}

      {summary ? (
        <Card title="Récapitulatif">
          <Text style={styles.line}>
            {summary.receipts} bon{summary.receipts > 1 ? 's' : ''} · vendu{' '}
            {formatDA(summary.totalSold)}
          </Text>
          <Text style={styles.muted}>
            Espèces des ventes {formatDA(summary.cashSales)} · dettes encaissées{' '}
            {formatDA(summary.cashDebts)} · crédit {formatDA(summary.credit)}
          </Text>
          <Text style={styles.big}>À verser : {formatDA(summary.expected)}</Text>
          <PrimaryButton
            title="Imprimer le récapitulatif"
            variant="secondary"
            busy={busy === 'summary'}
            onPress={() =>
              void run('summary', () => printDaySummary(summary), 'Récapitulatif imprimé.')
            }
          />
        </Card>
      ) : null}

      {receipts?.length === 0 ? <Message tone="info">Aucun bon aujourd'hui.</Message> : null}
      {receipts?.map((r) => (
        <Card key={r.number}>
          <View style={styles.head}>
            <Text style={styles.name}>{r.customer.name}</Text>
            <Text style={styles.muted}>{time(r.at)}</Text>
          </View>
          <Text style={styles.muted}>
            {KIND[r.kind]} {r.number}
            {r.reprints > 0 ? ` · réimprimé ${r.reprints} fois` : ''}
          </Text>
          <Text style={styles.line}>
            {r.kind === 'DEBT'
              ? `Payé ${formatDA(r.paid)}`
              : `Total ${formatDA(r.total)} · payé ${formatDA(r.paid)}`}
            {r.credit > 0 ? ` · crédit ${formatDA(r.credit)}` : ''}
          </Text>
          <PrimaryButton
            title="Réimprimer (duplicata)"
            variant="secondary"
            busy={busy === r.number}
            disabled={busy !== null && busy !== r.number}
            onPress={() => duplicate(r)}
          />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.textDark },
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  big: { fontSize: 18, fontWeight: '700', color: colors.primary },
});
