import { colors } from '@sellwasl/config';
import { deliveryPreviewView, driverRouteView, truckStockView } from '@sellwasl/offline';
import type { DeliveryPreviewDto, DriverDeliveryDto } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { readPosition } from '@/location/useLocation';
import { phoneDate } from '@/offline/ids';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { printAfter } from '@/printing/printer';
import { errorMessage, formatDA } from '@/seller/format';
import { newId, nextDeliveryNumber, sendOperation } from '@/sync/operations';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';

interface Reason {
  id: string;
  kind: string;
  systemCode: string | null;
  label: string;
  isActive: boolean;
}
interface Added {
  variantId: string;
  unitId: string;
  qty: string;
}

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Livraison d'une commande (UC-32, UC-33) : quantités livrées, produits ajoutés depuis le camion,
 * montant à encaisser (BR-PAY-03), ou échec avec un motif.
 */
export default function DeliveryScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const { profile, me } = useAuth();
  // Tournée, stock du camion et motifs gardés sur le téléphone (phase 23)
  const { local, online, ready } = useSync();
  const { data: route } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  const truck = useMemo(() => (local ? truckStockView(local) : []), [local]);
  const reasons = useMemo(
    () => (local?.reasons ?? []).filter((x) => x.kind === 'DELIVERY_FAILURE' && x.isActive),
    [local],
  );
  /** Motifs de refus (BR-RET-01) : obligatoires dès qu'une quantité est refusée. */
  const refusals = useMemo(
    () => (local?.reasons ?? []).filter((x) => x.kind === 'REFUSAL' && x.isActive),
    [local],
  );
  const [refusalId, setRefusalId] = useState<string | null>(null);
  const [refusedFailure, setRefusedFailure] = useState<Reason | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Added[]>([]);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<{ key: string; value: DeliveryPreviewDto } | null>(null);
  const [cash, setCash] = useState('');
  const [failing, setFailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quantités proposées : le préparé, une fois la livraison connue
  const known = route?.deliveries.find((x) => x.orderId === orderId);
  useEffect(() => {
    if (!known) return;
    setQty((current) =>
      Object.keys(current).length > 0
        ? current
        : Object.fromEntries(
            known.lines
              .filter((l) => l.kind === 'NORMAL')
              .map((l) => [l.lineId, String(l.preparedQty)]),
          ),
    );
  }, [known]);

  const delivery: DriverDeliveryDto | undefined = route?.deliveries.find(
    (d) => d.orderId === orderId,
  );
  const body = useMemo(() => {
    if (!delivery) return null;
    const lines = delivery.lines
      .filter((l) => l.kind === 'NORMAL')
      .map((l) => ({ lineId: l.lineId, value: (qty[l.lineId] ?? '').trim() }));
    const extra = added.map((a) => ({ ...a, value: a.qty.trim() }));
    if ([...lines, ...extra].some((l) => !/^\d+$/.test(l.value))) return null;
    return {
      orderId: delivery.orderId,
      lines: lines.map((l) => ({ lineId: l.lineId, qty: Number(l.value) })),
      added: extra
        .filter((a) => Number(a.value) > 0)
        .map((a) => ({ variantId: a.variantId, unitId: a.unitId, qty: Number(a.value) })),
    };
  }, [delivery, qty, added]);
  const bodyKey = JSON.stringify(body);
  // Livré sous le préparé : le client refuse une partie de la commande
  const refused =
    !!body &&
    !!delivery &&
    body.lines.some(
      (l) => l.qty < (delivery.lines.find((x) => x.lineId === l.lineId)?.preparedQty ?? 0),
    );
  const upToDate = preview?.key === bodyKey;

  // Calculé sur le téléphone comme sur le serveur (P-04, plafond de crédit) ; le serveur recalcule
  function calculate() {
    if (!body) return setError('Saisissez des quantités entières.');
    if (!local) return;
    setError(null);
    try {
      const value = deliveryPreviewView(local, body);
      setPreview({ key: bodyKey, value });
      setCash(String(value.dueAmount));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirm() {
    if (!body || !preview || !upToDate || !route?.workday) return;
    const amount = Number(cash);
    if (!/^\d+$/.test(cash.trim())) return setError('Saisissez le montant encaissé.');
    if (amount < preview.value.minimumCash)
      return setError(`Encaissez au moins ${formatDA(preview.value.minimumCash)}.`);
    if (amount > preview.value.dueAmount) return setError('Le montant dépasse le dû.');
    if (refused && !refusalId) return setError('Choisissez le motif du refus.');
    setError(null);
    setBusy(true);
    try {
      const position = await readPosition();
      const userCode = me?.user.code ?? profile!.userCode;
      const number = await nextDeliveryNumber(userCode, profile!.series);
      await sendOperation(
        'delivery.confirm',
        {
          ...body,
          deliveryId: newId(),
          number,
          cashAmount: amount,
          ...(refused && { refusalReasonId: refusalId }),
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
        },
        route.workday.id,
      );
      Alert.alert(
        'Livraison enregistrée',
        `Encaissé : ${formatDA(amount)}${online ? '' : '\nEnregistrée sur le téléphone : elle partira au retour du réseau.'}`,
      );
      printAfter(number);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function fail(reason: Reason, refusalReasonId?: string) {
    if (!delivery || !route?.workday) return;
    setError(null);
    setBusy(true);
    try {
      const position = await readPosition();
      const userCode = me?.user.code ?? profile!.userCode;
      await sendOperation(
        'delivery.fail',
        {
          deliveryId: newId(),
          number: await nextDeliveryNumber(userCode, profile!.series),
          orderId: delivery.orderId,
          reasonId: reason.id,
          ...(refusalReasonId && { refusalReasonId }),
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
        },
        route.workday.id,
      );
      // Reprogrammation au jour ouvré suivant décidée par le serveur (P-05)
      Alert.alert(
        'Échec enregistré',
        'La commande est en échec ; elle sera reprogrammée si l’entreprise le prévoit.',
      );
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !route) return <ActivityIndicator style={styles.loader} color={colors.primary} />;
  if (!delivery)
    return (
      <Screen>
        <Message>{error ?? 'Livraison introuvable.'}</Message>
      </Screen>
    );

  const open = delivery.status === 'OUT_FOR_DELIVERY';
  const working = route?.workday?.status === 'IN_PROGRESS';

  return (
    <Screen>
      <Title subtitle={`${delivery.number} · ${delivery.customer.address ?? ''}`}>
        {delivery.customer.name}
      </Title>
      {delivery.customer.debtAmount > 0 ? (
        <Text style={styles.debt}>Dette du client : {formatDA(delivery.customer.debtAmount)}</Text>
      ) : null}
      {!open ? (
        <Message tone="info">
          {delivery.delivery?.result === 'FAILED'
            ? 'Livraison en échec.'
            : `Livrée : ${formatDA(delivery.totalAmount)}.`}
        </Message>
      ) : null}
      {open && !working ? <Message tone="info">Démarrez la journée pour livrer.</Message> : null}

      <Card title="Quantités livrées">
        {open && working ? (
          <Text style={styles.muted}>Mettez 0 pour retirer un produit de la commande.</Text>
        ) : null}
        {delivery.lines.map((l) => (
          <View key={l.lineId} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {label(l)}
                {l.kind === 'BONUS' ? ' (offert)' : ''}
              </Text>
              <Text style={styles.muted}>
                Préparé {l.preparedQty} {l.unitName}
                {l.kind === 'NORMAL' ? ` · ${formatDA(l.unitPrice)}` : ' · recalculé'}
              </Text>
            </View>
            {l.kind === 'NORMAL' && open ? (
              <TextInput
                accessibilityLabel={`Livré pour ${label(l)}`}
                keyboardType="number-pad"
                value={qty[l.lineId] ?? ''}
                onChangeText={(v) => setQty((q) => ({ ...q, [l.lineId]: v }))}
                style={styles.qty}
              />
            ) : (
              <Text style={styles.value}>{l.deliveredQty ?? (l.kind === 'BONUS' ? '' : '—')}</Text>
            )}
          </View>
        ))}
      </Card>

      {open && working ? (
        <Card title="Produits ajoutés depuis le camion">
          {added.map((a, i) => {
            const article = truck.find((t) => t.variantId === a.variantId)!;
            return (
              <View key={a.variantId} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{label(article)}</Text>
                  <View style={styles.chips}>
                    {article.units.map((u) => (
                      <Pressable
                        key={u.id}
                        onPress={() =>
                          setAdded((x) => x.map((y, j) => (j === i ? { ...y, unitId: u.id } : y)))
                        }
                        style={[styles.chip, a.unitId === u.id && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, a.unitId === u.id && styles.chipTextActive]}>
                          {u.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <TextInput
                  accessibilityLabel={`Quantité ajoutée de ${label(article)}`}
                  keyboardType="number-pad"
                  value={a.qty}
                  onChangeText={(v) =>
                    setAdded((x) => x.map((y, j) => (j === i ? { ...y, qty: v } : y)))
                  }
                  style={styles.qty}
                />
              </View>
            );
          })}
          {adding ? (
            <View style={styles.chips}>
              {truck
                .filter((t) => !added.some((a) => a.variantId === t.variantId))
                .map((t) => (
                  <Pressable
                    key={t.variantId}
                    onPress={() => {
                      const sameLine = delivery.lines.find(
                        (l) => l.kind === 'NORMAL' && l.variantId === t.variantId,
                      );
                      const base = t.units.find((u) => u.isBase) ?? t.units[0]!;
                      setAdded((x) => [
                        ...x,
                        { variantId: t.variantId, unitId: sameLine?.unitId ?? base.id, qty: '1' },
                      ]);
                      setAdding(false);
                    }}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>
                      {label(t)} · {t.qty}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ) : (
            <PrimaryButton
              title="Ajouter un produit du camion"
              variant="secondary"
              disabled={truck.length === 0}
              onPress={() => setAdding(true)}
            />
          )}
        </Card>
      ) : null}

      {open && working ? (
        <PrimaryButton
          title="Calculer le montant"
          variant="secondary"
          busy={busy}
          onPress={() => void calculate()}
        />
      ) : null}

      {open && working && preview && upToDate ? (
        <Card title="À encaisser">
          {preview.value.lines.map((l, i) => (
            <View key={`${l.lineId ?? 'ajout'}-${i}`} style={styles.item}>
              <Text style={styles.line}>
                {label(l)} · {l.qty} {l.unitName}
                {l.kind === 'BONUS' ? ' offert' : ''}
              </Text>
              <Text style={styles.line}>{l.kind === 'BONUS' ? '' : formatDA(l.amount)}</Text>
            </View>
          ))}
          <Text style={styles.big}>Total : {formatDA(preview.value.dueAmount)}</Text>
          {preview.value.minimumCash < preview.value.dueAmount ? (
            <Text style={styles.muted}>
              Crédit possible : encaissez au moins {formatDA(preview.value.minimumCash)}.
            </Text>
          ) : null}
          {refused ? (
            <View style={styles.refusal}>
              <Text style={styles.name}>Motif du refus</Text>
              <View style={styles.chips}>
                {refusals.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => setRefusalId(r.id)}
                    style={[styles.chip, refusalId === r.id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, refusalId === r.id && styles.chipTextActive]}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <Input
            label="Montant encaissé (DA)"
            keyboardType="number-pad"
            value={cash}
            onChangeText={setCash}
          />
          <PrimaryButton
            title="Confirmer la livraison"
            busy={busy}
            onPress={() => void confirm()}
          />
        </Card>
      ) : null}

      {error ? <Message>{error}</Message> : null}

      {open && working ? (
        failing && refusedFailure ? (
          <Card title="Pourquoi le client refuse-t-il ?">
            <View style={styles.chips}>
              {refusals.map((r) => (
                <Pressable
                  key={r.id}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      `Refus : ${r.label} ?`,
                      'Toute la commande est refusée ; la marchandise reste dans le camion.',
                      [
                        { text: 'Annuler', style: 'cancel' },
                        {
                          text: 'Confirmer',
                          style: 'destructive',
                          onPress: () => void fail(refusedFailure, r.id),
                        },
                      ],
                    )
                  }
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              title="Retour"
              variant="secondary"
              onPress={() => setRefusedFailure(null)}
            />
          </Card>
        ) : failing ? (
          <Card title="Motif de l'échec">
            <View style={styles.chips}>
              {reasons.map((r) => (
                <Pressable
                  key={r.id}
                  disabled={busy}
                  onPress={() =>
                    r.systemCode === 'REFUSED'
                      ? setRefusedFailure(r)
                      : Alert.alert(
                          `Échec : ${r.label} ?`,
                          'La marchandise reste dans le camion.',
                          [
                            { text: 'Annuler', style: 'cancel' },
                            {
                              text: 'Confirmer',
                              style: 'destructive',
                              onPress: () => void fail(r),
                            },
                          ],
                        )
                  }
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton title="Annuler" variant="secondary" onPress={() => setFailing(false)} />
          </Card>
        ) : (
          <PrimaryButton
            title="Échec de livraison"
            variant="secondary"
            onPress={() => setFailing(true)}
          />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  refusal: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowText: { flex: 1, gap: 4 },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  line: { fontSize: 15, color: colors.textDark },
  value: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  big: { fontSize: 18, fontWeight: '700', color: colors.textDark },
  debt: { fontSize: 15, fontWeight: '600', color: colors.status.toVisit },
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
