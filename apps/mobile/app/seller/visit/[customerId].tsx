import { colors } from '@sellwasl/config';
import { customerView } from '@sellwasl/offline';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { readPosition } from '@/location/useLocation';
import { useLocal } from '@/offline/SyncProvider';
import { errorMessage, formatDistance } from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

type Mode = 'ON_SITE' | 'PHONE';

interface ReasonRow {
  id: string;
  kind: string;
  label: string;
  isActive: boolean;
}

/**
 * Visite d'un client (UC-13, UC-16) : sur place (distance, hors zone signalé sans bloquer) ou par
 * téléphone, puis commande ou clôture sans commande avec un motif.
 */
export default function VisitScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const { today, act } = useToday();
  // Client et motifs gardés sur le téléphone (phase 23)
  const { data: customer } = useLocal((s) => customerView(s, customerId), [customerId]);
  const { data: allReasons } = useLocal((s) => s.reasons, []);
  const [mode, setMode] = useState<Mode>('ON_SITE');
  const [reasons, setReasons] = useState<ReasonRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = today?.currentVisit ?? null;
  const isCashVan = today?.seller.roleCode === 'VENDEUR_CASH_VAN';
  const isScheduled = today?.day.customers.some((c) => c.id === customerId) ?? false;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const position = mode === 'ON_SITE' ? await readPosition() : null;
      await act('visit.start', {
        visitId: newId(),
        customerId,
        mode,
        latitude: position?.latitude ?? null,
        longitude: position?.longitude ?? null,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function showReasons() {
    setError(null);
    const list = (allReasons ?? []).filter((r) => r.kind === 'NO_ORDER' && r.isActive);
    if (list.length === 0) setError('Motifs absents du téléphone : synchronisez.');
    setReasons(list);
  }

  function closeWith(reason: ReasonRow) {
    if (!current) return;
    Alert.alert('Clore la visite ?', `Motif : ${reason.label}`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Clore',
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              await act('visit.close_no_order', { visitId: current.id, reasonId: reason.id });
              router.back();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  }

  return (
    <Screen>
      <Title subtitle={isScheduled ? 'Client du jour' : 'Hors programme'}>
        {customer?.name ?? 'Visite'}
      </Title>
      {current && current.customerId !== customerId ? (
        <>
          <Message>Une autre visite est en cours : terminez-la d'abord.</Message>
          <PrimaryButton
            title="Aller à la visite en cours"
            onPress={() => router.replace(`/seller/visit/${current.customerId}`)}
          />
        </>
      ) : current ? (
        <>
          <Card title="Visite en cours">
            <Text style={styles.line}>
              {current.mode === 'PHONE' ? 'Par téléphone' : 'Sur place'}
              {current.distanceM !== null ? ` · à ${formatDistance(current.distanceM)}` : ''}
            </Text>
            {current.isOutOfZone ? (
              <Text style={styles.warning}>
                Hors zone : signalé au superviseur, la visite continue.
              </Text>
            ) : null}
          </Card>
          <PrimaryButton
            title={isCashVan ? 'Vendre' : 'Prendre une commande'}
            onPress={() => router.push(`/seller/order/${current.id}?customerId=${customerId}`)}
          />
          {reasons ? (
            <View style={styles.reasons}>
              <Text style={styles.label}>Motif de non-commande</Text>
              {reasons.map((r) => (
                <PrimaryButton
                  key={r.id}
                  title={r.label}
                  variant="secondary"
                  onPress={() => closeWith(r)}
                  busy={busy}
                />
              ))}
            </View>
          ) : (
            <PrimaryButton
              title="Pas de commande"
              variant="secondary"
              onPress={() => void showReasons()}
            />
          )}
        </>
      ) : (
        <WorkdayGuard>
          {isCashVan ? null : (
            <View style={styles.reasons}>
              <Text style={styles.label}>Mode de visite</Text>
              <PrimaryButton
                title="Sur place"
                variant={mode === 'ON_SITE' ? 'primary' : 'secondary'}
                onPress={() => setMode('ON_SITE')}
              />
              <PrimaryButton
                title="Par téléphone"
                variant={mode === 'PHONE' ? 'primary' : 'secondary'}
                onPress={() => setMode('PHONE')}
              />
            </View>
          )}
          <PrimaryButton title="Commencer la visite" onPress={() => void start()} busy={busy} />
        </WorkdayGuard>
      )}
      {error ? <Message>{error}</Message> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 16, color: colors.textDark },
  warning: { fontSize: 15, fontWeight: '600', color: colors.status.error },
  label: { fontWeight: '600', color: colors.textDark },
  reasons: { gap: 8 },
});
