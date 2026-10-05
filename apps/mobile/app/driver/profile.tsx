import { colors } from '@sellwasl/config';
import { Alert, StyleSheet, Text } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Card, PrimaryButton, Screen, Title } from '@/ui';

/** Profil du livreur : identité, téléphone, déconnexion. */
export default function ProfileScreen() {
  const { me, profile, offline, logout } = useAuth();

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
  online: { fontSize: 15, fontWeight: '600', color: colors.status.synced },
  offline: { fontSize: 15, fontWeight: '600', color: colors.status.error },
});
