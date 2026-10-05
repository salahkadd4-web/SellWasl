import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';

/** Écrans du livreur (phase 19) : journée, chargement, tournée, livraisons. */
export default function DriverLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.background,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'SellWasl' }} />
      <Stack.Screen name="receive" options={{ title: 'Réception du chargement' }} />
      <Stack.Screen name="route" options={{ title: 'Ma tournée' }} />
      <Stack.Screen name="truck" options={{ title: 'Stock du camion' }} />
      <Stack.Screen name="delivery/[orderId]" options={{ title: 'Livraison' }} />
      <Stack.Screen name="objectives" options={{ title: 'Objectifs' }} />
      <Stack.Screen name="profile" options={{ title: 'Profil' }} />
    </Stack>
  );
}
