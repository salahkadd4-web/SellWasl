import { Feather } from '@expo/vector-icons';
import { colors } from '@sellwasl/config';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TabItem {
  /** Nom de l'écran dans le dossier `(tabs)`. */
  name: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}

/** Ce que la barre reçoit du navigateur d'onglets. */
interface TabBarNavigation {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

/**
 * Barre du bas (maquette « Accueil ») : deux onglets, le bouton + central (actions rapides du
 * profil), deux onglets.
 */
export function TabBar({
  state,
  navigation,
  items,
  onPlus,
}: TabBarNavigation & { items: TabItem[]; onPlus: () => void }) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const tab = (item: TabItem) => {
    const route = state.routes.find((r) => r.name === item.name);
    const active = current === item.name;
    return (
      <Pressable
        key={item.name}
        accessibilityRole="tab"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active }}
        onPress={() => {
          if (!route) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!active && !event.defaultPrevented) navigation.navigate(item.name);
        }}
        style={styles.tab}
      >
        <Feather name={item.icon} size={24} color={active ? colors.primary : colors.muted} />
        <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
          {item.label}
        </Text>
      </Pressable>
    );
  };
  const half = Math.ceil(items.length / 2);
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.slice(0, half).map(tab)}
      <View style={styles.plusSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Actions rapides"
          onPress={onPlus}
          style={({ pressed }) => [styles.plus, pressed && { opacity: 0.8 }]}
        >
          <Feather name="plus" size={30} color={colors.background} />
        </Pressable>
      </View>
      {items.slice(half).map(tab)}
    </View>
  );
}

const PLUS = 64;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 52, justifyContent: 'center' },
  label: { fontSize: 12, color: colors.muted },
  labelActive: { color: colors.primary, fontWeight: '700' },
  plusSlot: { flex: 1, alignItems: 'center' },
  plus: {
    width: PLUS,
    height: PLUS,
    borderRadius: PLUS / 2,
    marginTop: -PLUS / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.background,
  },
});
