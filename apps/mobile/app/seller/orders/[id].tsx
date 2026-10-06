import { colors } from '@sellwasl/config';
import type { OrderLineDto } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { useLocal } from '@/offline/SyncProvider';
import { errorMessage, formatDA, formatDate, ORDER_STATUS_LABELS } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

function lineLabel(l: OrderLineDto): string {
  const name = l.variantName ? `${l.productName} ${l.variantName}` : l.productName;
  return `${name} : ${l.enteredQty} ${l.unitName}`;
}

/** Détail d'une commande du jour (UC-17) : modifier ou annuler tant qu'elle est confirmée. */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { today, inProgress, act } = useToday();
  const { data: order, ready } = useLocal((s) => s.orders.get(id) ?? null, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!order)
    return (
      <Screen>
        {ready ? (
          <Message>Commande absente de ce téléphone.</Message>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Screen>
    );

  // Le superviseur a traité une ligne en attente : la commande ne peut plus être refaite
  const decided = order.lines.some((l) => l.kind === 'PENDING' && l.pendingStatus !== 'TO_PROCESS');
  const editable = order.status === 'CONFIRMED' && inProgress;
  const normal = order.lines.filter((l) => l.kind === 'NORMAL');
  const pending = order.lines.filter((l) => l.kind === 'PENDING');
  const free = order.lines.filter((l) => l.kind === 'BONUS');

  function cancel() {
    setError(null);
    Alert.alert('Annuler la commande ?', `${order!.number} · ${order!.customer.name}`, [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Annuler la commande',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              await act('order.cancel', { orderId: order!.id });
              router.back();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  }

  return (
    <Screen>
      <Title
        subtitle={`${order.number} · ${ORDER_STATUS_LABELS[order.status] ?? order.status}${
          order.deliveryDate ? ` · livraison le ${formatDate(order.deliveryDate)}` : ''
        }`}
      >
        {order.customer.name}
      </Title>
      <Card title="Articles">
        {normal.map((l) => (
          <Text key={l.id} style={styles.line}>
            {lineLabel(l)} × {formatDA(l.unitPrice)} = {formatDA(l.lineAmount)}
            {l.isStockout ? ' · rupture' : ''}
          </Text>
        ))}
      </Card>
      {pending.length ? (
        <Card title="En attente (quota)">
          {pending.map((l) => (
            <Text key={l.id} style={styles.line}>
              {lineLabel(l)}
              {l.pendingStatus === 'ACCEPTED'
                ? ' · acceptée'
                : l.pendingStatus === 'REFUSED'
                  ? ' · refusée'
                  : ' · à valider par le superviseur'}
            </Text>
          ))}
        </Card>
      ) : null}
      {free.length ? (
        <Card title="Gratuit">
          {free.map((l) => (
            <Text key={l.id} style={styles.line}>
              {lineLabel(l)}
              {l.isStockout ? ' · rupture' : ''}
            </Text>
          ))}
        </Card>
      ) : null}
      <Text style={styles.total}>Total : {formatDA(order.totalAmount)}</Text>
      {error ? <Message>{error}</Message> : null}
      {editable ? (
        <>
          {decided ? (
            <Message tone="info">
              Une ligne en attente a été traitée par le superviseur : la commande ne peut plus être
              modifiée.
            </Message>
          ) : (
            <PrimaryButton
              title="Modifier"
              onPress={() =>
                router.push(
                  `/seller/order/${order.visitId ?? ''}?customerId=${order.customer.id}&orderId=${order.id}&date=${order.orderDate}`,
                )
              }
            />
          )}
          <PrimaryButton
            title="Annuler la commande"
            variant="secondary"
            onPress={cancel}
            busy={busy}
          />
        </>
      ) : order.status !== 'CANCELLED' ? (
        <Message tone="info">
          {order.status !== 'CONFIRMED'
            ? 'Commande figée : seul le superviseur peut rouvrir la journée.'
            : today?.workday?.status === 'CLOSED'
              ? 'Journée clôturée : consultation seulement.'
              : 'Démarrez votre journée pour modifier ou annuler cette commande.'}
        </Message>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 15, color: colors.textDark },
  total: { fontSize: 20, fontWeight: '700', color: colors.primary },
});
