import { distanceMeters } from '@sellwasl/business-rules';
import { colors } from '@sellwasl/config';
import { driverRouteView } from '@sellwasl/offline';
import type { DriverDeliveryDto } from '@sellwasl/validation';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCurrentPosition } from '@/location/useLocation';
import { phoneDate } from '@/offline/ids';
import { useLocal } from '@/offline/SyncProvider';
import { CustomerMap } from '@/seller/CustomerMap';
import { type FieldCustomer, openDirections } from '@/seller/customers';
import { errorMessage, formatDA, formatDistance } from '@/seller/format';
import { Card, Message, PrimaryButton } from '@/ui';

/** Pastille d'état d'une livraison : verte faite, rouge à faire. */
const DOT_SIZE = 14;

const RESULT_LABELS: Record<string, string> = {
  DELIVERED: 'Livrée',
  PARTIAL: 'Livrée en partie',
  FAILED: 'Échec',
};

type Stop = DriverDeliveryDto & { distanceM: number | null; done: boolean };

/** Deux boutons côte à côte, l'actif en plein (liste / carte). */
function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.toggle}>
      {options.map((o) => (
        <View key={o.value} style={styles.toggleItem}>
          <PrimaryButton
            title={o.label}
            variant={o.value === value ? 'primary' : 'secondary'}
            onPress={() => onChange(o.value)}
          />
        </View>
      ))}
    </View>
  );
}

/** Tournée du livreur (UC-31, BR-LIV-01) : livraisons triées par distance, ou carte. */
export default function RouteScreen() {
  const router = useRouter();
  const { position, status } = useCurrentPosition();
  // Tournée gardée sur le téléphone (phase 23)
  const { data: route, error } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<Stop | null>(null);

  // À faire d'abord, du plus proche au plus loin ; les livraisons faites ensuite
  const stops = useMemo<Stop[]>(
    () =>
      (route?.deliveries ?? [])
        .map((d) => ({
          ...d,
          done: d.status !== 'OUT_FOR_DELIVERY',
          distanceM:
            position && d.customer.latitude != null && d.customer.longitude != null
              ? Math.round(
                  distanceMeters(position, {
                    latitude: d.customer.latitude,
                    longitude: d.customer.longitude,
                  }),
                )
              : null,
        }))
        .sort(
          (a, b) =>
            Number(a.done) - Number(b.done) ||
            (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
            a.customer.name.localeCompare(b.customer.name),
        ),
    [route, position],
  );
  const markers = useMemo<FieldCustomer[]>(
    () =>
      stops.map((s) => ({
        id: s.orderId,
        code: s.number,
        name: s.customer.name,
        address: s.customer.address,
        phone: s.customer.phone,
        latitude: s.customer.latitude,
        longitude: s.customer.longitude,
        debtAmount: s.customer.debtAmount,
        inDay: true,
        visited: s.done,
        distanceM: s.distanceM,
      })),
    [stops],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Toggle
          value={view}
          onChange={(v) => {
            setSelected(null);
            setView(v);
          }}
          options={[
            { value: 'list', label: 'Liste' },
            { value: 'map', label: 'Carte' },
          ]}
        />
        {status === 'denied' ? (
          <Message tone="info">Position refusée : livraisons triées par nom.</Message>
        ) : null}
        {error ? <Message>{error}</Message> : null}
      </View>

      {!route && !error ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

      {view === 'list' ? (
        <FlatList
          data={stops}
          keyExtractor={(s) => s.orderId}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            route ? <Message tone="info">Aucune livraison dans la tournée.</Message> : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/driver/delivery/${item.orderId}`)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: item.done ? colors.status.visited : colors.status.toVisit },
                ]}
              />
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.customer.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.number} · {formatDA(item.totalAmount)}
                  {item.delivery ? ` · ${RESULT_LABELS[item.delivery.result]}` : ''}
                </Text>
                {item.customer.debtAmount > 0 ? (
                  <Text style={styles.debt}>Dette : {formatDA(item.customer.debtAmount)}</Text>
                ) : null}
              </View>
              <Text style={styles.distance}>
                {item.distanceM !== null ? formatDistance(item.distanceM) : ''}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.mapArea}>
          <CustomerMap
            customers={markers}
            position={position}
            onSelect={(m) => setSelected(stops.find((s) => s.orderId === m.id) ?? null)}
          />
          {selected ? (
            <View style={styles.sheet}>
              <Card title={selected.customer.name}>
                <Text style={styles.muted}>
                  {selected.number} · {formatDA(selected.totalAmount)}
                  {selected.distanceM !== null ? ` · à ${formatDistance(selected.distanceM)}` : ''}
                </Text>
                {selected.customer.latitude != null && selected.customer.longitude != null ? (
                  <PrimaryButton
                    title="Itinéraire"
                    variant="secondary"
                    onPress={() =>
                      void openDirections(selected.customer.latitude!, selected.customer.longitude!)
                    }
                  />
                ) : null}
                <PrimaryButton
                  title={selected.done ? 'Voir la livraison' : 'Livrer'}
                  onPress={() => router.push(`/driver/delivery/${selected.orderId}`)}
                />
              </Card>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, gap: 8 },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleItem: { flex: 1 },
  loader: { marginVertical: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  separator: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  debt: { fontSize: 14, fontWeight: '600', color: colors.status.toVisit },
  distance: { fontSize: 15, fontWeight: '600', color: colors.deepBlue },
  mapArea: { flex: 1 },
  sheet: { position: 'absolute', left: 16, right: 16, bottom: 16 },
});
