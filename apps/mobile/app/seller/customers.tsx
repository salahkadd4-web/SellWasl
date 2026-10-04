import { colors } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCurrentPosition } from '@/location/useLocation';
import { CustomerMap } from '@/seller/CustomerMap';
import {
  type CustomerScope,
  type FieldCustomer,
  openDirections,
  useFieldCustomers,
} from '@/seller/customers';
import { formatDA, formatDistance } from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { Card, Message, PrimaryButton } from '@/ui';

/** Pastille d'état d'un client : verte visité, rouge à visiter (BR-VIS-06). */
const DOT_SIZE = 14;

/** Deux boutons côte à côte, l'actif en plein (bascules jour / secteur et liste / carte). */
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

function CustomerRow({ customer, onPress }: { customer: FieldCustomer; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: customer.visited ? colors.status.visited : colors.status.toVisit },
        ]}
      />
      <View style={styles.rowText}>
        <Text style={styles.name}>{customer.name}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {[customer.code, customer.address, customer.inDay ? null : 'hors programme']
            .filter(Boolean)
            .join(' · ') || ' '}
        </Text>
        {customer.debtAmount > 0 ? (
          <Text style={styles.debt}>Dette : {formatDA(customer.debtAmount)}</Text>
        ) : null}
      </View>
      <Text style={styles.distance}>
        {customer.distanceM !== null ? formatDistance(customer.distanceM) : ''}
      </Text>
    </Pressable>
  );
}

/** Clients du jour ou du secteur (UC-10) : liste triée par distance, ou carte. */
export default function CustomersScreen() {
  const router = useRouter();
  const { position, status } = useCurrentPosition();
  const [scope, setScope] = useState<CustomerScope>('day');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<FieldCustomer | null>(null);
  const { customers, loading, error } = useFieldCustomers(scope, position);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Toggle
          value={scope}
          onChange={setScope}
          options={[
            { value: 'day', label: 'Clients du jour' },
            { value: 'sector', label: 'Tout le secteur' },
          ]}
        />
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
          <Message tone="info">Position refusée : clients triés par nom.</Message>
        ) : null}
        {error ? <Message>{error}</Message> : null}
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

      {view === 'list' ? (
        <FlatList
          data={customers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            loading ? null : <Message tone="info">Aucun client à afficher.</Message>
          }
          ListFooterComponent={
            <WorkdayGuard>
              <PrimaryButton
                title="Ajouter un client"
                variant="secondary"
                onPress={() => router.push('/seller/customer-new')}
              />
            </WorkdayGuard>
          }
          renderItem={({ item }) => (
            <CustomerRow
              customer={item}
              onPress={() => router.push(`/seller/customer/${item.id}`)}
            />
          )}
        />
      ) : (
        <View style={styles.mapArea}>
          <CustomerMap customers={customers} position={position} onSelect={setSelected} />
          {selected ? (
            <View style={styles.sheet}>
              <Card title={selected.name}>
                {selected.distanceM !== null ? (
                  <Text style={styles.muted}>À {formatDistance(selected.distanceM)}</Text>
                ) : null}
                <PrimaryButton
                  title="Itinéraire"
                  variant="secondary"
                  onPress={() => void openDirections(selected.latitude!, selected.longitude!)}
                />
                <PrimaryButton
                  title="Fiche du client"
                  variant="secondary"
                  onPress={() => router.push(`/seller/customer/${selected.id}`)}
                />
                <WorkdayGuard>
                  <PrimaryButton
                    title="Commencer la visite"
                    onPress={() => router.push(`/seller/visit/${selected.id}`)}
                  />
                </WorkdayGuard>
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
