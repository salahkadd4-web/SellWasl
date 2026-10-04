import { colors } from '@sellwasl/config';
import type { CustomerDto, CustomerHistory } from '@sellwasl/validation';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { request } from '@/api/client';
import { callCustomer, openDirections } from '@/seller/customers';
import {
  errorMessage,
  FREQUENCY_LABELS,
  formatDA,
  formatDate,
  VISIT_STATUS_LABELS,
} from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Fiche d'un client (UC-11) : informations, dette, historique, actions. */
export default function CustomerSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargée au retour d'une visite ou d'un encaissement
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const [c, h] = await Promise.all([
            request<CustomerDto>(`/customers/${id}`),
            request<CustomerHistory>(`/customers/${id}/history`),
          ]);
          setCustomer(c);
          setHistory(h);
          setError(null);
        } catch (e) {
          setError(errorMessage(e, 'Fiche indisponible.'));
        }
      })();
    }, [id]),
  );

  if (!customer)
    return (
      <Screen>
        {error ? <Message>{error}</Message> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );

  return (
    <Screen>
      <Title
        subtitle={[customer.code, customer.customerType.name, customer.part?.name ?? 'Hors partie']
          .filter(Boolean)
          .join(' · ')}
      >
        {customer.name}
      </Title>
      {error ? <Message>{error}</Message> : null}

      <Card>
        <Text style={customer.debtAmount > 0 ? styles.debt : styles.line}>
          Dette : {formatDA(customer.debtAmount)}
        </Text>
        <Text style={styles.line}>Visite : {FREQUENCY_LABELS[customer.frequency]}</Text>
        {customer.phone ? <Text style={styles.line}>Téléphone : {customer.phone}</Text> : null}
        {customer.address ? <Text style={styles.line}>{customer.address}</Text> : null}
        {customer.isCashOnly ? <Text style={styles.muted}>Vente au comptant seulement</Text> : null}
      </Card>

      <WorkdayGuard>
        <PrimaryButton
          title="Commencer la visite"
          onPress={() => router.push(`/seller/visit/${customer.id}`)}
        />
        {customer.debtAmount > 0 ? (
          <PrimaryButton
            title="Encaisser une dette"
            variant="secondary"
            onPress={() => router.push(`/seller/debt/${customer.id}`)}
          />
        ) : null}
      </WorkdayGuard>
      {customer.phone ? (
        <PrimaryButton
          title="Appeler"
          variant="secondary"
          onPress={() => callCustomer(customer.phone!)}
        />
      ) : null}
      {customer.latitude != null && customer.longitude != null ? (
        <PrimaryButton
          title="Itinéraire"
          variant="secondary"
          onPress={() => void openDirections(customer.latitude!, customer.longitude!)}
        />
      ) : null}

      <Card title="Dernières visites">
        {history?.visits.length ? (
          history.visits.slice(0, 10).map((v) => (
            <Text key={v.id} style={styles.line}>
              {formatDate(v.date)} · {VISIT_STATUS_LABELS[v.status] ?? v.status}
              {v.outcome === 'NO_ORDER' ? ' · sans commande' : ''}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>Aucune visite.</Text>
        )}
      </Card>
      <Card title="Commandes">
        {history?.orders.length ? (
          history.orders.slice(0, 10).map((o) => (
            <Text key={o.id} style={styles.line}>
              {formatDate(o.date)} · {o.number} · {formatDA(o.totalAmount)}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>Aucune commande.</Text>
        )}
      </Card>
      <Card title="Paiements">
        {history?.payments.length ? (
          history.payments.slice(0, 10).map((p) => (
            <Text key={p.id} style={styles.line}>
              {formatDate(p.date)} · {p.number} · {formatDA(p.cashAmount)}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>Aucun paiement.</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 15, color: colors.textDark },
  debt: { fontSize: 17, fontWeight: '700', color: colors.status.toVisit },
  muted: { fontSize: 15, color: colors.muted },
});
