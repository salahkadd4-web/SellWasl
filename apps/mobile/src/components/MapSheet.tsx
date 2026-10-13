import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SheetAction } from './ActionSheet';

/**
 * Panneau bas de la carte (refonte mobile) : la fiche courte du point touché et ses actions en
 * gros boutons ; se ferme par la croix.
 */
export function MapSheet({
  title,
  badge,
  lines,
  actions,
  onClose,
  footer,
}: {
  title: string;
  badge?: string | null;
  lines: (string | null | undefined)[];
  actions: SheetAction[];
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onClose}
          style={styles.close}
        >
          <Feather name="x" size={22} color={colors.muted} />
        </Pressable>
      </View>
      {lines.filter(Boolean).map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled: !!a.disabledReason }}
            disabled={!!a.disabledReason}
            onPress={a.onPress}
            style={({ pressed }) => [
              styles.action,
              pressed && { backgroundColor: colors.surface },
              a.disabledReason ? { opacity: 0.4 } : null,
            ]}
          >
            <Feather name={a.icon} size={22} color={colors.primary} />
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      {actions
        .filter((a) => a.disabledReason)
        .map((a) => (
          <Text key={a.key} style={styles.reason}>
            {a.label} : {a.disabledReason}
          </Text>
        ))}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    gap: 6,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textDark },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.background },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  line: { fontSize: 14, color: colors.muted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.textDark },
  reason: { fontSize: 13, color: colors.muted },
});
