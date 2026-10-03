import { useState } from 'react';
import { ApiClientError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Input, Message, PrimaryButton, Screen, Title } from '@/ui';

/** Premier accès avec un mot de passe provisoire (UC-80) : il doit être changé avant tout. */
export default function ChangePasswordScreen() {
  const { me, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!current) return setError('Saisissez le mot de passe provisoire.');
    if (next.length < 8)
      return setError('Le nouveau mot de passe doit faire au moins 8 caractères.');
    if (next !== confirm) return setError('Les deux nouveaux mots de passe sont différents.');
    if (next === current) return setError('Choisissez un mot de passe différent du provisoire.');
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle="Votre mot de passe actuel est provisoire. Choisissez le vôtre pour continuer.">
        {me ? `Bonjour ${me.user.firstName}` : 'Nouveau mot de passe'}
      </Title>
      <Input
        label="Mot de passe provisoire"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
      />
      <Input
        label="Nouveau mot de passe (8 caractères minimum)"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
      />
      <Input
        label="Confirmez le nouveau mot de passe"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
      />
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Enregistrer" onPress={() => void submit()} busy={busy} />
      <PrimaryButton title="Déconnexion" variant="secondary" onPress={() => void logout()} />
    </Screen>
  );
}
