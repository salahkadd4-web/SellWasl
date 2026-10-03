import { colors } from '@sellwasl/config';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchHealth } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

type ApiState =
  { kind: 'loading' } | { kind: 'ok'; time: string } | { kind: 'error'; message: string };

export default function HomeScreen() {
  const { me, profile, logout } = useAuth();
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });

  const check = useCallback(async () => {
    setApi({ kind: 'loading' });
    try {
      const health = await fetchHealth();
      setApi({ kind: 'ok', time: health.time });
    } catch (error) {
      setApi({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bonjour {me?.user.firstName}</Text>
      <Text style={styles.slogan}>
        {me?.role.name} · {me?.company.name}
        {profile ? ` · téléphone ${profile.series}` : ''}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Serveur</Text>
        {api.kind === 'loading' && <Text style={styles.muted}>Vérification…</Text>}
        {api.kind === 'ok' && <Text style={{ color: colors.status.synced }}>Connecté</Text>}
        {api.kind === 'error' && <Text style={{ color: colors.status.error }}>{api.message}</Text>}
        <Pressable style={styles.secondary} onPress={() => void check()}>
          <Text style={styles.secondaryText}>Réessayer</Text>
        </Pressable>
      </View>

      <Link href="/printer-test" asChild>
        <Pressable style={styles.primary}>
          <Text style={styles.primaryText}>Tester l'imprimante</Text>
        </Pressable>
      </Link>

      <Pressable style={styles.outline} onPress={() => void logout()}>
        <Text style={styles.outlineText}>Déconnexion</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  slogan: { color: colors.muted, textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    backgroundColor: colors.surface,
  },
  label: { fontWeight: '600', color: colors.textDark },
  muted: { color: colors.muted },
  primary: { backgroundColor: colors.primary, borderRadius: 10, padding: 16, alignItems: 'center' },
  primaryText: { color: colors.background, fontWeight: '700', fontSize: 16 },
  outline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  outlineText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  secondary: { alignSelf: 'flex-start', paddingVertical: 8 },
  secondaryText: { color: colors.deepBlue, fontWeight: '600' },
});
