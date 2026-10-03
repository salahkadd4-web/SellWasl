import { useState } from 'react';
import { Alert } from 'react-native';
import { ApiClientError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Input, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Connexion sur le téléphone associé (BR-USR-06). */
export default function LoginScreen() {
  const { profile, login, forgetDevice, notice } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!password) return setError('Saisissez votre mot de passe.');
    setBusy(true);
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title
        subtitle={
          profile ? `${profile.userCode} · ${profile.roleName} · ${profile.companyName}` : undefined
        }
      >
        {profile ? `Bonjour ${profile.firstName}` : 'Connexion'}
      </Title>
      {notice ? <Message>{notice}</Message> : null}
      <Input
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoFocus
      />
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Se connecter" onPress={() => void submit()} busy={busy} />
      <PrimaryButton
        title="Ce n'est pas mon téléphone"
        variant="secondary"
        onPress={() =>
          Alert.alert(
            'Dissocier ce téléphone ?',
            'Il faudra un nouveau code d’association de votre superviseur.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Dissocier', style: 'destructive', onPress: () => void forgetDevice() },
            ],
          )
        }
      />
    </Screen>
  );
}
