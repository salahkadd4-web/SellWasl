import { colors } from '@sellwasl/config';
import type { MyPayDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { Card, Message, Screen, Title } from '@/ui';
import { IncentiveProgress } from './IncentiveProgress';

const STATUS: Record<string, string> = {
  OPEN: 'en préparation',
  CALCULATED: 'calculée',
  APPROVED: 'approuvée',
  PAID: 'payée',
  CLOSED: 'clôturée',
};
const LINE: Record<string, string> = {
  BASE_SALARY: 'Salaire',
  INCENTIVE: 'Prime',
  OBJECTIVE_BONUS: 'Objectif',
  DRIVER_BONUS: 'Objectif',
  ADJUSTMENT: 'Ajustement',
  ADVANCE: 'Acompte',
  DEDUCTION: 'Retenue',
};

const thisMonth = () => new Date().toISOString().slice(0, 7);
const shift = (month: string, delta: number) => {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('fr-DZ', { month: 'long', year: 'numeric' });

/**
 * Ma paie (phase 21 bis) : fiche du mois avec chaque ligne, échéances, primes, acomptes et
 * retenues de l'employé connecté, et de lui seul. Calculée par le serveur.
 */
export function MyPayScreen() {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<MyPayDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    request<MyPayDto>(`/me/pay?month=${month}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [month]);

  const salary = data?.compensation.find((c) => !c.effectiveTo) ?? data?.compensation[0];

  return (
    <Screen>
      <Title
        subtitle={
          salary ? `Salaire en vigueur : ${formatDA(salary.baseSalary)} par mois` : undefined
        }
      >
        Ma paie
      </Title>
      <View style={styles.months}>
        <Pressable onPress={() => setMonth(shift(month, -1))} style={styles.chip}>
          <Text style={styles.chipText}>‹ Mois précédent</Text>
        </Pressable>
        <Text style={styles.month}>{monthLabel(month)}</Text>
        <Pressable
          disabled={month >= thisMonth()}
          onPress={() => setMonth(shift(month, 1))}
          style={[styles.chip, month >= thisMonth() && styles.disabled]}
        >
          <Text style={styles.chipText}>Suivant ›</Text>
        </Pressable>
      </View>
      <IncentiveProgress />
      {error ? <Message>{error}</Message> : null}
      {!data && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {data ? (
        <>
          <Card title={data.entry ? `Fiche · ${STATUS[data.entry.status]}` : 'Fiche du mois'}>
            {!data.entry ? (
              <Text style={styles.muted}>La paie de ce mois n'est pas encore calculée.</Text>
            ) : (
              <>
                {data.entry.lines.map((l) => (
                  <View key={l.id} style={styles.row}>
                    <Text style={styles.label}>
                      {LINE[l.kind]} · {l.label}
                    </Text>
                    <Text style={l.amount < 0 ? styles.minus : styles.value}>
                      {formatDA(l.amount)}
                    </Text>
                  </View>
                ))}
                <View style={styles.row}>
                  <Text style={styles.big}>Net à payer</Text>
                  <Text style={styles.big}>{formatDA(data.entry.net)}</Text>
                </View>
                {data.entry.payments.map((p) => (
                  <Text key={p.id} style={p.paidAt ? styles.ok : styles.muted}>
                    {formatDate(p.dueDate)} : {formatDA(p.amount)} ·{' '}
                    {p.paidAt ? 'payée' : 'à venir'}
                  </Text>
                ))}
              </>
            )}
          </Card>
          <Card title="Mes primes">
            {data.incentives.length === 0 ? (
              <Text style={styles.muted}>Aucune prime ce mois-là.</Text>
            ) : null}
            {data.incentives.map((i) => (
              <View key={i.id} style={styles.row}>
                <Text style={styles.label}>
                  {i.rule.name} · {i.quantity} {i.unitName ?? ''} · du {formatDate(i.periodStart)}
                </Text>
                <Text style={styles.value}>{formatDA(i.amount)}</Text>
              </View>
            ))}
          </Card>
          <Card title="Mes acomptes et retenues">
            {data.advances.length + data.deductions.length === 0 ? (
              <Text style={styles.muted}>Aucun acompte ni retenue.</Text>
            ) : null}
            {data.advances.map((a) => (
              <View key={a.id} style={styles.row}>
                <Text style={styles.label}>Acompte</Text>
                <Text style={styles.value}>{formatDA(a.amount)}</Text>
              </View>
            ))}
            {data.deductions.map((d) => (
              <View key={d.id} style={styles.row}>
                <Text style={styles.label}>Retenue · {d.reason}</Text>
                <Text style={styles.minus}>{formatDA(d.amount)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  month: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipText: { color: colors.textDark, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  label: { flex: 1, fontSize: 15, color: colors.textDark },
  value: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  minus: { fontSize: 15, fontWeight: '600', color: colors.status.error },
  big: { fontSize: 18, fontWeight: '700', color: colors.primary },
  muted: { fontSize: 14, color: colors.muted },
  ok: { fontSize: 14, fontWeight: '600', color: colors.status.synced },
});
