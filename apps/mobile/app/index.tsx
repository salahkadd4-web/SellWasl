import { colors } from '@sellwasl/config';
import { View } from 'react-native';

/** Écran de démarrage, caché par l'animation du logo : AuthGate redirige dès que l'état du téléphone est connu. */
export default function StartScreen() {
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
