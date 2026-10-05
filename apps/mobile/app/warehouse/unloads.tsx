import { colors } from '@sellwasl/config';
import type { PendingUnloadDto } from '@sellwasl/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage, formatDate } from '@/seller/format';
import { Message } from '@/ui';

/** Camions à décharger : journée de leur conducteur clôturée (UC-43). */
export default function UnloadsScreen() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingUnloadDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rechargés au retour d'un déchargement validé
  useFocusEffect(
    useCallback(() => {
      void request<PendingUnloadDto[]>('/unloads/pending')
        .then((list) => {
          setPending(list);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, []),
  );

  return (
    <FlatList
      data={pending ?? []}
      keyExtractor={(p) => p.workdayId}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? <Message>{error}</Message> : null}
          {!pending && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      ListEmptyComponent={pending ? <Message tone="info">Aucun camion à décharger.</Message> : null}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/warehouse/unload/${item.workdayId}`)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowText}>
            <Text style={styles.name}>
              {item.truck.code} · {item.user.name}
            </Text>
            <Text style={styles.muted}>Journée du {formatDate(item.date)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 16, backgroundColor: colors.background },
  header: { gap: 8 },
  separator: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
});
