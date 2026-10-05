import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';

/** Écrans du magasinier (phase 18), en ligne : chaque action part tout de suite au serveur. */
export default function WarehouseLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.background,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'SellWasl' }} />
      <Stack.Screen name="preparations" options={{ title: 'Préparations' }} />
      <Stack.Screen name="preparation/[id]" options={{ title: 'Préparer la tournée' }} />
      <Stack.Screen name="loads" options={{ title: 'Chargements' }} />
      <Stack.Screen name="load-new" options={{ title: 'Charger un camion' }} />
      <Stack.Screen name="load-validate/[id]" options={{ title: 'Valider le chargement' }} />
      <Stack.Screen name="receipt" options={{ title: 'Entrée au dépôt' }} />
      <Stack.Screen name="unloads" options={{ title: 'Déchargements' }} />
      <Stack.Screen name="unload/[workdayId]" options={{ title: 'Décharger le camion' }} />
      <Stack.Screen name="inventory" options={{ title: 'Inventaire' }} />
      <Stack.Screen name="stock" options={{ title: 'Stock' }} />
      <Stack.Screen name="sync" options={{ title: 'Synchronisation' }} />
      <Stack.Screen name="profile" options={{ title: 'Profil' }} />
    </Stack>
  );
}
