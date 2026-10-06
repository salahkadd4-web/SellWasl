import { colors } from '@sellwasl/config';
import type { RefusalDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';

const STATUS: Record<RefusalDto['contestStatus'], string> = {
  NONE: 'Non contesté',
  CONTESTED: 'Contesté : en attente du superviseur',
  UPHELD: 'Contestation retenue',
  REJECTED: 'Refus confirmé',
};

/**
 * Refus de mes commandes (phase 21) : le pré-vendeur voit les refus déclarés par le livreur et
 * peut en contester un ; le superviseur tranche.
 */
export default function RefusalsScreen() {
  const { act } = useToday();
  const [rows, setRows] = useState<RefusalDto[] | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await request<RefusalDto[]>('/me/refusals'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function contest(deliveryId: string) {
    if (comment.trim().length < 3) return setError('Expliquez la contestation.');
    setError(null);
    setBusy(true);
    try {
      await act('refusal.contest', { deliveryId, comment: comment.trim() });
      setWriting(null);
      setComment('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!rows && !error) return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  return (
    <Screen>
      <Title subtitle="Les 30 derniers jours. Le motif du livreur est un indice, pas une preuve.">
        Refus de mes commandes
      </Title>
      {error ? <Message>{error}</Message> : null}
      {rows?.length === 0 ? <Message tone="info">Aucun refus.</Message> : null}
      {rows?.map((r) => (
        <Card key={r.deliveryId} title={r.customer.name}>
          <Text style={styles.muted}>
            {formatDate(r.date)} · commande {r.order.number} · livreur {r.driver}
          </Text>
          <Text style={styles.line}>
            {r.result === 'FAILED' ? 'Commande refusée' : 'Refus partiel'} · motif {r.reason ?? '—'}{' '}
            · {formatDA(r.refusedValue)}
          </Text>
          {r.lines.map((l, i) => (
            <Text key={i} style={styles.muted}>
              {l.article} : {l.qty}
            </Text>
          ))}
          <Text style={r.contestStatus === 'UPHELD' ? styles.ok : styles.status}>
            {STATUS[r.contestStatus]}
          </Text>
          {r.contestComment ? <Text style={styles.muted}>« {r.contestComment} »</Text> : null}
          {r.contestStatus === 'NONE' ? (
            writing === r.deliveryId ? (
              <>
                <Input
                  label="Pourquoi contestez-vous ce refus ?"
                  value={comment}
                  onChangeText={setComment}
                />
                <PrimaryButton
                  title="Envoyer la contestation"
                  busy={busy}
                  onPress={() => void contest(r.deliveryId)}
                />
                <PrimaryButton
                  title="Annuler"
                  variant="secondary"
                  onPress={() => setWriting(null)}
                />
              </>
            ) : (
              <PrimaryButton
                title="Contester"
                variant="secondary"
                onPress={() => {
                  setComment('');
                  setWriting(r.deliveryId);
                }}
              />
            )
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  status: { fontSize: 14, fontWeight: '600', color: colors.textDark },
  ok: { fontSize: 14, fontWeight: '600', color: colors.status.synced },
});
