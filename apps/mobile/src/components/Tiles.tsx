import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** Indicateur du tableau de bord (maquette « Accueil ») : icône, valeur, libellé. */
export function StatTile({
  icon,
  value,
  label,
  extra,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  value: string;
  label: string;
  /** Complément à droite de la valeur (pourcentage). */
  extra?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} : ${value}${extra ? `, ${extra}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.tileTop}>
        <Feather name={icon} size={24} color={colors.muted} />
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {extra ? <Text style={styles.extra}>{extra}</Text> : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Deux indicateurs par ligne. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Carte blanche du terrain : coins arrondis, bordure fine (maquettes). */
export function Panel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 8,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flexShrink: 1, fontSize: 22, fontWeight: '700', color: colors.textDark },
  extra: { fontSize: 13, fontWeight: '700', color: colors.status.synced },
  label: { fontSize: 14, color: colors.muted },
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
});
