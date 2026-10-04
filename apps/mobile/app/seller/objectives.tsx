import { colors, radius } from '@sellwasl/config';
import type { MyObjective } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDA } from '@/seller/format';
import { Card, Message, Screen, Title } from '@/ui';

/** Objectifs du mois par gamme (UC-20, BR-OBJ-04) : cible, réalisé, taux, prime estimée. */
export default function ObjectivesScreen() {
  const [objectives, setObjectives] = useState<MyObjective[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<MyObjective[]>('/me/objectives')
      .then(setObjectives)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <Screen>
      <Title subtitle="Chiffre d'affaires livré du mois.">Mes objectifs</Title>
      {error ? <Message>{error}</Message> : null}
      {!objectives && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {objectives?.length === 0 ? <Message tone="info">Aucun objectif ce mois-ci.</Message> : null}
      {objectives?.map((o) => (
        <Card key={o.range.id} title={o.range.name}>
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
});
