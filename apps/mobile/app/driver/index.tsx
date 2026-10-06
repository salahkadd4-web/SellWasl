import { colors } from '@sellwasl/config';
import type { DriverRouteDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { setPositionSharing } from '@/device/heartbeat';
import { SyncBar } from '@/offline/SyncBar';
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

  // Position partagée pendant la journée seulement (BR-JOU-09)
  const inProgress = route?.workday?.status === 'IN_PROGRESS';
  useEffect(() => {
    setPositionSharing(inProgress);
    return () => setPositionSharing(false);
  }, [inProgress]);

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
      <SyncBar href="/driver/sync" />
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
            <Text style={styles.muted}>
              De retour au dépôt : clôturez la journée, c'est votre déclaration de retour. Le
              magasinier contrôle ensuite le camion.
            </Text>
            <PrimaryButton
              title="Je suis de retour : clôturer la journée"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  'Clôturer la journée ?',
                  'Retour au dépôt déclaré. Les livraisons non faites passeront en échec « non livrée » ; la marchandise du camion sera comptée par le magasinier.',
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

      <Card title={route?.loadToReceive ? `Camion · chargement à pointer` : 'Camion'}>
        <Text style={route?.loadToReceive ? styles.alert : styles.muted}>
          {route?.loadToReceive
            ? `${route.loadToReceive.truckCode} : un chargement attend votre pointage.`
            : 'Pointez le camion en début de journée.'}
        </Text>
        <PrimaryButton
          title="Pointer le camion"
          disabled={status !== 'IN_PROGRESS'}
          onPress={() => router.push('/driver/receive')}
        />
        <PrimaryButton
          title="Stock du camion"
          variant="secondary"
          onPress={() => router.push('/driver/truck')}
        />
        {status !== 'IN_PROGRESS' ? (
          <Message tone="info">Démarrez la journée pour pointer le camion.</Message>
        ) : null}
      </Card>

      <Card title="Tournée">
        {route?.route ? (
          <>
            <Text style={styles.big}>
              {(progress?.delivered ?? 0) + (progress?.partial ?? 0)} livrée(s) ·{' '}
              {progress?.failed ?? 0} échec(s) · {progress?.pending ?? 0} à livrer
            </Text>
            <Text style={styles.value}>Encaissé : {formatDA(progress?.collected ?? 0)}</Text>
            <PrimaryButton title="Ma tournée" onPress={() => router.push('/driver/route')} />
          </>
        ) : (
          <Text style={styles.muted}>Aucune tournée aujourd'hui.</Text>
        )}
      </Card>

      <PrimaryButton
        title="Bons du jour"
        variant="secondary"
        onPress={() => router.push('/driver/receipts')}
      />
      <PrimaryButton
        title="Ma paie"
        variant="secondary"
        onPress={() => router.push('/driver/pay')}
      />
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
  alert: { fontSize: 15, fontWeight: '600', color: colors.status.error },
});
