import { Alert } from 'react-native';
import { unsentCount } from './engine';

/**
 * Déconnexion du terrain : refusée tant que des actions attendent l'envoi (spec phase 23 §5),
 * sinon confirmée comme avant.
 */
export async function confirmLogout(logout: () => Promise<void>): Promise<void> {
  const unsent = await unsentCount();
  if (unsent > 0) {
    Alert.alert(
      'Synchronisation nécessaire',
      `${unsent} action${unsent > 1 ? 's' : ''} pas encore envoyée${unsent > 1 ? 's' : ''} : synchronisez avant de vous déconnecter.`,
    );
    return;
  }
  Alert.alert('Se déconnecter ?', 'Il faudra saisir de nouveau votre mot de passe.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Déconnexion', style: 'destructive', onPress: () => void logout() },
  ]);
}
