import { colors } from '@sellwasl/config';
import type { VisitCatalog } from '@sellwasl/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Input, Message, PrimaryButton } from '@/ui';
import type { CartEntry } from './cart';

type CatalogProduct = VisitCatalog['products'][number];

/**
 * Saisie d'un produit (UC-14, BR-CAT-16) : l'unité, puis une quantité par parfum. Un parfum dont
 * le quota est atteint reste sélectionnable : sa quantité partira en attente (BR-QUO-03).
 */
export function ProductSheet({
  product,
  initial,
  onDone,
  onCancel,
}: {
  product: CatalogProduct;
  initial?: CartEntry;
  onDone: (entry: CartEntry) => void;
  onCancel: () => void;
}) {
  const [unitId, setUnitId] = useState(initial?.unitId ?? product.units[0]!.id);
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initial?.qtyByVariant ?? {}).map(([id, qty]) => [id, String(qty)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  function done() {
    const qtyByVariant: Record<string, number> = {};
    for (const [id, text] of Object.entries(qtys)) {
      const qty = Number(text.replace(/\s/g, '') || '0');
      if (!Number.isInteger(qty) || qty < 0) return setError('Saisissez des quantités entières.');
      if (qty > 0) qtyByVariant[id] = qty;
    }
    if (Object.keys(qtyByVariant).length === 0) return setError('Saisissez au moins une quantité.');
    onDone({ productId: product.id, unitId, qtyByVariant });
  }

  return (
    <Card title={product.name}>
      {product.units.length > 1 ? (
        <View style={styles.units}>
          {product.units.map((u) => (
            <View key={u.id} style={styles.unit}>
              <PrimaryButton
                title={u.name}
                variant={u.id === unitId ? 'primary' : 'secondary'}
                onPress={() => setUnitId(u.id)}
              />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>Unité : {product.units[0]!.name}</Text>
      )}
      {product.variants.map((v) => (
        <View key={v.id} style={styles.variant}>
          <Input
            label={product.hasFlavors ? v.name : 'Quantité'}
            value={qtys[v.id] ?? ''}
            onChangeText={(text) => setQtys((current) => ({ ...current, [v.id]: text }))}
            keyboardType="number-pad"
          />
          {v.quotaReached ? (
            <Text style={styles.quota}>Quota atteint : la quantité partira en attente.</Text>
          ) : null}
        </View>
      ))}
      {error ? <Message>{error}</Message> : null}
      <PrimaryButton title="Ajouter au panier" onPress={done} />
      <PrimaryButton title="Annuler" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  units: { flexDirection: 'row', gap: 8 },
  unit: { flex: 1 },
  variant: { gap: 4 },
  muted: { fontSize: 15, color: colors.muted },
  quota: { fontSize: 14, fontWeight: '600', color: colors.status.error },
});
