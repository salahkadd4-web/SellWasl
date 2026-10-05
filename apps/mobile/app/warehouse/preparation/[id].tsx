import { colors } from '@sellwasl/config';
import type { PrepareResult, RoutePreparationDto } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Préparation d'une tournée (UC-41, BR-PRE-03) : liste de chargement par article, puis quantité
 * préparée de chaque ligne dans son unité ; une quantité plus basse réduit la ligne.
 */
export default function PreparationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<RoutePreparationDto | null>(null);
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<RoutePreparationDto>(`/routes/${id}/preparation`)
      .then((v) => {
        setView(v);
        setPrepared(
          Object.fromEntries(
            v.orders.flatMap((o) => o.lines.map((l) => [l.lineId, String(l.defaultPrepared)])),
          ),
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  async function submit() {
    if (!view) return;
    const lines = view.orders.flatMap((o) =>
      o.lines.map((l) => ({ lineId: l.lineId, value: (prepared[l.lineId] ?? '').trim() })),
    );
    if (lines.some((l) => !/^\d+$/.test(l.value)))
      return setError('Saisissez une quantité entière pour chaque ligne.');
    setError(null);
    setBusy(true);
    try {
      const result = await request<PrepareResult>(`/routes/${id}/prepare`, {
        method: 'POST',
        body: JSON.stringify({
          lines: lines.map((l) => ({ lineId: l.lineId, preparedQty: Number(l.value) })),
        }),
      });
      Alert.alert(
        'Préparation validée',
        result.orders.map((o) => `${o.number} : ${formatDA(o.totalAmount)}`).join('\n'),
      );
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!view && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      {view ? (
        <Title subtitle={`Livraison du ${formatDate(view.route.deliveryDate)}`}>
          {view.route.driver.name}
        </Title>
      ) : null}
      {view ? (
        <Card title="Liste de chargement (unité de base)">
          {view.items.map((i) => (
            <View key={i.variantId} style={styles.item}>
              <Text style={styles.name}>{label(i)}</Text>
              <Text style={i.reservedBase < i.orderedBase ? styles.short : styles.muted}>
                {i.reservedBase} / {i.orderedBase}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {view?.orders.map((o) => (
        <Card key={o.orderId} title={`${o.number} · ${o.customerName}`}>
          {o.lines.map((l) => (
            <View key={l.lineId} style={styles.line}>
              <View style={styles.lineText}>
                <Text style={styles.name}>
                  {label(l)}
                  {l.kind === 'BONUS' ? ' (offert)' : ''}
                </Text>
                <Text style={styles.muted}>
                  Commandé {l.enteredQty} {l.unitName}
                </Text>
              </View>
              <TextInput
                accessibilityLabel={`Préparé pour ${label(l)}`}
                keyboardType="number-pad"
                value={prepared[l.lineId] ?? ''}
                onChangeText={(v) => setPrepared((p) => ({ ...p, [l.lineId]: v }))}
                style={styles.qty}
              />
            </View>
          ))}
        </Card>
      ))}
      {error ? <Message>{error}</Message> : null}
      {view ? (
        <PrimaryButton
          title="Valider la préparation"
          busy={busy}
          onPress={() =>
            Alert.alert('Valider la préparation ?', 'Les commandes passeront « Préparées ».', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Valider', onPress: () => void submit() },
            ])
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  lineText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  short: { fontSize: 14, fontWeight: '700', color: colors.status.error },
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
