import { colors } from '@sellwasl/config';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.background,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'SellWasl' }} />
        <Stack.Screen name="printer-test" options={{ title: "Test d'impression" }} />
      </Stack>
    </>
  );
}
