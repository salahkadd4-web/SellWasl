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
 * Cash van (`truckStock`) : le stock du camion est affiché, un quota atteint interdit la vente
 * (BR-QUO-04) et le vendeur peut noter une demande perdue.
 */
export function ProductSheet({
  product,
  initial,
  onDone,
  onCancel,
  truckStock,
  onLostDemand,
}: {
  product: CatalogProduct;
  initial?: CartEntry;
  onDone: (entry: CartEntry) => void;
  onCancel: () => void;
  truckStock?: Record<string, number>;
  /** Quantité en unité de base ; renvoie un message d'erreur, ou null. */
  onLostDemand?: (variantId: string, baseQty: number) => Promise<string | null>;
}) {
  const [unitId, setUnitId] = useState(initial?.unitId ?? product.units[0]!.id);
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initial?.qtyByVariant ?? {}).map(([id, qty]) => [id, String(qty)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<Record<string, boolean>>({});
  const unit = product.units.find((u) => u.id === unitId) ?? product.units[0]!;
  const baseUnit = product.units.find((u) => u.baseQty === 1)?.name ?? 'unités';

  async function lostDemand(variantId: string) {
    const qty = Number((qtys[variantId] ?? '').replace(/\s/g, '') || '0');
    if (!Number.isInteger(qty) || qty <= 0)
      return setError('Saisissez la quantité demandée par le client.');
    setError(null);
    const failure = await onLostDemand!(variantId, qty * unit.baseQty);
    if (failure) return setError(failure);
    setLost((current) => ({ ...current, [variantId]: true }));
    setQtys((current) => ({ ...current, [variantId]: '' }));
  }

  function done() {
    const qtyByVariant: Record<string, number> = {};
    for (const [id, text] of Object.entries(qtys)) {
      const qty = Number(text.replace(/\s/g, '') || '0');
      if (!Number.isInteger(qty) || qty < 0) return setError('Saisissez des quantités entières.');
      if (qty > 0) qtyByVariant[id] = qty;
    }
    if (truckStock) {
      const blocked = product.variants.find((v) => qtyByVariant[v.id] && v.quotaReached);
      if (blocked) return setError('Quota atteint : notez plutôt une demande perdue.');
      const short = product.variants.find(
        (v) => (qtyByVariant[v.id] ?? 0) * unit.baseQty > (truckStock[v.id] ?? 0),
      );
      if (short) return setError("Le camion n'a pas cette quantité.");
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
          {truckStock ? (
            <Text style={(truckStock[v.id] ?? 0) > 0 ? styles.muted : styles.quota}>
              Dans le camion : {truckStock[v.id] ?? 0} {baseUnit}
            </Text>
          ) : null}
          {v.quotaReached ? (
            <Text style={styles.quota}>
              {truckStock
                ? 'Quota atteint : vente impossible.'
                : 'Quota atteint : la quantité partira en attente.'}
            </Text>
          ) : null}
          {onLostDemand && (v.quotaReached || (truckStock?.[v.id] ?? 0) === 0) ? (
            lost[v.id] ? (
              <Text style={styles.muted}>Demande perdue notée.</Text>
            ) : (
              <PrimaryButton
                title="Demande perdue"
                variant="secondary"
                onPress={() => void lostDemand(v.id)}
              />
            )
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
