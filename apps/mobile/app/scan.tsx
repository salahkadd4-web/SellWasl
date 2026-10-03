import { colors } from '@sellwasl/config';
import { parseActivationQr } from '@sellwasl/validation';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Message, PrimaryButton, Screen } from '@/ui';

/** Lecture du QR code affiché par le superviseur. */
export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <Screen>
        <Message tone="info">L'application a besoin de la caméra pour lire le QR code.</Message>
        <PrimaryButton title="Autoriser la caméra" onPress={() => void requestPermission()} />
        <PrimaryButton
          title="Saisir le code à la main"
          variant="secondary"
          onPress={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          const code = parseActivationQr(data);
          if (!code || handled.current) return;
          handled.current = true;
          router.replace({ pathname: '/activation', params: { code } });
        }}
      />
      <View style={styles.hint}>
        <Text style={styles.hintText}>Visez le QR code affiché sur l'écran du superviseur</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute',
    bottom: 48,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0,24,80,0.85)',
  },
  hintText: { color: colors.background, textAlign: 'center', fontSize: 16 },
});
