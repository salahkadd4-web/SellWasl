import { colors } from '@sellwasl/config';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';

/** Écrans accessibles dans chaque état du téléphone ; le premier est l'écran par défaut. */
const SCREENS_BY_STATUS = {
  needsActivation: ['activation', 'scan'],
  loggedOut: ['login'],
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
        <Stack.Screen name="home" options={{ title: 'SellWasl' }} />
        <Stack.Screen name="printer-test" options={{ title: "Test d'impression" }} />
      </Stack>
    </AuthProvider>
  );
}
