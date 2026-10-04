import { colors } from '@sellwasl/config';
import type { OrderDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDA, ORDER_STATUS_LABELS } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Message } from '@/ui';

/** Commandes du jour du vendeur (UC-17) : montant, statut, accès au détail. */
export default function OrdersScreen() {
  const router = useRouter();
  const { today } = useToday();
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargées au retour d'une modification ou d'une annulation
  useFocusEffect(
    useCallback(() => {
      if (!today) return;
      void request<OrderDto[]>(`/me/orders?date=${today.date}`)
        .then((list) => {
          setOrders(list);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, [today]),
  );

  return (
    <FlatList
      data={orders ?? []}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? <Message>{error}</Message> : null}
          {!orders && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      ListEmptyComponent={
        orders ? <Message tone="info">Aucune commande aujourd'hui.</Message> : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/seller/orders/${item.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowText}>
            <Text style={styles.name}>{item.customer.name}</Text>
            <Text style={styles.muted}>
              {item.number} · {ORDER_STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
          <Text style={item.status === 'CANCELLED' ? styles.cancelled : styles.amount}>
            {formatDA(item.totalAmount)}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 16, backgroundColor: colors.background },
  header: { gap: 8 },
  separator: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  amount: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  cancelled: { fontSize: 16, color: colors.muted, textDecorationLine: 'line-through' },
});
