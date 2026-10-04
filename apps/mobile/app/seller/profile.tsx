import { colors } from '@sellwasl/config';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { syncCatalogPhotos, usePhotoSyncState } from '@/catalog/photos';
import { Card, PrimaryButton, Screen, Title } from '@/ui';

/** Profil du vendeur : identité, téléphone, photos du catalogue, imprimante, déconnexion. */
export default function ProfileScreen() {
  const router = useRouter();
  const { me, profile, offline, logout } = useAuth();
  const photos = usePhotoSyncState();

  return (
    <Screen>
      <Title subtitle={me?.role.name ?? profile?.roleName}>
        {me
          ? `${me.user.firstName} ${me.user.lastName}`
          : `${profile?.firstName} ${profile?.lastName}`}
      </Title>
      <Card>
        <Text style={styles.line}>Code : {me?.user.code ?? profile?.userCode}</Text>
        <Text style={styles.line}>Entreprise : {me?.company.name ?? profile?.companyName}</Text>
        <Text style={styles.line}>Série du téléphone : {profile?.series}</Text>
        <Text style={offline ? styles.offline : styles.online}>
          {offline ? 'Hors connexion' : 'En ligne'}
        </Text>
      </Card>
      <Card title="Photos du catalogue">
        <Text style={styles.muted}>
          {photos.total === 0
            ? 'Aucune photo gardée sur le téléphone'
            : `${photos.ready} / ${photos.total} gardées sur le téléphone`}
        </Text>
        <PrimaryButton
          title="Mettre à jour les photos"
          variant="secondary"
          busy={photos.running}
          onPress={() => void syncCatalogPhotos()}
        />
      </Card>
      <PrimaryButton
        title="Tester l'imprimante"
        variant="secondary"
        onPress={() => router.push('/printer-test')}
      />
      <PrimaryButton
        title="Déconnexion"
        variant="secondary"
        onPress={() =>
          Alert.alert('Se déconnecter ?', 'Il faudra saisir de nouveau votre mot de passe.', [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Déconnexion', style: 'destructive', onPress: () => void logout() },
          ])
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 15, color: colors.textDark },
  muted: { fontSize: 15, color: colors.muted },
  online: { fontSize: 15, fontWeight: '600', color: colors.status.synced },
  offline: { fontSize: 15, fontWeight: '600', color: colors.status.error },
});
