import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { newId } from '@/sync/operations';
import { phoneDate, useToday } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Title } from '@/ui';

/** Tableau de bord du vendeur (UC-02) : journée, clients du jour, encaissé, accès aux écrans. */
export default function SellerDashboard() {
  const router = useRouter();
  const { me, profile } = useAuth();
  const { today, loading, error, refresh, act } = useToday();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startDay() {
    setActionError(null);
    setBusy(true);
    try {
      await act('workday.start', { workdayId: newId(), date: phoneDate() });
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Title
        subtitle={[
          me?.user.code ?? profile?.userCode,
          day?.territory ? `Secteur ${day.territory.code}` : null,
          day?.part?.name,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        Bonjour {me?.user.firstName ?? profile?.firstName}
      </Title>
      {error ? <Text style={styles.offline}>{error}</Text> : null}

      {today?.openWorkday ? (
        <Card title={`Journée du ${formatDate(today.openWorkday.date)} non clôturée`}>
          <Message tone="info">Clôturez-la avant de démarrer celle d'aujourd'hui.</Message>
          <PrimaryButton
            title={`Clôturer la journée du ${formatDate(today.openWorkday.date)}`}
            onPress={() => router.push('/seller/close')}
          />
        </Card>
      ) : null}

      <Card title="Journée">
        {status === 'NOT_STARTED' ? (
          <>
            <Text style={styles.muted}>Journée non démarrée</Text>
            {canStart ? (
              <PrimaryButton
                title="Démarrer la journée"
                onPress={() => void startDay()}
                busy={busy}
              />
            ) : day && !today?.openWorkday ? (
              <Message tone="info">
                L'entreprise n'autorise pas le travail les jours non travaillés.
              </Message>
            ) : null}
          </>
        ) : status === 'IN_PROGRESS' ? (
          <>
            <Text style={styles.ok}>Journée en cours</Text>
            <PrimaryButton
              title="Clôturer la journée"
              variant="secondary"
              onPress={() => router.push('/seller/close')}
            />
          </>
        ) : (
          <Text style={styles.muted}>Journée clôturée : consultation seulement.</Text>
        )}
        {actionError ? <Message>{actionError}</Message> : null}
      </Card>

      {today?.currentVisit ? (
        <Card title="Visite en cours">
          <PrimaryButton
            title="Reprendre la visite"
            onPress={() => router.push(`/seller/visit/${today.currentVisit!.customerId}`)}
          />
        </Card>
      ) : null}

      <Card title="Aujourd'hui">
        {day?.status === 'HOLIDAY' ? (
          <Text style={styles.muted}>Jour férié{day.holiday ? ` : ${day.holiday}` : ''}</Text>
        ) : day?.status === 'NON_WORKING' ? (
          <Text style={styles.muted}>Jour non travaillé</Text>
        ) : null}
        {!day?.territory ? (
          <Text style={styles.muted}>Aucun secteur : contactez votre superviseur.</Text>
        ) : null}
        <Text style={styles.big}>
          Clients du jour : {today?.counters.visited ?? 0} / {today?.counters.planned ?? 0}
          {today?.counters.outOfProgram ? `  (+${today.counters.outOfProgram} hors programme)` : ''}
        </Text>
        <Text style={styles.value}>
          Encaissé du jour : {formatDA(today?.counters.collectedAmount ?? 0)}
        </Text>
        <PrimaryButton title="Clients du jour" onPress={() => router.push('/seller/customers')} />
      </Card>

      <Card title="Commandes du jour">
        <Text style={styles.big}>
          {today?.counters.ordersCount ?? 0} commande
          {(today?.counters.ordersCount ?? 0) > 1 ? 's' : ''} ·{' '}
          {formatDA(today?.counters.ordersAmount ?? 0)}
        </Text>
        <PrimaryButton
          title="Voir les commandes"
          variant="secondary"
          onPress={() => router.push('/seller/orders')}
        />
      </Card>

      <PrimaryButton
        title="Objectifs"
        variant="secondary"
        onPress={() => router.push('/seller/objectives')}
      />
      <PrimaryButton
        title="Catalogue"
        variant="secondary"
        onPress={() => router.push('/seller/catalog')}
      />
      <PrimaryButton
        title="Profil"
        variant="secondary"
        onPress={() => router.push('/seller/profile')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  container: { flexGrow: 1, padding: 16, gap: 16, backgroundColor: colors.background },
  offline: {
    backgroundColor: colors.status.pending,
    color: colors.textDark,
    padding: 12,
    borderRadius: radius.md,
    textAlign: 'center',
    fontWeight: '600',
  },
  muted: { fontSize: 15, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.status.synced },
  big: { fontSize: 18, fontWeight: '700', color: colors.textDark },
  value: { fontSize: 15, color: colors.textDark },
});
