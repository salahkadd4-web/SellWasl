import type { ProductDto, ReceiptDto } from '@sellwasl/validation';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';
import { type LineValue, LinesEditor, toLines } from '@/warehouse/LinesEditor';
import { useWarehouses } from '@/warehouse/warehouses';

/** Entrée au dépôt (UC-40) : marchandise reçue d'un fournisseur, dans le dépôt principal. */
export default function ReceiptScreen() {
  const router = useRouter();
  const { warehouses, error: warehousesError } = useWarehouses();
  const depot = warehouses.find((w) => w.type === 'DEPOT');
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [values, setValues] = useState<Record<string, LineValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<ProductDto[]>('/products?status=ACTIVE')
      .then(setProducts)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function submit() {
    const lines = toLines(values);
    if (!depot) return setError('Aucun dépôt actif.');
    if (!lines) return setError('Les quantités doivent être des nombres entiers.');
    if (lines.length === 0) return setError('Saisissez au moins une quantité.');
    setError(null);
    setBusy(true);
    try {
      const created = await request<ReceiptDto>('/stock/receipts', {
        method: 'POST',
        body: JSON.stringify({
          warehouseId: depot.id,
          supplier: supplier.trim() || undefined,
          reference: reference.trim() || undefined,
          lines,
        }),
      });
      Alert.alert('Entrée enregistrée', `${created.lines.length} article(s) entrés au dépôt.`);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title subtitle={depot ? `${depot.code} · ${depot.name}` : undefined}>Entrée au dépôt</Title>
      {warehousesError ? <Message>{warehousesError}</Message> : null}
      <Card>
        <Input label="Fournisseur" value={supplier} onChangeText={setSupplier} />
        <Input label="Référence du bon" value={reference} onChangeText={setReference} />
      </Card>
      <LinesEditor products={products} values={values} onChange={setValues} />
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Enregistrer l'entrée" busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}
