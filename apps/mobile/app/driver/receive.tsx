import { colors } from '@sellwasl/config';
import type { DriverRouteDto } from '@sellwasl/validation';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { sendOperation } from '@/sync/operations';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Réception du chargement (UC-30, BR-PRE-05) : le livreur vérifie son camion ; un écart est
 * signalé et il livre ce qu'il a reçu.
 */
export default function ReceiveScreen() {
  const router = useRouter();
  const [route, setRoute] = useState<DriverRouteDto | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<DriverRouteDto>('/me/route')
      .then((r) => {
        setRoute(r);
        setReceived(
          Object.fromEntries(
            (r.loadToReceive?.lines ?? []).map((l) => [l.variantId, String(l.qty)]),
          ),
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const load = route?.loadToReceive;

  async function submit() {
    if (!load || !route?.workday) return;
    if (load.lines.some((l) => !/^\d+$/.test((received[l.variantId] ?? '').trim())))
      return setError('Saisissez une quantité entière pour chaque article.');
    setError(null);
    setBusy(true);
    try {
      const result = await sendOperation<{ hasGap: boolean }>(
        'load.receive',
        {
          loadId: load.id,
          lines: load.lines.map((l) => ({
            variantId: l.variantId,
            receivedQty: Number(received[l.variantId]),
          })),
        },
        route.workday.id,
      );
      Alert.alert(
        'Chargement reçu',
        result.hasGap ? "L'écart est signalé au superviseur." : 'Sans écart.',
      );
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!route && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Quantités en unité de base : corrigez ce qui manque ou ce qui est en trop.">
        {load ? `Camion ${load.truckCode}` : 'Réception du chargement'}
      </Title>
      {!load && route ? <Message tone="info">Aucun chargement à recevoir.</Message> : null}
      {load ? (
        <Card>
          {load.lines.map((l) => {
            const value = Number(received[l.variantId]);
            const gap = Number.isInteger(value) ? value - l.qty : 0;
            return (
              <View key={l.variantId} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{label(l)}</Text>
                  <Text style={gap ? styles.gap : styles.muted}>
                    Chargé {l.qty}
                    {gap ? ` · écart ${gap > 0 ? '+' : ''}${gap}` : ''}
                  </Text>
                </View>
                <TextInput
                  accessibilityLabel={`Reçu pour ${label(l)}`}
                  keyboardType="number-pad"
                  value={received[l.variantId] ?? ''}
                  onChangeText={(v) => setReceived((r) => ({ ...r, [l.variantId]: v }))}
                  style={styles.qty}
                />
              </View>
            );
          })}
        </Card>
      ) : null}
      {error ? <Message>{error}</Message> : null}
      {load ? (
        <PrimaryButton title="Confirmer la réception" busy={busy} onPress={() => void submit()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  gap: { fontSize: 14, fontWeight: '700', color: colors.status.error },
  qty: {
    width: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: 'right',
    color: colors.textDark,
    backgroundColor: colors.background,
  },
});
