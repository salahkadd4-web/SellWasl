import { colors } from '@sellwasl/config';
import type { CustomerDto } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { ApiClientError, request } from '@/api/client';
import { printAfter } from '@/printing/printer';
import { errorMessage, formatDA } from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId, nextReceiptNumber } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Après une réinstallation, la séquence locale des reçus repart de zéro : on avance jusqu'à un numéro libre. */
const MAX_NUMBER_RETRIES = 20;

/** Encaissement d'une dette en espèces (UC-19), au plus égal à la dette (BR-PAY-05). */
export default function DebtScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const { today, act } = useToday();
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<CustomerDto>(`/customers/${customerId}`)
      .then(setCustomer)
      .catch((e) => setError(errorMessage(e)));
  }, [customerId]);

  async function collect() {
    setError(null);
    const value = Number(amount.replace(/\s/g, ''));
    if (!Number.isInteger(value) || value <= 0) return setError('Saisissez un montant en dinars.');
    if (customer && value > customer.debtAmount)
      return setError(`Le montant dépasse la dette (${formatDA(customer.debtAmount)}).`);
    if (!today?.seller.series) return setError('Série du téléphone inconnue : reconnectez-vous.');
    setBusy(true);
    try {
      let result: { debtAmount: number; number: string } | null = null;
      let number = '';
      for (let attempt = 0; !result && attempt < MAX_NUMBER_RETRIES; attempt += 1) {
        number = await nextReceiptNumber(today.seller.code, today.seller.series);
        try {
          result = await act<{ debtAmount: number; number: string }>('payment.debt', {
            paymentId: newId(),
            number,
            customerId,
            amount: value,
          });
        } catch (e) {
          if (!(e instanceof ApiClientError && e.code === 'DUPLICATE')) throw e;
        }
      }
      if (!result) throw new Error('Aucun numéro de reçu libre. Contactez votre superviseur.');
      Alert.alert(
        'Encaissement enregistré',
        `Reçu ${result.number} : ${formatDA(value)}.\nNouvelle dette : ${formatDA(result.debtAmount)}.`,
      );
      printAfter(result.number);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      // La dette a peut-être changé (encaissement précédent enfin enregistré) : on la relit
      void request<CustomerDto>(`/customers/${customerId}`).then(setCustomer, () => undefined);
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
        <Text style={styles.muted}>L'impression du reçu arrive avec la phase des livraisons.</Text>
      </WorkdayGuard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  debt: { fontSize: 18, fontWeight: '700', color: colors.status.toVisit },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
