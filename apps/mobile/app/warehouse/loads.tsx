import { colors } from '@sellwasl/config';
import type { LoadDto, RouteSummaryDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDate } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

/**
 * Chargements (UC-42) : une tournée préparée part vers le camion du livreur avec les quantités
 * préparées ; un camion de cash van se charge librement.
 */
export default function LoadsScreen() {
  const router = useRouter();
  const [routes, setRoutes] = useState<RouteSummaryDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await request<RouteSummaryDto[]>('/routes/preparing');
      setRoutes(list.filter((r) => r.status === 'READY'));
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

  async function load(route: RouteSummaryDto) {
    setError(null);
    setDone(null);
    setBusy(route.id);
    try {
      const created = await request<LoadDto>(`/routes/${route.id}/load`, { method: 'POST' });
      setDone(`${created.truck.code} chargé : ${created.lines.length} article(s).`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Title subtitle="Le préparé part du dépôt vers le camion du livreur.">Chargements</Title>
      {error ? <Message>{error}</Message> : null}
      {done ? <Message tone="info">{done}</Message> : null}
      {!routes && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {routes?.length === 0 ? <Message tone="info">Aucune tournée prête à charger.</Message> : null}
      {routes?.map((r) => (
        <Card key={r.id} title={r.driver.name}>
          <View style={styles.info}>
            <Text style={styles.muted}>
              Livraison du {formatDate(r.deliveryDate)} · {r.truck?.code ?? 'pas de camion'} ·{' '}
              {r.ordersCount} commande(s)
            </Text>
          </View>
          <PrimaryButton
            title="Charger le camion"
            busy={busy === r.id}
            disabled={busy !== null && busy !== r.id}
            onPress={() =>
              Alert.alert(
                'Charger le camion ?',
                `Les quantités préparées partent vers ${r.truck?.code ?? 'le camion'}.`,
                [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Charger', onPress: () => void load(r) },
                ],
              )
            }
          />
        </Card>
      ))}
      <PrimaryButton
        title="Charger un camion de cash van"
        variant="secondary"
        onPress={() => router.push('/warehouse/load-new')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { gap: 2 },
  muted: { fontSize: 14, color: colors.muted },
});
