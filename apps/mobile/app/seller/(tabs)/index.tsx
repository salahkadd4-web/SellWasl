import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { ActionButton, Greeting, SyncPanel } from '@/components/Home';
import { Panel, StatTile, TileGrid } from '@/components/Tiles';
import { useSync } from '@/offline/SyncProvider';
import { useCustomerLists } from '@/seller/customers';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { newId } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Message, PrimaryButton } from '@/ui';

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** « Samedi 05/06/2027 ». */
function dayLabel(date: string): string {
  const weekday = WEEKDAYS[new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${formatDate(date)}`;
}

/**
 * Accueil du vendeur (UC-02, refonte mobile) : indicateurs du jour, journée, synchronisation ;
 * les autres écrans sont dans les onglets, le menu et le bouton +.
 */
export default function SellerDashboard() {
  const router = useRouter();
  const { me, profile } = useAuth();
  const { today, loading, error, refresh, startDay: beginDay } = useToday();
  const { indicator } = useSync();
  const { sector } = useCustomerLists(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startDay() {
    setActionError(null);
    setBusy(true);
    try {
      await beginDay(newId());
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !today) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  const day = today?.day;
  const status = today?.workday?.status ?? 'NOT_STARTED';
  const canStart =
    status === 'NOT_STARTED' &&
    !today?.openWorkday &&
    (day?.status === 'WORKING' || today?.rules.P01_workOnNonWorkingDays === true);
  const counters = today?.counters;
  const visited = counters?.visited ?? 0;
  const planned = counters?.planned ?? 0;
  const rate = planned > 0 ? `${Math.round((visited / planned) * 100)} %` : undefined;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Greeting
        name={me?.user.firstName ?? profile?.firstName ?? ''}
        subtitle={[
          me?.user.code ?? profile?.userCode,
          day?.territory ? `Secteur ${day.territory.code}` : null,
          day?.part?.name,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      {error ? <Text style={styles.offline}>{error}</Text> : null}

      {today ? (
        <TileGrid>
          <StatTile
            icon="users"
            value={String(sector.length)}
            label="Clients du secteur"
            onPress={() => router.push('/seller/customers')}
          />
          <StatTile
            icon="map-pin"
            value={`${visited}/${planned}`}
            extra={rate}
            label="Visites réalisées"
            onPress={() => router.push('/seller/customers')}
          />
          <StatTile
            icon="layers"
            value={String(counters?.ordersCount ?? 0)}
            label="Commandes réalisées"
            onPress={() => router.push('/seller/orders')}
          />
          <StatTile
            icon="dollar-sign"
            value={formatDA(counters?.ordersAmount ?? 0)}
            label="Montant des commandes"
            onPress={() => router.push('/seller/orders')}
          />
        </TileGrid>
      ) : null}

      {indicator.unseenChanges > 0 ? (
        <Panel>
          <Text style={styles.panelTitle}>Changements à la réception</Text>
          <Message tone="info">
            Le serveur a modifié {indicator.unseenChanges} de vos actions (quota, stock).
          </Message>
          <PrimaryButton
            title="Voir les changements"
            variant="secondary"
            onPress={() => router.push('/seller/sync')}
          />
        </Panel>
      ) : null}

      {today?.openWorkday ? (
        <Panel>
          <Text style={styles.panelTitle}>
            Journée du {formatDate(today.openWorkday.date)} non clôturée
          </Text>
          <Message tone="info">Clôturez-la avant de démarrer celle d'aujourd'hui.</Message>
          <ActionButton
            title={`Clôturer la journée du ${formatDate(today.openWorkday.date)}`}
            icon="lock"
            color={colors.coral}
            onPress={() => router.push('/seller/close')}
          />
        </Panel>
      ) : null}

      {today ? (
        <Panel>
          <View style={styles.dayRow}>
            <View style={styles.dayText}>
              <View style={styles.inline}>
                <Feather name="calendar" size={18} color={colors.muted} />
                <Text style={styles.dayDate}>{dayLabel(today.date)}</Text>
              </View>
              <View style={styles.inline}>
                <Feather name="map-pin" size={18} color={colors.muted} />
                <Text style={styles.dayValue}>
                  <Text style={styles.dayCount}>
                    {visited}/{planned}
                  </Text>{' '}
                  visites réalisées
                  {counters?.outOfProgram ? ` (+${counters.outOfProgram} hors programme)` : ''}
                </Text>
              </View>
            </View>
          </View>
          {day?.status === 'HOLIDAY' ? (
            <Text style={styles.muted}>Jour férié{day.holiday ? ` : ${day.holiday}` : ''}</Text>
          ) : day?.status === 'NON_WORKING' ? (
            <Text style={styles.muted}>Jour non travaillé</Text>
          ) : null}
          {!day?.territory ? (
            <Text style={styles.muted}>Aucun secteur : contactez votre superviseur.</Text>
          ) : null}
          {status === 'NOT_STARTED' ? (
            <>
              <Text style={styles.muted}>Journée non démarrée</Text>
              {canStart ? (
                <ActionButton
                  title="Démarrer la journée"
                  icon="play"
                  color={colors.primary}
                  onPress={() => void startDay()}
                  busy={busy}
                />
              ) : day && !today.openWorkday ? (
                <Message tone="info">
                  L'entreprise n'autorise pas le travail les jours non travaillés.
                </Message>
              ) : null}
            </>
          ) : status === 'IN_PROGRESS' ? (
            <>
              <Text style={styles.ok}>Journée en cours</Text>
              <ActionButton
                title="Clôturer la journée"
                icon="lock"
                color={colors.coral}
                onPress={() => router.push('/seller/close')}
              />
            </>
          ) : (
            <Text style={styles.muted}>Journée clôturée : consultation seulement.</Text>
          )}
          {actionError ? <Message>{actionError}</Message> : null}
        </Panel>
      ) : null}

      {today?.currentVisit ? (
        <Panel>
          <Text style={styles.panelTitle}>Visite en cours</Text>
          <PrimaryButton
            title="Reprendre la visite"
            onPress={() => router.push(`/seller/visit/${today.currentVisit!.customerId}`)}
          />
        </Panel>
      ) : null}

      {(me?.role.code ?? profile?.roleCode) === 'VENDEUR_CASH_VAN' && status === 'IN_PROGRESS' ? (
        <Panel>
          <Text style={styles.panelTitle}>Camion</Text>
          <Text style={styles.muted}>
            Pointez le camion en début de journée et à chaque rechargement : rien ne se vend avant.
          </Text>
          <PrimaryButton
            title="Pointer le camion"
            variant="secondary"
            onPress={() => router.push('/seller/truck-check')}
          />
        </Panel>
      ) : null}

      <SyncPanel href="/seller/sync" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  container: { flexGrow: 1, padding: 16, gap: 16, backgroundColor: colors.surface },
  offline: {
    backgroundColor: colors.status.pending,
    color: colors.textDark,
    padding: 12,
    borderRadius: radius.md,
    textAlign: 'center',
    fontWeight: '600',
  },
  panelTitle: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayText: { flex: 1, gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayDate: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  dayValue: { fontSize: 15, color: colors.textDark },
  dayCount: { fontWeight: '700', color: colors.status.error },
  muted: { fontSize: 15, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.successText },
});
