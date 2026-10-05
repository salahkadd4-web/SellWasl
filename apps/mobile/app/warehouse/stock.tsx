import { colors } from '@sellwasl/config';
import type { StockRowDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { errorMessage } from '@/seller/format';
import { Message } from '@/ui';
import { useWarehouses } from '@/warehouse/warehouses';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/** Stock d'un entrepôt (BR-STK-02) : physique, réservé, disponible, en unité de base. */
export default function StockScreen() {
  const { warehouses, error: warehousesError } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rows, setRows] = useState<StockRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId && warehouses[0]) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) return;
    setRows(null);
    void request<StockRowDto[]>(`/stock?warehouseId=${warehouseId}`)
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [warehouseId]);

  return (
    <FlatList
      data={rows ?? []}
      keyExtractor={(r) => r.variantId}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.chips}>
            {warehouses.map((w) => (
              <Pressable
                key={w.id}
                onPress={() => setWarehouseId(w.id)}
                style={[styles.chip, warehouseId === w.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, warehouseId === w.id && styles.chipTextActive]}>
                  {w.code}
                </Text>
              </Pressable>
            ))}
          </View>
          {(error ?? warehousesError) ? <Message>{error ?? warehousesError}</Message> : null}
          {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{label(item)}</Text>
            <Text style={styles.muted}>
              Physique {item.physical} · réservé {item.reserved}
            </Text>
            {item.isLow ? <Text style={styles.low}>Sous le seuil ({item.lowStockQty})</Text> : null}
          </View>
          <Text style={styles.amount}>{item.available}</Text>
        </View>
      )}
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
  low: { fontSize: 14, fontWeight: '600', color: colors.status.error },
  amount: { fontSize: 16, fontWeight: '700', color: colors.textDark },
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
