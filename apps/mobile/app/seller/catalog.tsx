import { colors, radius } from '@sellwasl/config';
import type { ProductDto } from '@sellwasl/validation';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, SectionList, StyleSheet, Text, View } from 'react-native';
import { request } from '@/api/client';
import { photoUri } from '@/catalog/photos';
import { errorMessage } from '@/seller/format';
import { Input, Message } from '@/ui';

/** Catalogue hors visite, sans aucun prix (UC-21, BR-CAT-11), par gamme et catégorie. */
export default function CatalogScreen() {
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request<ProductDto[]>('/products?status=ACTIVE')
      .then(setProducts)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byRange = new Map<string, ProductDto[]>();
    for (const p of products ?? []) {
      if (q && !`${p.name} ${p.reference}`.toLowerCase().includes(q)) continue;
      byRange.set(p.range.name, [...(byRange.get(p.range.name) ?? []), p]);
    }
    return [...byRange.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([title, data]) => ({
        title,
        data: data.sort(
          (a, b) =>
            (a.category?.name ?? '').localeCompare(b.category?.name ?? '', 'fr') ||
            a.name.localeCompare(b.name, 'fr'),
        ),
      }));
  }, [products, query]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={products ? <Message tone="info">Aucun produit trouvé.</Message> : null}
      ListHeaderComponent={
        <View style={styles.header}>
          <Input label="Rechercher" value={query} onChangeText={setQuery} />
          {error ? <Message>{error}</Message> : null}
          {!products && !error ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => {
        const uri = photoUri(item.id);
        const flavors = item.hasFlavors ? item.variants.filter((v) => v.isActive) : [];
        return (
          <View style={styles.row}>
            {uri ? <Image source={{ uri }} style={styles.photo} /> : <View style={styles.photo} />}
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.muted}>
                {[item.reference, item.category?.name, item.units.map((u) => u.name).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {flavors.length ? (
                <Text style={styles.flavors}>{flavors.map((v) => v.name).join(' · ')}</Text>
              ) : null}
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12, backgroundColor: colors.background },
  header: { gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: colors.primary, paddingTop: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  muted: { fontSize: 14, color: colors.muted },
  flavors: { fontSize: 14, color: colors.deepBlue },
});
