import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

/** Onglets côte à côte, l'actif en marine (maquette « Visites »). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pastilles de filtre, défilant horizontalement. */
export function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Champ de recherche avec loupe (maquettes). */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.search}>
      <Feather name="search" size={20} color={colors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Effacer"
          onPress={() => onChange('')}
        >
          <Feather name="x" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 8 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textDark, textAlign: 'center' },
  segmentTextActive: { color: colors.background },
  chips: { gap: 8, paddingVertical: 4 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.deepBlue, borderColor: colors.deepBlue },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textDark },
  chipTextActive: { color: colors.background },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.textDark, paddingVertical: 8 },
});
