import { colors } from '@sellwasl/config';
import { driverRouteView } from '@sellwasl/offline';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { ActionButton, Greeting, SyncPanel } from '@/components/Home';
import { Panel, StatTile, TileGrid } from '@/components/Tiles';
import { setPositionSharing } from '@/device/heartbeat';
import { phoneDate } from '@/offline/ids';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { startWorkday } from '@/offline/workday';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { newId, sendOperation } from '@/sync/operations';
import { Message, PrimaryButton } from '@/ui';

/**
 * Accueil du livreur (refonte mobile) : livraisons du jour, journée, camion, synchronisation ;
 * la tournée, les bons et la carte sont dans les onglets.
 */
export default function DriverDashboard() {
  const router = useRouter();
  const { me, profile } = useAuth();
  // Tournée gardée sur le téléphone, avec les actions en attente d'envoi (phase 23)
  const { online, syncNow, ready } = useSync();
  const { data: route } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
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

  if (!ready || !route) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  const status = route.workday?.status ?? 'NOT_STARTED';
  const progress = route.progress;
  const delivered = (progress?.delivered ?? 0) + (progress?.partial ?? 0);
  const total = route.deliveries.length;

  function close() {
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
                { workdayId: route!.workday!.id, ...(online ? {} : { offline: true }) },
                route!.workday!.id,
              ),
            ),
        },
      ],
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Greeting
        name={me?.user.firstName ?? profile?.firstName ?? ''}
        subtitle={[me?.user.code ?? profile?.userCode, formatDate(route.date)]
          .filter(Boolean)
          .join(' · ')}
      />
      {error ? <Message>{error}</Message> : null}

      {route.route ? (
        <TileGrid>
          <StatTile
            icon="package"
            value={String(total)}
            label="Livraisons du jour"
            onPress={() => router.push('/driver/route')}
          />
          <StatTile
            icon="check-circle"
            value={`${delivered}/${total}`}
            extra={total > 0 ? `${Math.round((delivered / total) * 100)} %` : undefined}
            label="Livraisons faites"
            onPress={() => router.push('/driver/route')}
          />
          <StatTile
            icon="clock"
            value={String(progress?.pending ?? 0)}
            label="Restantes"
            onPress={() => router.push('/driver/route')}
          />
          <StatTile
            icon="dollar-sign"
            value={formatDA(progress?.collected ?? 0)}
            label="Encaissé"
          />
        </TileGrid>
      ) : null}

      <Panel>
        <Text style={styles.panelTitle}>Journée</Text>
        {status === 'NOT_STARTED' ? (
          <>
            <Text style={styles.muted}>Journée non démarrée</Text>
            <ActionButton
              title="Démarrer la journée"
              icon="play"
              color={colors.primary}
              busy={busy}
              onPress={() => void act(() => startWorkday(newId(), online, syncNow))}
            />
          </>
        ) : status === 'IN_PROGRESS' ? (
          <>
            <Text style={styles.ok}>Journée en cours</Text>
            {route.route ? (
              <Text style={styles.value}>
                {delivered} livrée(s) · {progress?.failed ?? 0} échec(s) · {progress?.pending ?? 0}{' '}
                à livrer
              </Text>
            ) : null}
            <Text style={styles.muted}>
              De retour au dépôt : clôturez la journée, c'est votre déclaration de retour. Le
              magasinier contrôle ensuite le camion.
            </Text>
            <ActionButton
              title="Je suis de retour : clôturer la journée"
              icon="lock"
              color={colors.coral}
              busy={busy}
              onPress={close}
            />
          </>
        ) : (
          <Text style={styles.muted}>Journée clôturée : passez au déchargement au dépôt.</Text>
        )}
        {route.route ? (
          <PrimaryButton
            title="Ma tournée"
            variant="secondary"
            onPress={() => router.push('/driver/route')}
          />
        ) : (
          <Text style={styles.muted}>Aucune tournée aujourd'hui.</Text>
        )}
      </Panel>

      <Panel>
        <Text style={styles.panelTitle}>
          {route.loadToReceive ? 'Camion · chargement à pointer' : 'Camion'}
        </Text>
        <Text style={route.loadToReceive ? styles.alert : styles.muted}>
          {route.loadToReceive
            ? `${route.loadToReceive.truckCode} : un chargement attend votre pointage.`
            : 'Pointez le camion en début de journée.'}
        </Text>
        <PrimaryButton
          title="Pointer le camion"
          disabled={status !== 'IN_PROGRESS'}
          onPress={() => router.push('/driver/receive')}
        />
        {status !== 'IN_PROGRESS' ? (
          <Message tone="info">Démarrez la journée pour pointer le camion.</Message>
        ) : null}
      </Panel>

      <SyncPanel href="/driver/sync" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  container: { padding: 16, gap: 16, backgroundColor: colors.surface },
  panelTitle: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  value: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 15, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.successText },
  alert: { fontSize: 15, fontWeight: '600', color: colors.status.error },
});
