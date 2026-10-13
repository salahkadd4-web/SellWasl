import { colors } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Segmented } from '@/components/Filters';
import { MapSheet } from '@/components/MapSheet';
import { useCurrentPosition } from '@/location/useLocation';
import { customerActions } from '@/seller/customerActions';
import { CustomerMap, MapPinLegend, placed } from '@/seller/CustomerMap';
import { type CustomerScope, type FieldCustomer, useCustomerLists } from '@/seller/customers';
import { formatDA, formatDistance } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Message } from '@/ui';

/**
 * Carte des clients (UC-10, refonte mobile) : MapPin rouge (visite non réalisée) ou vert
 * (réalisée), clients du jour ou du secteur ; un appui ouvre le panneau Visiter, Localiser,
 * Appeler.
 */
export default function SellerMapScreen() {
  const router = useRouter();
  const { position } = useCurrentPosition();
  const { inProgress, today } = useToday();
  const [scope, setScope] = useState<CustomerScope>('day');
  const [selected, setSelected] = useState<FieldCustomer | null>(null);
  const lists = useCustomerLists(position);
  const customers = scope === 'day' ? lists.day : lists.sector;
  const points = useMemo(() => customers.map((c) => ({ ...c, done: c.visited })), [customers]);
  const missing = customers.length - placed(points).length;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Segmented
          value={scope}
          onChange={(value) => {
            setSelected(null);
            setScope(value);
          }}
          options={[
            { value: 'day', label: `Clients du jour (${lists.day.length})` },
            { value: 'sector', label: `Tous les clients (${lists.sector.length})` },
          ]}
        />
        {lists.error ? <Message>{lists.error}</Message> : null}
      </View>
      <View style={styles.mapArea}>
        <CustomerMap points={points} position={position} onSelect={setSelected} />
        <View style={styles.overlay} pointerEvents="box-none">
          <MapPinLegend todo="Visite non réalisée" done="Visite réalisée" />
          {missing > 0 ? (
            <Text style={styles.missing}>
              {missing} client{missing > 1 ? 's' : ''} sans position
            </Text>
          ) : null}
        </View>
        {selected ? (
          <MapSheet
            title={selected.name}
            badge={selected.typeName}
            lines={[
              selected.address,
              [
                selected.visited ? 'Visite réalisée' : 'Visite non réalisée',
                selected.inDay ? null : 'hors programme',
                selected.distanceM !== null
                  ? `à ${formatDistance(Math.round(selected.distanceM))}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
              selected.debtAmount > 0 ? `Dette : ${formatDA(selected.debtAmount)}` : null,
            ]}
            actions={customerActions(selected, {
              label: 'Visiter',
              onPress: () => router.push(`/seller/visit/${selected.id}`),
              disabledReason: inProgress
                ? undefined
                : today?.workday?.status === 'CLOSED'
                  ? 'Journée clôturée'
                  : 'Démarrez votre journée',
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
  header: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
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
