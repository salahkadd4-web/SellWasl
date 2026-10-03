import { normalizeActivationCode } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ApiClientError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Input, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Association du téléphone (UC-01, ARC-04) : QR code ou code de secours, puis mot de passe. */
export default function ActivationScreen() {
  const { activate, notice } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.code) setCode(formatCode(params.code));
  }, [params.code]);

  async function submit() {
    setError(null);
    if (normalizeActivationCode(code).length !== 8) return setError('Le code fait 8 caractères.');
    if (!password) return setError('Saisissez votre mot de passe.');
    setBusy(true);
    try {
      await activate(normalizeActivationCode(code), password);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Association impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle="Demandez à votre superviseur d'afficher le QR code d'association sur le Web.">
        Bienvenue
      </Title>
      {notice ? <Message>{notice}</Message> : null}
      <PrimaryButton title="Scanner le QR code" onPress={() => router.push('/scan')} />
      <Input
        label="Ou saisissez le code"
        value={code}
        onChangeText={(t) => setCode(formatCode(t))}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
        maxLength={9}
      />
      <Input
        label="Votre mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton
        title="Associer ce téléphone"
        onPress={() => void submit()}
        busy={busy}
        variant="secondary"
      />
    </Screen>
  );
}

function formatCode(raw: string): string {
  const c = normalizeActivationCode(raw).slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
