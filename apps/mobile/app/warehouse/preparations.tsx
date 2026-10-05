import { colors } from '@sellwasl/config';
import type { RouteSummaryDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDate } from '@/seller/format';
import { Message } from '@/ui';

/** Tournées lancées par le superviseur, à préparer (UC-41). */
export default function PreparationsScreen() {
  const router = useRouter();
  const [routes, setRoutes] = useState<RouteSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargées au retour d'une préparation validée
  useFocusEffect(
    useCallback(() => {
      void request<RouteSummaryDto[]>('/routes/preparing')
        .then((list) => {
          setRoutes(list.filter((r) => r.status === 'PREPARING'));
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, []),
  );

  return (
    <FlatList
      data={routes ?? []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? <Message>{error}</Message> : null}
          {!routes && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      ListEmptyComponent={routes ? <Message tone="info">Aucune tournée à préparer.</Message> : null}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/warehouse/preparation/${item.id}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowText}>
            <Text style={styles.name}>{item.driver.name}</Text>
            <Text style={styles.muted}>
              Livraison du {formatDate(item.deliveryDate)} · {item.truck?.code ?? 'pas de camion'}
            </Text>
          </View>
          <Text style={styles.amount}>{item.ordersCount} cmd</Text>
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
});
