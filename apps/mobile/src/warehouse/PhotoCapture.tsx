import { colors } from '@sellwasl/config';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Message, PrimaryButton } from '@/ui';

/**
 * Photo d'un produit défectueux au déchargement (phase 21) : prise à l'appareil, envoyée tout de
 * suite ; renvoie la clé de la photo enregistrée.
 */
export function PhotoCapture({
  photoKey,
  onTaken,
}: {
  photoKey: string | null;
  onTaken: (key: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take() {
    setError(null);
    setBusy(true);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.5 });
      if (!picture) return;
      const form = new FormData();
      // React Native envoie le fichier à partir de son adresse locale
      form.append('file', {
        uri: picture.uri,
        name: 'defectueux.jpg',
        type: 'image/jpeg',
      } as never);
      const saved = await request<{ key: string }>('/unloads/photos', {
        method: 'POST',
        body: form,
      });
      onTaken(saved.key);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <View style={styles.box}>
        <Text style={photoKey ? styles.ok : styles.muted}>
          {photoKey ? 'Photo du défectueux envoyée.' : 'Photo du défectueux obligatoire.'}
        </Text>
        <PrimaryButton
          title={photoKey ? 'Reprendre la photo' : 'Prendre la photo'}
          variant="secondary"
          onPress={() => (permission?.granted ? setOpen(true) : void requestPermission())}
        />
        {permission && !permission.granted ? (
          <Message tone="info">Autorisez la caméra pour photographier le produit.</Message>
        ) : null}
      </View>
    );

  return (
    <View style={styles.box}>
      <CameraView ref={camera} style={styles.camera} />
      <PrimaryButton title="Photographier" busy={busy} onPress={() => void take()} />
      <PrimaryButton title="Annuler" variant="secondary" onPress={() => setOpen(false)} />
      {error ? <Message>{error}</Message> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  camera: { height: 260, borderRadius: 12, overflow: 'hidden' },
  muted: { fontSize: 14, color: colors.muted },
  ok: { fontSize: 14, fontWeight: '600', color: colors.status.synced },
});
