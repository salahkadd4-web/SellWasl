import { colors } from '@sellwasl/config';
import type { LoadDto } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { request } from '@/api/client';
import { idempotencyDone, idempotencyKey } from '@/api/idempotency';
import { errorMessage } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/** Validation d'un chargement cash van préparé (BR-CV-01) : quantités réellement chargées. */
export default function ValidateLoadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [load, setLoad] = useState<LoadDto | null>(null);
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<LoadDto>(`/loads/${id}`)
      .then((l) => {
        setLoad(l);
        setLoaded(Object.fromEntries(l.lines.map((x) => [x.variantId, String(x.qty)])));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  async function submit() {
    if (!load) return;
    if (load.lines.some((l) => !/^\d+$/.test((loaded[l.variantId] ?? '').trim())))
      return setError('Saisissez une quantité entière pour chaque article.');
    setError(null);
    setBusy(true);
    try {
      await request(`/loads/${load.id}/validate`, {
        method: 'POST',
        headers: idempotencyKey(`load:${load.id}`),
        body: JSON.stringify({
          lines: load.lines.map((l) => ({
            variantId: l.variantId,
            loadedQty: Number(loaded[l.variantId]),
          })),
        }),
      });
      idempotencyDone(`load:${load.id}`);
      Alert.alert(
        'Chargement validé',
        `${load.truck.code} : le vendeur doit maintenant le pointer.`,
      );
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!load && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Quantités réellement chargées, en unité de base.">
        {load ? `${load.truck.code} · ${load.user.name}` : 'Chargement'}
      </Title>
      {load ? (
        <Card>
          {load.lines.map((l) => (
            <View key={l.variantId} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{label(l)}</Text>
                <Text style={styles.muted}>Prévu {l.qty}</Text>
              </View>
              <TextInput
                accessibilityLabel={`Chargé pour ${label(l)}`}
                keyboardType="number-pad"
                value={loaded[l.variantId] ?? ''}
                onChangeText={(v) => setLoaded((x) => ({ ...x, [l.variantId]: v }))}
                style={styles.qty}
              />
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <Message>{error}</Message> : null}
      {load ? (
        <PrimaryButton title="Valider le chargement" busy={busy} onPress={() => void submit()} />
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
