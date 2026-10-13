import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSync } from '@/offline/SyncProvider';
import { Panel } from './Tiles';

/** « Bonjour », nom et état du réseau (maquette « Accueil »). */
export function Greeting({ name, subtitle }: { name: string; subtitle?: string }) {
  const { online } = useSync();
  return (
    <View style={styles.greeting}>
      <Text style={styles.hello}>Bonjour {name}</Text>
      <View style={styles.greetingRow}>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={[styles.badge, online ? styles.badgeOn : styles.badgeOff]}>
          <View
            style={[
              styles.dot,
              { backgroundColor: online ? colors.status.synced : colors.status.pending },
            ]}
          />
          <Text
            style={[styles.badgeText, { color: online ? colors.successText : colors.textDark }]}
          >
            {online ? 'Connecté' : 'Hors ligne'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Bouton plein d'une couleur donnée (Démarrer en marine, Clôturer en corail). */
export function ActionButton({
  title,
  icon,
  color,
  onPress,
  busy,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: color },
        (pressed || busy) && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.background} />
      ) : (
        <>
          <Feather name={icon} size={20} color={colors.background} />
          <Text style={styles.actionText}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** « il y a moins d'une minute », « il y a 5 min », « il y a 2 h », sinon la date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "il y a moins d'une minute";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return `le ${iso.slice(0, 10).split('-').reverse().join('/')}`;
}

/**
 * Dernière synchronisation réussie, état réel (en attente, erreur) et bouton Synchroniser
 * (BR-SYN-06) ; un appui sur le texte ouvre l'écran Synchronisation.
 */
export function SyncPanel({ href }: { href: '/seller/sync' | '/driver/sync' }) {
  const router = useRouter();
  const { indicator, syncing, online, lastSyncAt, syncNow } = useSync();
  const [failure, setFailure] = useState<string | null>(null);
  const { state, pending, conflicts } = indicator;
  const status =
    state === 'ERROR'
      ? conflicts > 0
        ? `${conflicts} action${conflicts > 1 ? 's' : ''} refusée${conflicts > 1 ? 's' : ''}`
        : 'Erreur de synchronisation'
      : state === 'PENDING'
        ? `${pending} opération${pending > 1 ? 's' : ''} en attente${online ? '' : ' · hors connexion'}`
        : null;
  return (
    <Panel>
      <View style={styles.syncRow}>
        <Feather name="refresh-cw" size={22} color={colors.muted} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir la synchronisation"
          onPress={() => router.push(href)}
          style={styles.syncText}
        >
          <Text style={styles.syncLabel}>Dernière synchronisation</Text>
          <Text
            style={[
              styles.syncValue,
              { color: state === 'SYNCED' ? colors.successText : colors.textDark },
            ]}
          >
            {syncing ? 'Synchronisation…' : lastSyncAt ? relativeTime(lastSyncAt) : 'jamais'}
          </Text>
          {status ? (
            <Text style={[styles.syncStatus, state === 'ERROR' && { color: colors.status.error }]}>
              {status}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Synchroniser"
          accessibilityState={{ disabled: syncing, busy: syncing }}
          disabled={syncing}
          onPress={() => {
            setFailure(null);
            void syncNow().catch((e: unknown) =>
              setFailure(e instanceof Error ? e.message : 'Synchronisation impossible.'),
            );
          }}
          style={({ pressed }) => [styles.syncButton, (pressed || syncing) && { opacity: 0.7 }]}
        >
          {syncing ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.syncButtonText}>Synchroniser</Text>
          )}
        </Pressable>
      </View>
      {failure ? <Text style={styles.failure}>{failure}</Text> : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  greeting: { gap: 4 },
  hello: { fontSize: 26, fontWeight: '700', color: colors.primary },
  greetingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  subtitle: { fontSize: 15, fontWeight: '600', color: colors.deepBlue },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  badgeOn: { borderColor: colors.border, backgroundColor: colors.background },
  badgeOff: { borderColor: colors.status.pending, backgroundColor: colors.background },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 13, fontWeight: '700' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  syncText: { flex: 1, gap: 2 },
  syncLabel: { fontSize: 14, color: colors.muted },
  syncValue: { fontSize: 15, fontWeight: '700' },
  syncStatus: { fontSize: 13, fontWeight: '600', color: colors.textDark },
  syncButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  syncButtonText: { color: colors.background, fontWeight: '700', fontSize: 15 },
  failure: { fontSize: 14, color: colors.status.error },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 54,
    borderRadius: radius.md,
    paddingHorizontal: 16,
  },
  actionText: { fontSize: 16, fontWeight: '700', color: colors.background },
});
