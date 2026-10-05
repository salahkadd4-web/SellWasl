import { colors } from '@sellwasl/config';
import type { TruckStockDto } from '@sellwasl/validation';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Message } from '@/ui';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Stock du camion (livreur, vendeur cash van), en unité de base : ce qu'il peut livrer ou ajouter à une commande.
 * Ce qui reste en fin de journée revient au dépôt au déchargement : c'est le retour.
 */
export function TruckStockList() {
  const [stock, setStock] = useState<TruckStockDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Relu au retour d'une livraison
  useFocusEffect(
    useCallback(() => {
      void request<TruckStockDto[]>('/me/truck-stock')
        .then((list) => {
          setStock(list);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, []),
  );

  return (
    <FlatList
      data={stock ?? []}
      keyExtractor={(s) => s.variantId}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Message tone="info">
            Ce qui reste dans le camion en fin de journée revient au dépôt : c'est le retour.
          </Message>
          {error ? <Message>{error}</Message> : null}
          {!stock && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      ListEmptyComponent={stock ? <Message tone="info">Le camion est vide.</Message> : null}
      renderItem={({ item }) => {
        const carton = [...item.units].sort((a, b) => b.baseQty - a.baseQty)[0];
        return (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{label(item)}</Text>
              {carton && carton.baseQty > 1 ? (
                <Text style={styles.muted}>
                  {Math.floor(item.qty / carton.baseQty)} {carton.name} et{' '}
                  {item.qty % carton.baseQty} à l'unité
                </Text>
              ) : null}
            </View>
            <Text style={styles.amount}>{item.qty}</Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 16, backgroundColor: colors.background },
  header: { gap: 8 },
  separator: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  amount: { fontSize: 16, fontWeight: '700', color: colors.textDark },
});
