import { colors } from '@sellwasl/config';
import type { DriverObjectiveDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { request } from '@/api/client';
import { IncentiveProgress } from '@/pay/IncentiveProgress';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { Card, Message, Screen, Title } from '@/ui';

/** Objectif du livreur : taux de retour, score du mois et prime due. */
export default function DriverObjectivesScreen() {
  const [objectives, setObjectives] = useState<DriverObjectiveDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<DriverObjectiveDto[]>('/me/driver-objectives')
      .then(setObjectives)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (!objectives && !error)
    return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Moins de retours au dépôt, meilleur score.">Objectifs</Title>
      <IncentiveProgress />
      {error ? <Message>{error}</Message> : null}
      {objectives?.map((o) => (
        <Card key={o.month} title={o.month.split('-').reverse().join('/')}>
          <Text style={styles.big}>Score : {o.score} %</Text>
          <Text style={styles.line}>
            {o.returnRate === null
              ? 'Aucun chargement ce mois-ci'
              : `Taux de retour : ${o.returnRate} % (${o.returned} revenus sur ${o.loaded} chargés)`}
          </Text>
          <Text style={styles.line}>Prime due : {formatDA(o.estimatedBonus)}</Text>
          <Text style={styles.muted}>Versée le {formatDate(o.paymentDate)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  big: { fontSize: 20, fontWeight: '700', color: colors.primary },
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
});
