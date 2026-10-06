import { colors } from '@sellwasl/config';
import type { IncentiveProgressDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { formatDA, formatDate } from '@/seller/format';
import { Card } from '@/ui';

/** Prochain palier à atteindre, pour motiver : « encore 20 cartons pour 20 DA le carton ». */
function nextStep(p: IncentiveProgressDto): string | null {
  const unit = p.unitName ?? 'unité(s)';
  if (p.rule.kind === 'THRESHOLD' && p.rule.threshold && p.quantity < p.rule.threshold)
    return `Encore ${p.rule.threshold - p.quantity} ${unit} pour ${formatDA(p.rule.amount ?? 0)}.`;
  if (p.rule.kind === 'REVENUE_TARGET' && p.rule.threshold && p.revenue < p.rule.threshold)
    return `Encore ${formatDA(p.rule.threshold - p.revenue)} de ventes pour ${formatDA(p.rule.amount ?? 0)}.`;
  if (p.rule.kind === 'TIERED') {
    const next = (p.rule.tiers ?? []).find((t) => t.minQty > p.quantity);
    if (next)
      return `Encore ${next.minQty - p.quantity} ${unit} pour ${formatDA(next.unitAmount)} par ${unit}.`;
  }
  return null;
}

/**
 * Primes en cours de l'employé (phase 21 bis) : quantité vendue et prime estimée sur la semaine
 * ou le mois en cours, calculées par le serveur sur les ventes livrées. Rien si aucune règle.
 */
export function IncentiveProgress() {
  const [rows, setRows] = useState<IncentiveProgressDto[] | null>(null);

  useEffect(() => {
    request<IncentiveProgressDto[]>('/me/incentives/progress')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows || rows.length === 0) return null;
  return (
    <Card title="Primes en cours">
      {rows.map((p) => {
        const hint = nextStep(p);
        return (
          <View key={`${p.rule.id}-${p.periodStart}`} style={styles.item}>
            <View style={styles.row}>
              <Text style={styles.name}>{p.rule.name}</Text>
              <Text style={styles.amount}>{formatDA(p.estimatedAmount)}</Text>
            </View>
            <Text style={styles.muted}>
              {p.rule.frequency === 'WEEKLY' ? 'Semaine' : 'Mois'} du {formatDate(p.periodStart)} au{' '}
              {formatDate(p.periodEnd)} · {p.quantity} {p.unitName ?? ''}
            </Text>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          </View>
        );
      })}
      <Text style={styles.muted}>Estimation ; la prime est validée par le comptable.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { gap: 2, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.textDark },
  amount: { fontSize: 16, fontWeight: '700', color: colors.primary },
  muted: { fontSize: 14, color: colors.muted },
  hint: { fontSize: 14, fontWeight: '600', color: colors.status.synced },
});
