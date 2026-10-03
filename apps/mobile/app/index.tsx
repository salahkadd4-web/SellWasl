import { colors } from '@sellwasl/config';
import { ActivityIndicator, View } from 'react-native';

/** Écran de démarrage : AuthGate redirige dès que l'état du téléphone est connu. */
export default function StartScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
      }}
    >
      <ActivityIndicator color={colors.background} size="large" />
    </View>
  );
}
