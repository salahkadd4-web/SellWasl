import { colors } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { errorMessage, formatDA } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Clôture de la journée (UC-05) : résumé à confirmer, visite en cours d'abord terminée. */
export default function CloseDayScreen() {
  const router = useRouter();
  const { today, act } = useToday();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workday = today?.workday;
  const counters = today?.counters;
  const missed = (counters?.planned ?? 0) - (counters?.visited ?? 0);

  async function confirm() {
    if (!workday) return;
    setError(null);
    setBusy(true);
    try {
      await act('workday.close', { workdayId: workday.id });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (workday?.status !== 'IN_PROGRESS')
    return (
      <Screen>
        <Message tone="info">Aucune journée en cours.</Message>
      </Screen>
    );

  return (
    <Screen>
      <Title subtitle="Vérifiez le résumé avant de confirmer.">Résumé de la journée</Title>
      <Card>
        <Text style={styles.line}>
          Visites : {counters?.visited ?? 0} / {counters?.planned ?? 0}
        </Text>
        <Text style={styles.line}>Hors programme : {counters?.outOfProgram ?? 0}</Text>
        <Text style={styles.line}>Encaissé : {formatDA(counters?.collectedAmount ?? 0)}</Text>
        {missed > 0 ? (
          <Text style={styles.warning}>
            {missed} client{missed > 1 ? 's' : ''} non visité{missed > 1 ? 's' : ''} : visite
            {missed > 1 ? 's' : ''} manquée{missed > 1 ? 's' : ''}.
          </Text>
        ) : null}
      </Card>
      {today?.currentVisit ? (
        <>
          <Message>Terminez d'abord la visite en cours.</Message>
          <PrimaryButton
            title="Reprendre la visite"
            onPress={() => router.push(`/seller/visit/${today.currentVisit!.customerId}`)}
          />
        </>
      ) : (
        <PrimaryButton title="Confirmer la clôture" onPress={() => void confirm()} busy={busy} />
      )}
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Annuler" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 16, color: colors.textDark },
  warning: { fontSize: 15, fontWeight: '600', color: colors.status.toVisit },
});
