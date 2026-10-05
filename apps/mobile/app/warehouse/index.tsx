import { colors } from '@sellwasl/config';
import type { PendingUnloadDto, RouteSummaryDto, StockAlertDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { request } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { errorMessage } from '@/seller/format';
import { Card, Message, PrimaryButton, Title } from '@/ui';

interface Counters {
  toPrepare: number;
  toLoad: number;
  toUnload: number;
  lowStock: number;
}

/** Tableau de bord du magasinier : ce qui attend au dépôt, et l'accès aux écrans. */
export default function WarehouseDashboard() {
  const router = useRouter();
  const { me, profile } = useAuth();
  const [counters, setCounters] = useState<Counters | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [routes, unloads, alerts] = await Promise.all([
        request<RouteSummaryDto[]>('/routes/preparing'),
        request<PendingUnloadDto[]>('/unloads/pending'),
        request<StockAlertDto[]>('/stock/alerts'),
      ]);
      setCounters({
        toPrepare: routes.filter((r) => r.status === 'PREPARING').length,
        toLoad: routes.filter((r) => r.status === 'READY').length,
        toUnload: unloads.length,
        lowStock: alerts.length,
      });
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Title
        subtitle={[me?.user.code ?? profile?.userCode, me?.role.name ?? profile?.roleName]
          .filter(Boolean)
          .join(' · ')}
      >
        Bonjour {me?.user.firstName ?? profile?.firstName}
      </Title>
      {error ? <Message>{error}</Message> : null}

      <Card title="Tournées">
        <Text style={styles.big}>
          À préparer : {counters?.toPrepare ?? '…'} · À charger : {counters?.toLoad ?? '…'}
        </Text>
        <PrimaryButton
          title="Préparations"
          onPress={() => router.push('/warehouse/preparations')}
        />
        <PrimaryButton
          title="Chargements"
          variant="secondary"
          onPress={() => router.push('/warehouse/loads')}
        />
      </Card>

      <Card title="Camions">
        <Text style={styles.big}>À décharger : {counters?.toUnload ?? '…'}</Text>
        <PrimaryButton
          title="Déchargements"
          variant="secondary"
          onPress={() => router.push('/warehouse/unloads')}
        />
      </Card>

      <Card title="Dépôt">
        <Text style={counters?.lowStock ? styles.alert : styles.value}>
          {counters?.lowStock
            ? `${counters.lowStock} article(s) sous leur seuil`
            : 'Aucun article sous son seuil'}
        </Text>
        <PrimaryButton
          title="Entrée au dépôt"
          variant="secondary"
          onPress={() => router.push('/warehouse/receipt')}
        />
        <PrimaryButton
          title="Inventaire"
          variant="secondary"
          onPress={() => router.push('/warehouse/inventory')}
        />
        <PrimaryButton
          title="Stock"
          variant="secondary"
          onPress={() => router.push('/warehouse/stock')}
        />
      </Card>

      <PrimaryButton
        title="Synchronisation"
        variant="secondary"
        onPress={() => router.push('/warehouse/sync')}
      />
      <PrimaryButton
        title="Profil"
        variant="secondary"
        onPress={() => router.push('/warehouse/profile')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, backgroundColor: colors.background },
  big: { fontSize: 18, fontWeight: '700', color: colors.textDark },
  value: { fontSize: 16, color: colors.textDark },
  alert: { fontSize: 16, fontWeight: '600', color: colors.status.error },
});
