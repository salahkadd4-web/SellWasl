import { colors } from '@sellwasl/config';
import type { OutboxOp } from '@sellwasl/offline';
import { OPERATION_LABELS, type SyncChange } from '@sellwasl/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';
import { useSync } from './SyncProvider';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' });

/** Nom de l'article d'un changement, depuis le catalogue du téléphone. */
function useArticle() {
  const { local } = useSync();
  return (variantId: string) => {
    for (const p of local?.products ?? []) {
      const v = p.variants.find((x) => x.id === variantId);
      if (v) return v.isDefault ? p.name : `${p.name} ${v.name}`;
    }
    return 'Article';
  };
}

/** Changement fait par le serveur à la réception, en clair (BR-SYN-05). */
function changeLabel(c: SyncChange, article: (id: string) => string): string {
  const name = article(c.productVariantId);
  switch (c.kind) {
    case 'QUOTA_PENDING':
      return `${name} : quantité passée en attente (quota du jour)`;
    case 'STOCKOUT':
      return `${name} : rupture au dépôt (${c.reservedQty} réservée(s) sur ${c.orderedQty})`;
    case 'QUOTA_EXCEEDED':
      return `${name} : quota dépassé, vente acceptée`;
    case 'TRUCK_STOCK_SHORT':
      return `${name} : stock du camion insuffisant (${c.shortQty}), écart enregistré`;
  }
}

const STATUS: Record<OutboxOp['status'], string> = {
  PENDING: 'En attente',
  SYNCING: 'Envoi en cours',
  SYNCED: 'Appliquée',
  FAILED: 'Nouvel essai bientôt',
  CONFLICT: 'Refusée',
};

/**
 * Écran Synchronisation (BR-SYN-06, BR-SYN-07) : bouton « Synchroniser », opérations en attente,
 * actions refusées avec leur motif, changements faits par le serveur à la réception.
 */
export function SyncScreen() {
  const { ops, online, syncing, lastSyncAt, lastError, syncNow, markSeen } = useSync();
  const article = useArticle();
  const [info, setInfo] = useState<string | null>(null);
  const pending = ops.filter((o) => ['PENDING', 'SYNCING', 'FAILED'].includes(o.status));
  const refused = ops.filter((o) => o.status === 'CONFLICT');
  const changed = ops.filter((o) => o.status === 'SYNCED' && o.changes.length > 0);

  async function run() {
    setInfo(null);
    const report = await syncNow();
    setInfo(report.ok ? 'Synchronisation terminée.' : null);
  }

  return (
    <Screen>
      <Title
        subtitle={
          lastSyncAt
            ? `Dernière synchronisation : ${time(lastSyncAt)}${online ? '' : ' · hors connexion'}`
            : 'Aucune synchronisation sur ce téléphone.'
        }
      >
        Synchronisation
      </Title>

      <PrimaryButton title="Synchroniser" busy={syncing} onPress={() => void run()} />
      {!online ? (
        <Message tone="info">
          Pas de réseau : vos actions sont enregistrées sur le téléphone et partiront au retour du
          réseau.
        </Message>
      ) : null}
      {lastError && online ? <Message>{lastError}</Message> : null}
      {info ? <Message tone="info">{info}</Message> : null}

      {changed.length > 0 ? (
        <Card title="Changements à la réception">
          {changed.map((o) => (
            <View key={o.opId} style={styles.item}>
              <Text style={styles.name}>
                {OPERATION_LABELS[o.type] ?? o.type} · {time(o.occurredAt)}
              </Text>
              {o.changes.map((c, i) => (
                <Text key={i} style={styles.line}>
                  {changeLabel(c, article)}
                </Text>
              ))}
            </View>
          ))}
          <PrimaryButton
            title="J'ai vu"
            variant="secondary"
            onPress={() => void markSeen(changed.map((o) => o.opId))}
          />
        </Card>
      ) : null}

      {refused.length > 0 ? (
        <Card title="Actions refusées">
          {refused.map((o) => (
            <View key={o.opId} style={styles.item}>
              <Text style={styles.name}>
                {OPERATION_LABELS[o.type] ?? o.type} · {time(o.occurredAt)}
              </Text>
              <Text style={styles.refused}>{o.error?.message ?? 'Action refusée.'}</Text>
            </View>
          ))}
          {refused.some((o) => !o.seen) ? (
            <PrimaryButton
              title="J'ai vu"
              variant="secondary"
              onPress={() => void markSeen(refused.map((o) => o.opId))}
            />
          ) : null}
        </Card>
      ) : null}

      <Card title="En attente d'envoi">
        {pending.length === 0 ? (
          <Text style={styles.muted}>Aucune opération en attente.</Text>
        ) : (
          pending.map((o) => (
            <View key={o.opId} style={styles.row}>
              <Text style={styles.line}>
                {OPERATION_LABELS[o.type] ?? o.type} · {time(o.occurredAt)}
              </Text>
              <Text style={styles.muted}>{STATUS[o.status]}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  line: { flex: 1, fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  refused: { fontSize: 15, color: colors.status.error },
});
