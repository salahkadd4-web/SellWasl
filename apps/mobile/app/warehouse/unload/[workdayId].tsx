import { colors } from '@sellwasl/config';
import type { UnloadDto, UnloadPreviewLine } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

interface Reason {
  id: string;
  kind: string;
  label: string;
  isActive: boolean;
}

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Déchargement d'un camion (UC-43, BR-STK-07) : le compté part du théorique ; un écart, positif
 * ou négatif, demande un motif.
 */
export default function UnloadScreen() {
  const { workdayId } = useLocalSearchParams<{ workdayId: string }>();
  const router = useRouter();
  const [lines, setLines] = useState<UnloadPreviewLine[] | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasonOf, setReasonOf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      request<UnloadPreviewLine[]>(`/unloads/preview?workdayId=${workdayId}`),
      request<Reason[]>('/reasons'),
    ])
      .then(([preview, all]) => {
        setLines(preview);
        setCounted(Object.fromEntries(preview.map((l) => [l.variantId, String(l.theoretical)])));
        setReasons(all.filter((r) => r.kind === 'ADJUSTMENT' && r.isActive));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [workdayId]);

  const gapOf = (l: UnloadPreviewLine) => {
    const v = (counted[l.variantId] ?? '').trim();
    return /^\d+$/.test(v) ? Number(v) - l.theoretical : null;
  };

  async function submit() {
    if (!lines) return;
    if (lines.some((l) => gapOf(l) === null))
      return setError('Comptez chaque article : quantités entières.');
    if (lines.some((l) => gapOf(l) !== 0 && !reasonOf[l.variantId]))
      return setError('Choisissez le motif de chaque écart.');
    setError(null);
    setBusy(true);
    try {
      const done = await request<UnloadDto>('/unloads', {
        method: 'POST',
        body: JSON.stringify({
          workdayId,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            countedQty: Number(counted[l.variantId]),
            reasonId: gapOf(l) ? reasonOf[l.variantId] : undefined,
          })),
        }),
      });
      Alert.alert(
        'Camion déchargé',
        `${done.hasGap ? 'Avec écart, signalé au superviseur.' : 'Sans écart.'} ${
          done.keepsStockInTruck
            ? 'Le stock reste dans le camion.'
            : 'Le stock est rentré au dépôt.'
        }`,
      );
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!lines && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Quantités en unité de base. Théorique = chargé − livré − offert.">
        Décharger le camion
      </Title>
      {lines?.length === 0 ? <Message tone="info">Le camion est vide.</Message> : null}
      {lines?.map((l) => {
        const gap = gapOf(l);
        return (
          <Card key={l.variantId} title={label(l)}>
            <Text style={styles.muted}>
              Chargé {l.loaded} · livré {l.delivered} · théorique {l.theoretical}
            </Text>
            <View style={styles.count}>
              <Text style={styles.name}>Compté</Text>
              <TextInput
                accessibilityLabel={`Compté pour ${label(l)}`}
                keyboardType="number-pad"
                value={counted[l.variantId] ?? ''}
                onChangeText={(v) => setCounted((c) => ({ ...c, [l.variantId]: v }))}
                style={styles.qty}
              />
              <Text style={!gap ? styles.muted : gap > 0 ? styles.plus : styles.minus}>
                {gap === null ? '—' : signed(gap)}
              </Text>
            </View>
            {gap ? (
              <View style={styles.chips}>
                {reasons.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => setReasonOf((x) => ({ ...x, [l.variantId]: r.id }))}
                    style={[styles.chip, reasonOf[l.variantId] === r.id && styles.chipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        reasonOf[l.variantId] === r.id && styles.chipTextActive,
                      ]}
                    >
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
      {error ? <Message>{error}</Message> : null}
      {lines ? (
        <PrimaryButton
          title="Valider le déchargement"
          busy={busy}
          onPress={() =>
            Alert.alert('Valider le déchargement ?', 'La journée ne pourra plus être rouverte.', [
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
  muted: { fontSize: 14, color: colors.muted },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  count: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plus: { fontSize: 16, fontWeight: '700', color: colors.status.synced },
  minus: { fontSize: 16, fontWeight: '700', color: colors.status.error },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
});
