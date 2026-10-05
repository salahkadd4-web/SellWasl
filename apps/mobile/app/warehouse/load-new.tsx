import { colors } from '@sellwasl/config';
import type { LoadDto, ProductDto, StockRowDto } from '@sellwasl/validation';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { phoneDate } from '@/today/TodayContext';
import { Card, Message, PrimaryButton, Screen, Title } from '@/ui';
import { type LineValue, LinesEditor, toLines } from '@/warehouse/LinesEditor';
import { useWarehouses } from '@/warehouse/warehouses';

/** Chargement libre d'un camion (UC-42) : pris sur le disponible du dépôt principal. */
export default function NewLoadScreen() {
  const router = useRouter();
  const { warehouses, error: warehousesError } = useWarehouses();
  const trucks = warehouses.filter((w) => w.type === 'TRUCK' && w.assignedUser);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [available, setAvailable] = useState<Map<string, number>>(new Map());
  const [values, setValues] = useState<Record<string, LineValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      request<ProductDto[]>('/products?status=ACTIVE'),
      request<StockRowDto[]>('/stock'),
    ])
      .then(([p, stock]) => {
        setProducts(p);
        setAvailable(new Map(stock.map((s) => [s.variantId, s.available])));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function submit() {
    const lines = toLines(values);
    if (!truckId) return setError('Choisissez le camion.');
    if (!lines) return setError('Les quantités doivent être des nombres entiers.');
    if (lines.length === 0) return setError('Saisissez au moins une quantité.');
    setError(null);
    setBusy(true);
    try {
      const created = await request<LoadDto>('/loads', {
        method: 'POST',
        body: JSON.stringify({ truckId, date: phoneDate(), lines }),
      });
      Alert.alert('Camion chargé', `${created.truck.code} : ${created.lines.length} article(s).`);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle="Le stock réservé par les commandes reste au dépôt.">Charger un camion</Title>
      {warehousesError ? <Message>{warehousesError}</Message> : null}
      <Card title="Camion">
        {trucks.length === 0 ? (
          <Text style={styles.muted}>Aucun camion n'a de conducteur.</Text>
        ) : null}
        <View style={styles.chips}>
          {trucks.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTruckId(t.id)}
              style={[styles.chip, truckId === t.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, truckId === t.id && styles.chipTextActive]}>
                {t.code} · {t.assignedUser!.firstName}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <LinesEditor products={products} values={values} onChange={setValues} available={available} />
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Valider le chargement" busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 14, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDark, fontWeight: '600' },
  chipTextActive: { color: colors.background },
});
