import { colors } from '@sellwasl/config';
import type { LotDto, UnloadDto, UnloadPreviewLine } from '@sellwasl/validation';
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
import { idempotencyDone, idempotencyKey } from '@/api/idempotency';
import { errorMessage, formatDA } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';
import { PhotoCapture } from '@/warehouse/PhotoCapture';

interface Reason {
  id: string;
  kind: string;
  label: string;
  isActive: boolean;
}

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** États hors stock d'un article compté (phase 21) ; le reste est remis en stock. */
const LOSSES = [
  ['DEFECTIVE', 'Défectueux'],
  ['EXPIRED', 'Périmé'],
  ['BROKEN', 'Cassé'],
] as const;
type Loss = (typeof LOSSES)[number][0];
interface Split {
  qty: Partial<Record<Loss, string>>;
  lotId: string | null;
  photoKey: string | null;
}
const lossOf = (s: Split | undefined) =>
  s ? LOSSES.reduce((sum, [c]) => sum + (Number(s.qty[c]) || 0), 0) : 0;

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
  const [split, setSplit] = useState<Record<string, Split>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [lots, setLots] = useState<Record<string, LotDto[]>>({});
  const splitOf = (variantId: string): Split =>
    split[variantId] ?? { qty: {}, lotId: null, photoKey: null };
  const setSplitOf = (variantId: string, patch: Partial<Split>) =>
    setSplit((x) => ({ ...x, [variantId]: { ...splitOf(variantId), ...patch } }));

  function toggle(variantId: string) {
    setOpen(open === variantId ? null : variantId);
    if (!lots[variantId])
      void request<LotDto[]>(`/lots?variantId=${variantId}`)
        .then((list) => setLots((x) => ({ ...x, [variantId]: list })))
        .catch(() => undefined);
  }
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
    // Répartition par état : le reste du compté est remis en stock
    const conditions: Record<string, unknown>[] = [];
    for (const l of lines) {
      const s = split[l.variantId];
      const loss = lossOf(s);
      if (!s || loss === 0) continue;
      const total = Number(counted[l.variantId]);
      if (loss > total) return setError(`${label(l)} : la répartition dépasse le compté.`);
      if (Number(s.qty.DEFECTIVE) > 0 && !s.photoKey)
        return setError(`${label(l)} : photographiez le produit défectueux.`);
      if (total > loss)
        conditions.push({ variantId: l.variantId, condition: 'RESTOCK', qty: total - loss });
      for (const [c] of LOSSES) {
        const qty = Number(s.qty[c]) || 0;
        if (qty > 0)
          conditions.push({
            variantId: l.variantId,
            condition: c,
            qty,
            ...(s.lotId && { lotId: s.lotId }),
            ...(c === 'DEFECTIVE' && { photoKey: s.photoKey }),
          });
      }
    }
    setError(null);
    setBusy(true);
    try {
      const done = await request<UnloadDto>('/unloads', {
        method: 'POST',
        headers: idempotencyKey(`unload:${workdayId}`),
        body: JSON.stringify({
          workdayId,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            countedQty: Number(counted[l.variantId]),
            reasonId: gapOf(l) ? reasonOf[l.variantId] : undefined,
          })),
          conditions,
        }),
      });
      idempotencyDone(`unload:${workdayId}`);
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
                {gap ? ` · ${formatDA(gap * l.unitValue)}` : ''}
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
            <Pressable onPress={() => toggle(l.variantId)}>
              <Text style={styles.link}>
                {lossOf(split[l.variantId]) > 0
                  ? `${lossOf(split[l.variantId])} hors stock (défectueux, périmé, cassé)`
                  : 'Produits défectueux, périmés ou cassés ?'}
              </Text>
            </Pressable>
            {open === l.variantId ? (
              <View style={styles.split}>
                {LOSSES.map(([c, name]) => (
                  <View key={c} style={styles.count}>
                    <Text style={styles.lossName}>{name}</Text>
                    <TextInput
                      accessibilityLabel={`${name} pour ${label(l)}`}
                      keyboardType="number-pad"
                      value={splitOf(l.variantId).qty[c] ?? ''}
                      onChangeText={(v) =>
                        setSplitOf(l.variantId, { qty: { ...splitOf(l.variantId).qty, [c]: v } })
                      }
                      style={styles.qty}
                    />
                  </View>
                ))}
                {(lots[l.variantId] ?? []).length > 0 ? (
                  <View style={styles.chips}>
                    {lots[l.variantId]!.map((lot) => (
                      <Pressable
                        key={lot.id}
                        onPress={() =>
                          setSplitOf(l.variantId, {
                            lotId: splitOf(l.variantId).lotId === lot.id ? null : lot.id,
                          })
                        }
                        style={[
                          styles.chip,
                          splitOf(l.variantId).lotId === lot.id && styles.chipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            splitOf(l.variantId).lotId === lot.id && styles.chipTextActive,
                          ]}
                        >
                          Lot {lot.number}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {Number(splitOf(l.variantId).qty.DEFECTIVE) > 0 ? (
                  <PhotoCapture
                    photoKey={splitOf(l.variantId).photoKey}
                    onTaken={(key) => setSplitOf(l.variantId, { photoKey: key })}
                  />
                ) : null}
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
  link: { fontSize: 15, fontWeight: '600', color: colors.primary },
  split: { gap: 10 },
  lossName: { flex: 1, fontSize: 15, color: colors.textDark },
});
