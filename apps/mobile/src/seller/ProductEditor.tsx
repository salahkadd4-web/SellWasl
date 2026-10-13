import { colors, radius } from '@sellwasl/config';
import type { VisitCatalog } from '@sellwasl/validation';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ConfirmCancel, parseQty, QuantityField } from '@/components/QuantityStepper';
import { Message, PrimaryButton } from '@/ui';
import type { CartEntry } from './cart';

type CatalogProduct = VisitCatalog['products'][number];

/**
 * Zone de quantité d'un produit (UC-14, BR-CAT-16, refonte mobile), ouverte sous sa ligne par
 * glissement ou appui : l'unité, puis [−] [quantité] [+] par parfum ; ✓ met le panier à jour,
 * ✕ annule la saisie sans toucher au panier. Un parfum dont le quota est atteint reste
 * sélectionnable : sa quantité partira en attente (BR-QUO-03).
 * Cash van (`truckStock`) : le stock du camion est affiché, un quota atteint interdit la vente
 * (BR-QUO-04) et le vendeur peut noter une demande perdue.
 */
export function ProductEditor({
  product,
  initial,
  onDone,
  onCancel,
  onRemove,
  truckStock,
  onLostDemand,
}: {
  product: CatalogProduct;
  initial?: CartEntry;
  onDone: (entry: CartEntry) => void;
  onCancel: () => void;
  /** Produit déjà au panier : le retirer, action distincte de ✕. */
  onRemove?: () => void;
  truckStock?: Record<string, number>;
  /** Quantité en unité de base ; renvoie un message d'erreur, ou null. */
  onLostDemand?: (variantId: string, baseQty: number) => Promise<string | null>;
}) {
  const [unitId, setUnitId] = useState(initial?.unitId ?? product.units[0]!.id);
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(
      product.variants.map((v) => [v.id, String(initial?.qtyByVariant[v.id] ?? 0)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<Record<string, boolean>>({});
  const unit = product.units.find((u) => u.id === unitId) ?? product.units[0]!;
  const baseUnit = product.units.find((u) => u.baseQty === 1)?.name ?? 'unités';

  async function lostDemand(variantId: string) {
    const qty = parseQty(qtys[variantId] ?? '');
    if (qty === null || qty <= 0) return setError('Saisissez la quantité demandée par le client.');
    setError(null);
    const failure = await onLostDemand!(variantId, qty * unit.baseQty);
    if (failure) return setError(failure);
    setLost((current) => ({ ...current, [variantId]: true }));
    setQtys((current) => ({ ...current, [variantId]: '0' }));
  }

  function done() {
    const qtyByVariant: Record<string, number> = {};
    for (const [id, text] of Object.entries(qtys)) {
      const qty = parseQty(text);
      if (qty === null) return setError('Saisissez des quantités entières.');
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
    if (Object.keys(qtyByVariant).length === 0)
      return setError(
        initial
          ? 'Quantité nulle : retirez plutôt le produit du panier.'
          : 'Saisissez une quantité.',
      );
    onDone({ productId: product.id, unitId, qtyByVariant });
  }

  return (
    <View style={styles.editor}>
      {product.units.length > 1 ? (
        <View style={styles.units} accessibilityRole="radiogroup">
          {product.units.map((u) => {
            const active = u.id === unitId;
            return (
              <Pressable
                key={u.id}
                accessibilityRole="button"
                accessibilityLabel={u.name}
                accessibilityState={{ selected: active }}
                onPress={() => setUnitId(u.id)}
                style={[styles.unit, active && styles.unitActive]}
              >
                <Text style={[styles.unitText, active && styles.unitTextActive]}>{u.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.muted}>Unité : {product.units[0]!.name}</Text>
      )}
      {product.variants.map((v) => (
        <View key={v.id} style={styles.variant}>
          <QuantityField
            label={product.hasFlavors ? v.name : 'Quantité'}
            value={qtys[v.id] ?? '0'}
            onChange={(text) => setQtys((current) => ({ ...current, [v.id]: text }))}
            hint={
              [
                truckStock ? `Camion : ${truckStock[v.id] ?? 0} ${baseUnit}` : null,
                v.quotaReached
                  ? truckStock
                    ? 'Quota atteint : vente impossible'
                    : 'Quota atteint : partira en attente'
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          />
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
      <View style={styles.footer}>
        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retirer du panier"
            onPress={onRemove}
            style={styles.remove}
          >
            <Text style={styles.removeText}>Retirer du panier</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <ConfirmCancel
          onConfirm={done}
          onCancel={onCancel}
          confirmLabel="Ajouter au panier"
          cancelLabel="Annuler la saisie"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    gap: 12,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  units: { flexDirection: 'row', gap: 8 },
  unit: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  unitActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitText: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  unitTextActive: { color: colors.background },
  variant: { gap: 6 },
  muted: { fontSize: 14, color: colors.muted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  remove: { minHeight: 48, justifyContent: 'center' },
  removeText: { fontSize: 15, fontWeight: '600', color: colors.status.error },
});
