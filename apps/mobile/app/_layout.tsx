import { colors } from '@sellwasl/config';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { SplashIntro } from '@/splash/SplashIntro';

/** L'écran natif reste affiché jusqu'à ce que SplashIntro prenne le relais. */
void SplashScreen.preventAutoHideAsync();

/** Écrans accessibles dans chaque état du téléphone ; le premier est l'écran par défaut. */
const SCREENS_BY_STATUS = {
  needsActivation: ['activation', 'scan'],
  loggedOut: ['login'],
  mustChangePassword: ['change-password'],
  loggedIn: ['home', 'printer-test'],
} as const;

/** Le pré-vendeur et le vendeur cash van ont leurs écrans (phase 15) ; les autres, l'accueil. */
const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];
const SELLER_SCREENS = ['seller', 'printer-test'] as const;
/** Le magasinier a ses écrans (phase 18), le livreur aussi (phase 19). */
const WAREHOUSE_SCREENS = ['warehouse'] as const;
const DRIVER_SCREENS = ['driver'] as const;

function AuthGate() {
  const { status, me, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const roleCode = me?.role.code ?? profile?.roleCode ?? '';
  const isSeller = SELLER_ROLES.includes(roleCode);
  const isStorekeeper = roleCode === 'MAGASINIER';
  const isDriver = roleCode === 'LIVREUR';

  useEffect(() => {
    if (status === 'loading') return;
    const allowed: readonly string[] =
      status === 'loggedIn' && isSeller
        ? SELLER_SCREENS
        : status === 'loggedIn' && isStorekeeper
          ? WAREHOUSE_SCREENS
          : status === 'loggedIn' && isDriver
            ? DRIVER_SCREENS
            : SCREENS_BY_STATUS[status];
    const current = segments[0] ?? 'index';
    if (!allowed.includes(current)) router.replace(`/${allowed[0]}`);
  }, [status, isSeller, isStorekeeper, isDriver, segments, router]);

  return null;
}

/** L'animation couvre la navigation : AuthGate redirige en dessous pendant qu'elle se joue. */
function Intro() {
  const { status } = useAuth();
  return <SplashIntro ready={status !== 'loading'} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthGate />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.background,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="activation" options={{ title: 'Associer ce téléphone' }} />
        <Stack.Screen name="scan" options={{ title: 'Scanner le QR code' }} />
        <Stack.Screen name="login" options={{ title: 'Connexion' }} />
        <Stack.Screen
          name="change-password"
          options={{ title: 'Nouveau mot de passe', headerBackVisible: false }}
        />
        <Stack.Screen name="home" options={{ title: 'SellWasl' }} />
        <Stack.Screen name="seller" options={{ headerShown: false }} />
        <Stack.Screen name="warehouse" options={{ headerShown: false }} />
        <Stack.Screen name="driver" options={{ headerShown: false }} />
        <Stack.Screen name="printer-test" options={{ title: "Test d'impression" }} />
      </Stack>
      <Intro />
    </AuthProvider>
  );
}
