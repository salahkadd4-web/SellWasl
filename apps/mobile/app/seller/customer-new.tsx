import type { LatLng } from '@sellwasl/business-rules';
import { colors } from '@sellwasl/config';
import type { Frequency, TerritoryDto } from '@sellwasl/validation';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { readPosition } from '@/location/useLocation';
import { errorMessage, FREQUENCY_LABELS } from '@/seller/format';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';

const FREQUENCIES: Frequency[] = ['WEEKLY', 'BIWEEKLY', 'EVERY_4_WEEKS'];

/** Choix parmi quelques valeurs : l'option retenue en plein. */
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choices}>
      <Text style={styles.label}>{label}</Text>
      {options.map((o) => (
        <PrimaryButton
          key={o.value}
          title={o.label}
          variant={o.value === value ? 'primary' : 'secondary'}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

/** Nouveau client créé par le vendeur (UC-12, BR-CLI-02, BR-CLI-03). */
export default function NewCustomerScreen() {
  const router = useRouter();
  const { today, act } = useToday();
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>('WEEKLY');
  const [position, setPosition] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Types de clients servis par le secteur du vendeur (BR-CLI-02)
  useEffect(() => {
    const territoryId = today?.day.territory?.id;
    if (!territoryId) return;
    void request<TerritoryDto[]>('/territories')
      .then((list) => {
        const served = list.find((t) => t.id === territoryId)?.customerTypes ?? [];
        setTypes(served);
        if (served.length === 1) setTypeId(served[0]!.id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [today?.day.territory?.id]);

  async function locate() {
    setLocating(true);
    setError(null);
    const { granted } = await Location.requestForegroundPermissionsAsync().catch(() => ({
      granted: false,
    }));
    if (!granted) setError('Autorisez la localisation pour enregistrer la position du client.');
    else {
      // Position précise devant le magasin ; la dernière connue en secours
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((p) => ({ latitude: p.coords.latitude, longitude: p.coords.longitude }))
        .catch(() => readPosition());
      if (fix) setPosition(fix);
      else setError('Position introuvable. Réessayez à découvert.');
    }
    setLocating(false);
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Saisissez le nom du client.');
    if (!typeId) return setError('Choisissez le type de client.');
    if (!position) return setError('Prenez la position GPS du client.');
    setBusy(true);
    try {
      const customerId = newId();
      const result = await act<{ customerId: string; partName: string | null; outOfPart: boolean }>(
        'customer.create',
        {
          customerId,
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          customerTypeId: typeId,
          latitude: position.latitude,
          longitude: position.longitude,
          frequency,
        },
      );
      if (result.outOfPart)
        Alert.alert(
          'Client hors partie',
          'Sa position est en dehors des parties de votre secteur. Vous pouvez le visiter ; votre superviseur le placera.',
        );
      // Après une réponse perdue, c'est le client du premier essai qui a été créé
      router.replace(`/seller/customer/${result.customerId ?? customerId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle="Le client est actif tout de suite et marqué « nouveau ».">
        Nouveau client
      </Title>
      <WorkdayGuard>
        <Input label="Nom" value={name} onChangeText={setName} autoCapitalize="words" />
        <Input label="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Input label="Adresse" value={address} onChangeText={setAddress} />
        <Choices
          label="Type de client"
          value={typeId}
          onChange={setTypeId}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Choices
          label="Fréquence de visite"
          value={frequency}
          onChange={setFrequency}
          options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f]! }))}
        />
        <Card title="Position GPS">
          <Text style={styles.muted}>
            {position
              ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`
              : 'Pas encore prise : placez-vous devant le magasin.'}
          </Text>
          <PrimaryButton
            title={position ? 'Reprendre la position' : 'Prendre la position'}
            variant="secondary"
            onPress={() => void locate()}
            busy={locating}
          />
        </Card>
        {error ? <Message>{error}</Message> : null}
        <PrimaryButton title="Enregistrer le client" onPress={() => void save()} busy={busy} />
      </WorkdayGuard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: 8 },
  label: { fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 15, color: colors.muted },
});
