import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';
import { useNotificationTaps } from '@/notifications/push';
import { SyncProvider } from '@/offline/SyncProvider';

/** Écrans du livreur (phase 19) : journée, chargement, tournée, livraisons, hors connexion (phase 23). */
export default function DriverLayout() {
  // Toucher une notification ouvre l'écran des notifications (phase 24)
  useNotificationTaps('/driver/notifications');
  return (
    <SyncProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.background,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* Accueil, Tournée, Bons du jour, Map : onglets (refonte mobile) */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="receive" options={{ title: 'Pointer le camion' }} />
        <Stack.Screen name="truck" options={{ title: 'Stock du camion' }} />
        <Stack.Screen name="delivery/[orderId]" options={{ title: 'Livraison' }} />
        <Stack.Screen name="objectives" options={{ title: 'Objectifs' }} />
        <Stack.Screen name="pay" options={{ title: 'Ma paie' }} />
        <Stack.Screen name="profile" options={{ title: 'Profil' }} />
        <Stack.Screen name="sync" options={{ title: 'Synchronisation' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      </Stack>
    </SyncProvider>
  );
}
