import { colors, radius } from '@sellwasl/config';
import { objectivesView } from '@sellwasl/offline';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocal } from '@/offline/SyncProvider';
import { IncentiveProgress } from '@/pay/IncentiveProgress';
import { formatDA, formatDate } from '@/seller/format';
import { Card, Message, Screen, Title } from '@/ui';

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Objectifs du mois par gamme (UC-20, BR-OBJ-04) : cible, réalisé, taux, prime estimée. */
export default function ObjectivesScreen() {
  // Objectifs reçus à la dernière synchronisation (le réalisé suit après l'envoi des commandes)
  const { data: objectives, error } = useLocal(objectivesView, []);

  return (
    <Screen>
      <Title subtitle="Chiffre d'affaires livré du mois ; prime versée à la date indiquée.">
        Mes objectifs
      </Title>
      <IncentiveProgress />
      {error ? <Message>{error}</Message> : null}
      {!objectives && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {objectives?.length === 0 ? <Message tone="info">Aucun objectif ce mois-ci.</Message> : null}
      {objectives?.map((o) => (
        <Card
          key={`${o.month}-${o.range.id}`}
          title={`${o.range.name} · ${MONTHS[Number(o.month.slice(5, 7)) - 1]} ${o.month.slice(0, 4)}`}
        >
          <Text style={styles.rate}>{o.rate.toString().replace('.', ',')} %</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(o.rate, 100)}%` }]} />
          </View>
          <Text style={styles.line}>Réalisé : {formatDA(o.realizedAmount)}</Text>
          <Text style={styles.line}>Cible : {formatDA(o.targetAmount)}</Text>
          <Text style={styles.line}>
            Prime estimée : {formatDA(o.estimatedBonus)} sur {formatDA(o.bonusAmount)} (
            {o.capPercent === null ? 'sans plafond' : `plafond ${o.capPercent} %`})
          </Text>
          <Text style={styles.muted}>Prime versée le {formatDate(o.paymentDate)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rate: { fontSize: 26, fontWeight: '700', color: colors.primary },
  track: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
});
