import { colors } from '@sellwasl/config';
import type { DriverRouteDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { request } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { newId, sendOperation } from '@/sync/operations';
import { phoneDate } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Title } from '@/ui';

/** Tableau de bord du livreur : journée, chargement à recevoir, avancement de la tournée. */
export default function DriverDashboard() {
  const router = useRouter();
  const { me, profile } = useAuth();
  const [route, setRoute] = useState<DriverRouteDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRoute(await request<DriverRouteDto>('/me/route'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function act(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!route && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  const status = route?.workday?.status ?? 'NOT_STARTED';
  const progress = route?.progress;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Title
        subtitle={[me?.user.code ?? profile?.userCode, route ? formatDate(route.date) : null]
          .filter(Boolean)
          .join(' · ')}
      >
        Bonjour {me?.user.firstName ?? profile?.firstName}
      </Title>
      {error ? <Message>{error}</Message> : null}

      <Card title="Journée">
        {status === 'NOT_STARTED' ? (
          <>
            <Text style={styles.muted}>Journée non démarrée</Text>
            <PrimaryButton
              title="Démarrer la journée"
              busy={busy}
              onPress={() =>
                void act(() =>
                  sendOperation('workday.start', { workdayId: newId(), date: phoneDate() }),
                )
              }
            />
          </>
        ) : status === 'IN_PROGRESS' ? (
          <>
            <Text style={styles.ok}>Journée en cours</Text>
            <PrimaryButton
              title="Clôturer la journée"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  'Clôturer la journée ?',
                  'Les livraisons non faites passeront en échec « non livrée ».',
                  [
                    { text: 'Annuler', style: 'cancel' },
                    {
                      text: 'Clôturer',
                      style: 'destructive',
                      onPress: () =>
                        void act(() =>
                          sendOperation(
                            'workday.close',
                            { workdayId: route!.workday!.id },
                            route!.workday!.id,
                          ),
                        ),
                    },
                  ],
                )
              }
            />
          </>
        ) : (
          <Text style={styles.muted}>Journée clôturée : passez au déchargement au dépôt.</Text>
        )}
      </Card>

      {route?.loadToReceive ? (
        <Card title={`Chargement à recevoir · ${route.loadToReceive.truckCode}`}>
          <Text style={styles.muted}>{route.loadToReceive.lines.length} article(s)</Text>
          <PrimaryButton
            title="Vérifier et recevoir"
            disabled={status !== 'IN_PROGRESS'}
            onPress={() => router.push('/driver/receive')}
          />
          {status !== 'IN_PROGRESS' ? (
            <Message tone="info">Démarrez la journée pour recevoir le chargement.</Message>
          ) : null}
        </Card>
      ) : null}

      <Card title="Tournée">
        {route?.route ? (
          <>
            <Text style={styles.big}>
              {(progress?.delivered ?? 0) + (progress?.partial ?? 0)} livrée(s) ·{' '}
              {progress?.failed ?? 0} échec(s) · {progress?.pending ?? 0} à livrer
            </Text>
            <Text style={styles.value}>Encaissé : {formatDA(progress?.collected ?? 0)}</Text>
            <PrimaryButton title="Ma tournée" onPress={() => router.push('/driver/route')} />
            <PrimaryButton
              title="Stock du camion"
              variant="secondary"
              onPress={() => router.push('/driver/truck')}
            />
          </>
        ) : (
          <Text style={styles.muted}>Aucune tournée aujourd'hui.</Text>
        )}
      </Card>

      <PrimaryButton
        title="Objectifs"
        variant="secondary"
        onPress={() => router.push('/driver/objectives')}
      />
      <PrimaryButton
        title="Profil"
        variant="secondary"
        onPress={() => router.push('/driver/profile')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  container: { padding: 16, gap: 16, backgroundColor: colors.background },
  big: { fontSize: 18, fontWeight: '700', color: colors.textDark },
  value: { fontSize: 16, color: colors.textDark },
  muted: { fontSize: 15, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.status.synced },
});
