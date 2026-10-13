import { colors } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MapSheet } from '@/components/MapSheet';
import { type Stop, RESULT_LABELS, useStops } from '@/driver/stops';
import { useCurrentPosition } from '@/location/useLocation';
import { customerActions } from '@/seller/customerActions';
import { CustomerMap, MapPinLegend, placed } from '@/seller/CustomerMap';
import { formatDA, formatDistance } from '@/seller/format';
import { Message } from '@/ui';

/**
 * Carte de la tournée (refonte mobile) : le livreur ne visite pas, la couleur suit la livraison
 * (rouge à livrer, verte faite) et la légende le dit.
 */
export default function DriverMapScreen() {
  const router = useRouter();
  const { position } = useCurrentPosition();
  const { stops, error } = useStops(position);
  const [selected, setSelected] = useState<Stop | null>(null);
  const points = useMemo(
    () =>
      stops.map((s) => ({
        id: s.orderId,
        latitude: s.customer.latitude,
        longitude: s.customer.longitude,
        done: s.done,
      })),
    [stops],
  );
  const missing = points.length - placed(points).length;

  return (
    <View style={styles.screen}>
      {error ? (
        <View style={styles.header}>
          <Message>{error}</Message>
        </View>
      ) : null}
      <View style={styles.mapArea}>
        <CustomerMap
          points={points}
          position={position}
          onSelect={(p) => setSelected(stops.find((s) => s.orderId === p.id) ?? null)}
        />
        <View style={styles.overlay} pointerEvents="box-none">
          <MapPinLegend todo="À livrer" done="Livraison faite" />
          {missing > 0 ? (
            <Text style={styles.missing}>
              {missing} client{missing > 1 ? 's' : ''} sans position
            </Text>
          ) : null}
        </View>
        {selected ? (
          <MapSheet
            title={selected.customer.name}
            lines={[
              selected.customer.address,
              [
                selected.number,
                formatDA(selected.totalAmount),
                selected.delivery ? RESULT_LABELS[selected.delivery.result] : 'À livrer',
                selected.distanceM !== null ? `à ${formatDistance(selected.distanceM)}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ]}
            actions={customerActions(selected.customer, {
              label: selected.done ? 'Voir' : 'Livrer',
              onPress: () => router.push(`/driver/delivery/${selected.orderId}`),
            })}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  mapArea: { flex: 1 },
  overlay: { position: 'absolute', top: 12, left: 12, right: 12, gap: 8, alignItems: 'flex-start' },
  missing: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDark,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
});
