import { colors } from '@sellwasl/config';
import { notificationsView } from '@sellwasl/offline';
import { StyleSheet, Text, View } from 'react-native';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { sendOperation } from '@/sync/operations';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-DZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Notifications du terrain (BR-NOT-03) : gardées sur le téléphone (30 jours), lisibles hors
 * connexion ; « lu » part avec la prochaine synchronisation.
 */
export function NotificationsScreen() {
  const { data: list } = useLocal(notificationsView, []);
  const { syncing, syncNow } = useSync();
  const unread = (list ?? []).filter((n) => !n.readAt);

  return (
    <Screen>
      <Title subtitle="Messages de votre superviseur et de l'application.">Notifications</Title>
      {unread.length > 0 ? (
        <PrimaryButton
          title="Tout marquer comme lu"
          variant="secondary"
          onPress={() =>
            void sendOperation('notification.read', { notificationIds: unread.map((n) => n.id) })
          }
        />
      ) : null}
      {list?.length === 0 ? <Message tone="info">Aucune notification.</Message> : null}
      {list?.map((n) => (
        <Card key={n.id}>
          <View style={styles.head}>
            <Text style={n.readAt ? styles.title : styles.unread}>{n.title}</Text>
            <Text style={styles.muted}>{when(n.createdAt)}</Text>
          </View>
          <Text style={styles.line}>{n.body}</Text>
          {!n.readAt ? (
            <PrimaryButton
              title="Marquer comme lu"
              variant="secondary"
              onPress={() => void sendOperation('notification.read', { notificationIds: [n.id] })}
            />
          ) : null}
        </Card>
      ))}
      <PrimaryButton
        title="Actualiser"
        variant="secondary"
        busy={syncing}
        onPress={() => void syncNow()}
      />
    </Screen>
  );
}

/** Carte des accueils : nombre de notifications non lues. */
export function NotificationsCard({ onOpen }: { onOpen: () => void }) {
  const { data: list } = useLocal(notificationsView, []);
  const unread = (list ?? []).filter((n) => !n.readAt).length;
  return (
    <Card title="Notifications">
      <Text style={unread > 0 ? styles.unread : styles.muted}>
        {unread > 0
          ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`
          : 'Aucune notification non lue'}
      </Text>
      <PrimaryButton title="Voir les notifications" variant="secondary" onPress={onOpen} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.textDark },
  unread: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.primary },
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
});
