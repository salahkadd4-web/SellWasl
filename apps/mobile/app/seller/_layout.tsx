import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';
import { TodayProvider } from '@/today/TodayContext';

/** Écrans du pré-vendeur et du vendeur cash van (phase 15), autour de leur journée. */
export default function SellerLayout() {
  return (
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
        <Stack.Screen name="objectives" options={{ title: 'Objectifs' }} />
        <Stack.Screen name="catalog" options={{ title: 'Catalogue' }} />
        <Stack.Screen name="profile" options={{ title: 'Profil' }} />
      </Stack>
    </TodayProvider>
  );
}
