import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';
import { useNotificationTaps } from '@/notifications/push';
import { SyncProvider } from '@/offline/SyncProvider';
import { TodayProvider } from '@/today/TodayContext';

/** Écrans du pré-vendeur et du vendeur cash van (phase 15), autour de leur journée, hors connexion (phase 23). */
export default function SellerLayout() {
  // Toucher une notification ouvre l'écran des notifications (phase 24)
  useNotificationTaps('/seller/notifications');
  return (
    <SyncProvider>
      <TodayProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.background,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'SellWasl' }} />
          <Stack.Screen name="close" options={{ title: 'Clôturer la journée' }} />
          <Stack.Screen name="customers" options={{ title: 'Clients' }} />
          <Stack.Screen name="customer/[id]" options={{ title: 'Fiche client' }} />
          <Stack.Screen name="customer-new" options={{ title: 'Ajouter un client' }} />
          <Stack.Screen name="visit/[customerId]" options={{ title: 'Visite' }} />
          <Stack.Screen name="debt/[customerId]" options={{ title: 'Encaisser une dette' }} />
          <Stack.Screen name="order/[visitId]" options={{ title: 'Commande' }} />
          <Stack.Screen name="orders" options={{ title: 'Commandes du jour' }} />
          <Stack.Screen name="orders/[id]" options={{ title: 'Commande' }} />
          <Stack.Screen name="objectives" options={{ title: 'Objectifs' }} />
          <Stack.Screen name="catalog" options={{ title: 'Catalogue' }} />
          <Stack.Screen name="truck-check" options={{ title: 'Pointer le camion' }} />
          <Stack.Screen name="truck" options={{ title: 'Stock du camion' }} />
          <Stack.Screen name="receipts" options={{ title: 'Bons du jour' }} />
          <Stack.Screen name="refusals" options={{ title: 'Refus de mes commandes' }} />
          <Stack.Screen name="pay" options={{ title: 'Ma paie' }} />
          <Stack.Screen name="profile" options={{ title: 'Profil' }} />
          <Stack.Screen name="sync" options={{ title: 'Synchronisation' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        </Stack>
      </TodayProvider>
    </SyncProvider>
  );
}
