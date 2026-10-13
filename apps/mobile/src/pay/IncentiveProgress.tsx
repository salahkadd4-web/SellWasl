import { colors } from '@sellwasl/config';
import type { IncentiveProgressDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { phoneDate } from '@/offline/ids';
import { formatDA, formatDate } from '@/seller/format';
import { Card } from '@/ui';

/** Prochain palier à atteindre, pour motiver : « encore 20 cartons pour 20 DA le carton ». */
function nextStep(p: IncentiveProgressDto): string | null {
  const unit = p.unitName ?? 'unité(s)';
  if (p.daily) {
    // Objectif du jour (BR-OBJ-06) : ce qu'il reste à faire aujourd'hui
    const today = p.daily.days.find((d) => d.date === phoneDate())?.qty ?? 0;
    if (p.daily.minQty !== null && today < p.daily.minQty)
      return `Encore ${p.daily.minQty - today} ${unit} aujourd'hui pour que la journée compte.`;
    if (today < p.daily.dailyTarget)
      return `Encore ${p.daily.dailyTarget - today} ${unit} aujourd'hui pour la prime entière.`;
    return null;
  }
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
            {p.daily ? (
              <Text style={styles.muted}>
                Aujourd'hui : {p.daily.days.find((d) => d.date === phoneDate())?.qty ?? 0} /{' '}
                {p.daily.dailyTarget} {p.unitName ?? ''}
                {p.daily.minQty !== null ? ` · compté dès ${p.daily.minQty}` : ''} · payé en fin de
                semaine
              </Text>
            ) : null}
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
