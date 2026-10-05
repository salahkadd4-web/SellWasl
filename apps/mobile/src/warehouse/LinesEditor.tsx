import { colors } from '@sellwasl/config';
import type { ProductDto } from '@sellwasl/validation';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Input } from '@/ui';

export interface LineValue {
  unitId: string;
  qty: string;
}

/** Lignes à envoyer : quantité entière positive ; null si une quantité est invalide. */
export function toLines(values: Record<string, LineValue>) {
  const entries = Object.entries(values).filter(([, v]) => v.qty.trim() !== '');
  if (entries.some(([, v]) => !/^\d+$/.test(v.qty.trim()))) return null;
  return entries
    .map(([variantId, v]) => ({ variantId, unitId: v.unitId, qty: Number(v.qty) }))
    .filter((l) => l.qty > 0);
}

/**
 * Saisie article par article : unité au choix (celle de base par défaut) et quantité. `available`
 * affiche le disponible de chaque article, en unité de base.
 */
export function LinesEditor({
  products,
  values,
  onChange,
  available,
}: {
  products: ProductDto[];
  values: Record<string, LineValue>;
  onChange: (values: Record<string, LineValue>) => void;
  available?: Map<string, number>;
}) {
  const [search, setSearch] = useState('');
  const articles = products
    .filter((p) => p.isActive)
    .flatMap((p) =>
      p.variants
        .filter((v) => v.isActive)
        .map((v) => ({
          id: v.id,
          product: p,
          label: p.hasFlavors ? `${p.name} ${v.name}` : p.name,
        })),
    )
    .filter((a) => a.label.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <View style={styles.list}>
      <Input label="Rechercher un article" value={search} onChangeText={setSearch} />
      {articles.map((a) => {
        const units = a.product.units.filter((u) => u.isActive);
        const value = values[a.id] ?? {
          unitId: units.find((u) => u.isBase)?.id ?? units[0]?.id ?? '',
          qty: '',
        };
        const set = (patch: Partial<LineValue>) =>
          onChange({ ...values, [a.id]: { ...value, ...patch } });
        return (
          <View key={a.id} style={styles.row}>
            <Text style={styles.name}>{a.label}</Text>
            {available ? (
              <Text style={styles.muted}>
                Disponible : {available.get(a.id) ?? 0} (unité de base)
              </Text>
            ) : null}
            <View style={styles.controls}>
              <View style={styles.units}>
                {units.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => set({ unitId: u.id })}
                    style={[styles.chip, value.unitId === u.id && styles.chipActive]}
                  >
                    <Text style={value.unitId === u.id ? styles.chipTextActive : styles.chipText}>
                      {u.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel={`Quantité de ${a.label}`}
                keyboardType="number-pad"
                value={value.qty}
                onChangeText={(qty) => set({ qty })}
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.qty}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: {
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 13, color: colors.muted },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  units: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDark, fontWeight: '600' },
  chipTextActive: { color: colors.background, fontWeight: '600' },
  qty: {
    width: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: 'right',
    color: colors.textDark,
    backgroundColor: colors.background,
  },
});
