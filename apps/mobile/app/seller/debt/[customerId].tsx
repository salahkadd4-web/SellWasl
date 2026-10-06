import { colors } from '@sellwasl/config';
import { customerView } from '@sellwasl/offline';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { printAfter } from '@/printing/printer';
import { errorMessage, formatDA } from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId, nextReceiptNumber } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Encaissement d'une dette en espèces (UC-19), au plus égal à la dette (BR-PAY-05). */
export default function DebtScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const { today, act } = useToday();
  const { online } = useSync();
  // Dette à jour des encaissements en file (phase 23)
  const { data: customer } = useLocal((s) => customerView(s, customerId), [customerId]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function collect() {
    setError(null);
    const value = Number(amount.replace(/\s/g, ''));
    if (!Number.isInteger(value) || value <= 0) return setError('Saisissez un montant en dinars.');
    if (customer && value > customer.debtAmount)
      return setError(`Le montant dépasse la dette (${formatDA(customer.debtAmount)}).`);
    if (!today?.seller.series) return setError('Série du téléphone inconnue : reconnectez-vous.');
    setBusy(true);
    try {
      const number = await nextReceiptNumber(today.seller.code, today.seller.series);
      await act('payment.debt', { paymentId: newId(), number, customerId, amount: value });
      Alert.alert(
        'Encaissement enregistré',
        [
          `Reçu ${number} : ${formatDA(value)}.`,
          `Nouvelle dette : ${formatDA(Math.max(0, (customer?.debtAmount ?? 0) - value))}.`,
          online ? null : 'Enregistré sur le téléphone : il partira au retour du réseau.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      printAfter(number);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle="Espèces seulement.">{customer?.name ?? 'Encaisser une dette'}</Title>
      {customer ? (
        <Card>
          <Text style={styles.debt}>Dette actuelle : {formatDA(customer.debtAmount)}</Text>
        </Card>
      ) : null}
      <WorkdayGuard>
        <Input
          label="Montant encaissé (DA)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
        />
        {error ? <Message>{error}</Message> : null}
        <PrimaryButton title="Encaisser" onPress={() => void collect()} busy={busy} />
      </WorkdayGuard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  debt: { fontSize: 18, fontWeight: '700', color: colors.status.toVisit },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
