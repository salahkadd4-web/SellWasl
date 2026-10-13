import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionSheet } from '@/components/ActionSheet';
import { SwipeRow } from '@/components/SwipeRow';
import { type Stop, RESULT_LABELS, useStops } from '@/driver/stops';
import { useCurrentPosition } from '@/location/useLocation';
import { customerActions } from '@/seller/customerActions';
import { formatDA, formatDistance } from '@/seller/format';
import { Message } from '@/ui';

/**
 * Tournée du livreur (UC-31, BR-LIV-01, refonte mobile) : livraisons triées par distance ;
 * glisser une livraison dévoile Livrer, Localiser, Appeler (aussi par « ⋯ »).
 */
export default function RouteScreen() {
  const router = useRouter();
  const { position, status } = useCurrentPosition();
  const { route, stops, error } = useStops(position);
  const [menuFor, setMenuFor] = useState<Stop | null>(null);
  const actionsFor = (s: Stop) =>
    customerActions(s.customer, {
      label: s.done ? 'Voir' : 'Livrer',
      onPress: () => router.push(`/driver/delivery/${s.orderId}`),
    });

  return (
    <View style={styles.screen}>
      {status === 'denied' ? (
        <View style={styles.header}>
          <Message tone="info">Position refusée : livraisons triées par nom.</Message>
        </View>
      ) : null}
      {error ? (
        <View style={styles.header}>
          <Message>{error}</Message>
        </View>
      ) : null}
      {!route && !error ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      <FlatList
        data={stops}
        keyExtractor={(s) => s.orderId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          route ? <Message tone="info">Aucune livraison dans la tournée.</Message> : null
        }
        renderItem={({ item }) => (
          <SwipeRow actions={actionsFor(item)}>
            <View style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.customer.name}, ${item.done ? 'faite' : 'à livrer'}`}
                onPress={() => router.push(`/driver/delivery/${item.orderId}`)}
                style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.inline}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: item.done ? colors.status.visited : colors.status.toVisit,
                      },
                    ]}
                  />
                  <Text style={styles.name} numberOfLines={1}>
                    {item.customer.name}
                  </Text>
                  {item.distanceM !== null ? (
                    <Text style={styles.distance}>{formatDistance(item.distanceM)}</Text>
                  ) : null}
                </View>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.number} · {formatDA(item.totalAmount)}
                  {item.delivery ? ` · ${RESULT_LABELS[item.delivery.result]}` : ''}
                </Text>
                {item.customer.address ? (
                  <View style={styles.inline}>
                    <Feather name="map-pin" size={14} color={colors.muted} />
                    <Text style={styles.muted} numberOfLines={1}>
                      {item.customer.address}
                    </Text>
                  </View>
                ) : null}
                {item.customer.debtAmount > 0 ? (
                  <Text style={styles.debt}>Dette : {formatDA(item.customer.debtAmount)}</Text>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions pour ${item.customer.name}`}
                onPress={() => setMenuFor(item)}
                style={styles.more}
              >
                <Feather name="more-vertical" size={22} color={colors.primary} />
              </Pressable>
            </View>
          </SwipeRow>
        )}
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.customer.name}
        actions={menuFor ? actionsFor(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  loader: { marginVertical: 8 },
  list: { padding: 16, gap: 12 },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  cardMain: { flex: 1, padding: 16, gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.textDark },
  muted: { flexShrink: 1, fontSize: 14, color: colors.muted },
  debt: { fontSize: 14, fontWeight: '600', color: colors.status.error },
  distance: { fontSize: 14, fontWeight: '600', color: colors.deepBlue },
  more: { width: 48, alignItems: 'center', justifyContent: 'center' },
});
