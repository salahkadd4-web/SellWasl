import { colors } from '@sellwasl/config';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchHealth } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { cachedPhotoUris, syncCatalogPhotos, usePhotoSyncState } from '@/catalog/photos';

type ApiState =
  { kind: 'loading' } | { kind: 'ok'; time: string } | { kind: 'error'; message: string };

export default function HomeScreen() {
  const { me, profile, offline, notice, logout } = useAuth();
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });
  const photos = usePhotoSyncState();

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Bonjour {me?.user.firstName ?? profile?.firstName}</Text>
      <Text style={styles.slogan}>
        {me?.role.name ?? profile?.roleName} · {me?.company.name ?? profile?.companyName}
        {profile ? ` · téléphone ${profile.series}` : ''}
      </Text>
      {offline ? <Text style={styles.offline}>{notice}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.label}>Serveur</Text>
        {api.kind === 'loading' && <Text style={styles.muted}>Vérification…</Text>}
        {api.kind === 'ok' && <Text style={{ color: colors.status.synced }}>Connecté</Text>}
        {api.kind === 'error' && <Text style={{ color: colors.status.error }}>{api.message}</Text>}
        <Pressable style={styles.secondary} onPress={() => void check()}>
          <Text style={styles.secondaryText}>Réessayer</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Photos du catalogue</Text>
        <Text style={styles.muted}>
          {photos.total === 0
            ? photos.running
              ? 'Recherche des photos…'
              : 'Aucune photo dans le catalogue'
            : `${photos.ready} / ${photos.total} gardées sur le téléphone${photos.running ? ' · téléchargement…' : ''}`}
        </Text>
        {photos.ready > 0 ? (
          <View style={styles.photos}>
            {cachedPhotoUris()
              .slice(0, 8)
              .map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.photo} />
              ))}
          </View>
        ) : null}
        {photos.lastError ? (
          <Text style={{ color: colors.status.pending }}>{photos.lastError}</Text>
        ) : null}
        <Pressable
          style={styles.secondary}
          disabled={photos.running}
          onPress={() => void syncCatalogPhotos()}
        >
          <Text style={styles.secondaryText}>Mettre à jour les photos</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16, gap: 16, justifyContent: 'center' },
  offline: {
    backgroundColor: colors.status.pending,
    color: colors.textDark,
    padding: 12,
    borderRadius: 10,
    textAlign: 'center',
    fontWeight: '600',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border },
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
