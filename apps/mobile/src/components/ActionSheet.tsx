import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface SheetAction {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  /** Action impossible ici (pas de numéro, pas de position…) : grisée, avec la raison. */
  disabledReason?: string;
}

/**
 * Feuille d'actions montant du bas (menu, bouton +, « ⋯ » d'un client) : se ferme en touchant le
 * fond ou après une action.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grip} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {actions.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled: !!a.disabledReason }}
            disabled={!!a.disabledReason}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface }]}
          >
            <Feather
              name={a.icon}
              size={22}
              color={a.disabledReason ? colors.muted : colors.primary}
            />
            <View style={styles.itemText}>
              <Text style={[styles.label, a.disabledReason ? { color: colors.muted } : null]}>
                {a.label}
              </Text>
              {a.disabledReason ? <Text style={styles.reason}>{a.disabledReason}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 4, 60, 0.35)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 4,
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.textDark, paddingVertical: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 56,
    paddingHorizontal: 8,
    borderRadius: radius.md,
  },
  itemText: { flex: 1, gap: 2 },
  label: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  reason: { fontSize: 13, color: colors.muted },
});
