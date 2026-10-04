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

function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const allowed: readonly string[] = SCREENS_BY_STATUS[status];
    const current = segments[0] ?? 'index';
    if (!allowed.includes(current)) router.replace(`/${allowed[0]}`);
  }, [status, segments, router]);

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
        <Stack.Screen name="printer-test" options={{ title: "Test d'impression" }} />
      </Stack>
      <Intro />
    </AuthProvider>
  );
}
