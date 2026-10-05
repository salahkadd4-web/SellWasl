import { colors } from '@sellwasl/config';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { fetchHealth } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';

type State =
  { kind: 'loading' } | { kind: 'ok'; time: string } | { kind: 'error'; message: string };

/**
 * Synchronisation du magasinier : l'appli est en ligne, chaque action part tout de suite au
 * serveur ; cet écran vérifie la connexion (hors connexion : phase 23).
 */
export default function SyncScreen() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const check = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const health = await fetchHealth();
      setState({ kind: 'ok', time: health.time });
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Screen>
      <Title subtitle="Les actions du magasinier sont envoyées tout de suite au serveur.">
        Synchronisation
      </Title>
      <Card title="Serveur">
        {state.kind === 'loading' ? <Text style={styles.muted}>Vérification…</Text> : null}
        {state.kind === 'ok' ? <Text style={styles.ok}>Connecté : rien en attente</Text> : null}
        {state.kind === 'error' ? <Message>{state.message}</Message> : null}
      </Card>
      <PrimaryButton
        title="Vérifier de nouveau"
        variant="secondary"
        busy={state.kind === 'loading'}
        onPress={() => void check()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 15, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.status.synced },
});
