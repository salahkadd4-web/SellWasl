import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSync } from './SyncProvider';

/**
 * État de la synchronisation, toujours visible sur l'accueil du terrain (BR-SYN-06) :
 * « Synchronisé », « N opérations en attente » ou « Erreur » ; un appui ouvre l'écran
 * Synchronisation du rôle.
 */
export function SyncBar({ href }: { href: '/seller/sync' | '/driver/sync' }) {
  const router = useRouter();
  const { indicator, syncing, online } = useSync();
  const { state, pending, conflicts } = indicator;
  const label =
    state === 'ERROR'
      ? conflicts > 0
        ? `Erreur : ${conflicts} action${conflicts > 1 ? 's' : ''} refusée${conflicts > 1 ? 's' : ''}`
        : 'Erreur de synchronisation'
      : state === 'PENDING'
        ? `${pending} opération${pending > 1 ? 's' : ''} en attente${online ? '' : ' · hors connexion'}`
        : syncing
          ? 'Synchronisation…'
          : 'Synchronisé';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.bar,
        state === 'ERROR' ? styles.error : state === 'PENDING' ? styles.pending : styles.synced,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color:
              state === 'ERROR'
                ? colors.background
                : state === 'PENDING'
                  ? colors.textDark
                  : colors.status.synced,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 12, borderRadius: radius.md },
  pending: { backgroundColor: colors.status.pending },
  error: { backgroundColor: colors.status.error },
  synced: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  text: { textAlign: 'center', fontWeight: '600' },
});
