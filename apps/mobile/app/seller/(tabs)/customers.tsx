import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionSheet } from '@/components/ActionSheet';
import { Chips, SearchField, Segmented } from '@/components/Filters';
import { SwipeRow } from '@/components/SwipeRow';
import { useCurrentPosition } from '@/location/useLocation';
import { customerActions } from '@/seller/customerActions';
import {
  type CustomerScope,
  type CustomerStatusFilter,
  type FieldCustomer,
  filterCustomers,
  useCustomerLists,
} from '@/seller/customers';
import { formatDA, formatDistance } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Message, PrimaryButton } from '@/ui';

const STATUS_OPTIONS: { value: CustomerStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'toVisit', label: 'À visiter' },
  { value: 'visited', label: 'Visités' },
  { value: 'outOfProgram', label: 'Hors programme' },
];

/** Carte d'un client (maquette « Liste des clients ») : nom, type, adresse, état, dette, distance. */
function CustomerCard({
  customer,
  onPress,
  onMore,
}: {
  customer: FieldCustomer;
  onPress: () => void;
  onMore: () => void;
}) {
  const state = customer.visited ? 'Visité' : customer.inDay ? 'À visiter' : 'Hors programme';
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${customer.name}, ${state}`}
        onPress={onPress}
        style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.cardTop}>
          <Text style={styles.name} numberOfLines={1}>
            {customer.name}
          </Text>
          {customer.typeName ? (
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{customer.typeName}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.inline}>
          <View
            style={[
              styles.dot,
              { backgroundColor: customer.visited ? colors.status.visited : colors.status.toVisit },
            ]}
          />
          <Text style={styles.state}>{state}</Text>
          {customer.code ? <Text style={styles.muted}>· {customer.code}</Text> : null}
          {customer.distanceM !== null ? (
            <Text style={styles.distance}>· {formatDistance(Math.round(customer.distanceM))}</Text>
          ) : null}
        </View>
        {customer.address ? (
          <View style={styles.inline}>
            <Feather name="map-pin" size={14} color={colors.muted} />
            <Text style={styles.muted} numberOfLines={1}>
              {customer.address}
            </Text>
          </View>
        ) : null}
        {customer.debtAmount > 0 ? (
          <Text style={styles.debt}>Dette : {formatDA(customer.debtAmount)}</Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions pour ${customer.name}`}
        onPress={onMore}
        style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.surface }]}
      >
        <Feather name="more-vertical" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

/**
 * Visites (UC-10, refonte mobile) : clients du jour ou du secteur, filtres d'état et recherche
 * combinés ; glisser un client dévoile Visiter, Localiser, Appeler (aussi par « ⋯ »).
 */
export default function CustomersScreen() {
  const router = useRouter();
  const { position, status } = useCurrentPosition();
  const { inProgress, today } = useToday();
  const [scope, setScope] = useState<CustomerScope>('day');
  const [filter, setFilter] = useState<CustomerStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<FieldCustomer | null>(null);
  const lists = useCustomerLists(position);
  const shown = useMemo(
    () => filterCustomers(scope === 'day' ? lists.day : lists.sector, query, filter),
    [lists.day, lists.sector, scope, query, filter],
  );

  const visitBlocked = inProgress
    ? undefined
    : today?.workday?.status === 'CLOSED'
      ? 'Journée clôturée'
      : 'Démarrez votre journée';
  const actionsFor = (c: FieldCustomer) =>
    customerActions(c, {
      label: 'Visiter',
      onPress: () => router.push(`/seller/visit/${c.id}`),
      disabledReason: visitBlocked,
    });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'day', label: `Clients du jour (${lists.day.length})` },
            { value: 'sector', label: `Tout le secteur (${lists.sector.length})` },
          ]}
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Rechercher : nom, code, adresse, téléphone"
        />
        <Chips value={filter} onChange={setFilter} options={STATUS_OPTIONS} />
        {status === 'denied' ? (
          <Message tone="info">Position refusée : clients triés par nom.</Message>
        ) : null}
        {lists.error ? <Message>{lists.error}</Message> : null}
        {lists.loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.count}>
            {shown.length} client{shown.length > 1 ? 's' : ''}
          </Text>
        }
        ListEmptyComponent={
          lists.loading ? null : (
            <Message tone="info">
              {query || filter !== 'all'
                ? 'Aucun client ne correspond.'
                : 'Aucun client à afficher.'}
            </Message>
          )
        }
        ListFooterComponent={
          inProgress ? (
            <PrimaryButton
              title="Ajouter un client"
              variant="secondary"
              onPress={() => router.push('/seller/customer-new')}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <SwipeRow actions={actionsFor(item)}>
            <CustomerCard
              customer={item}
              onPress={() => router.push(`/seller/customer/${item.id}`)}
              onMore={() => setMenuFor(item)}
            />
          </SwipeRow>
        )}
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.name}
        actions={menuFor ? actionsFor(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  list: { padding: 16, gap: 12 },
  count: { fontSize: 14, color: colors.muted },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  cardMain: { flex: 1, padding: 16, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.textDark },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  typeText: { fontSize: 12, fontWeight: '700', color: colors.background },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  state: { fontSize: 14, fontWeight: '600', color: colors.textDark },
  muted: { flexShrink: 1, fontSize: 14, color: colors.muted },
  distance: { fontSize: 14, fontWeight: '600', color: colors.deepBlue },
  debt: { fontSize: 14, fontWeight: '600', color: colors.status.error },
  more: { width: 48, alignItems: 'center', justifyContent: 'center' },
});
