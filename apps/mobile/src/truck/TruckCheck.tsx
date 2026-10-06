import { colors } from '@sellwasl/config';
import { truckCheckView } from '@sellwasl/offline';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocal } from '@/offline/SyncProvider';
import { errorMessage } from '@/seller/format';
import { sendOperation } from '@/sync/operations';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Pointage du camion au démarrage (BR-CV-02, BR-PRE-05) : tout le stock du camion, chargements du
 * jour et stock resté de la veille ; un écart est ajusté et signalé au superviseur.
 */
export function TruckCheck({
  workdayId,
  onDone,
}: {
  workdayId: string | null;
  onDone: () => void;
}) {
  // Lignes à pointer gardées sur le téléphone (phase 23)
  const { data: lines } = useLocal(truckCheckView, []);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compté proposé : ce qui est attendu dans le camion (chargement validé compris)
  useEffect(() => {
    if (!lines) return;
    setCounted((current) =>
      Object.keys(current).length > 0
        ? current
        : Object.fromEntries(lines.map((l) => [l.variantId, String(l.inTruck)])),
    );
  }, [lines]);

  async function submit() {
    if (!lines) return;
    if (lines.some((l) => !/^\d+$/.test((counted[l.variantId] ?? '').trim())))
      return setError('Saisissez une quantité entière pour chaque article.');
    setError(null);
    setBusy(true);
    try {
      const hasGap = lines.some((l) => Number(counted[l.variantId]) !== l.inTruck);
      await sendOperation(
        'truck.check',
        {
          lines: lines.map((l) => ({
            variantId: l.variantId,
            countedQty: Number(counted[l.variantId]),
          })),
        },
        workdayId,
      );
      Alert.alert('Camion pointé', hasGap ? "L'écart est signalé au superviseur." : 'Sans écart.');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!lines && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Quantités en unité de base : comptez ce qui est vraiment dans le camion.">
        Pointer le camion
      </Title>
      {lines?.length === 0 ? <Message tone="info">Le camion est vide.</Message> : null}
      {lines && lines.length > 0 ? (
        <Card>
          {lines.map((l) => {
            const value = Number(counted[l.variantId]);
            const gap = Number.isInteger(value) ? value - l.inTruck : 0;
            return (
              <View key={l.variantId} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{label(l)}</Text>
                  <Text style={gap ? styles.gap : styles.muted}>
                    Attendu {l.inTruck}
                    {l.toReceive ? ` (dont ${l.toReceive} chargés ce jour)` : ''}
                    {gap ? ` · écart ${gap > 0 ? '+' : ''}${gap}` : ''}
                  </Text>
                </View>
                <TextInput
                  accessibilityLabel={`Compté pour ${label(l)}`}
                  keyboardType="number-pad"
                  value={counted[l.variantId] ?? ''}
                  onChangeText={(v) => setCounted((c) => ({ ...c, [l.variantId]: v }))}
                  style={styles.qty}
                />
              </View>
            );
          })}
        </Card>
      ) : null}
      {error ? <Message>{error}</Message> : null}
      {lines ? (
        <PrimaryButton title="Confirmer le pointage" busy={busy} onPress={() => void submit()} />
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
