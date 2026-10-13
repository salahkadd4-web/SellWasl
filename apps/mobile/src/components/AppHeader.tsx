import { Feather } from '@expo/vector-icons';
import { colors } from '@sellwasl/config';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Bouton rond de l'en-tête (menu, notifications). */
function RoundButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.round, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={22} color={colors.primary} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * En-tête des onglets (refonte mobile, maquette « Accueil ») : menu à gauche, titre centré,
 * notifications à droite.
 */
export function AppHeader({
  title,
  onMenu,
  onNotifications,
  unread = 0,
}: {
  title: string;
  onMenu: () => void;
  onNotifications?: () => void;
  unread?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <RoundButton icon="menu" label="Menu" onPress={onMenu} />
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {onNotifications ? (
        <RoundButton icon="bell" label="Notifications" onPress={onNotifications} badge={unread} />
      ) : (
        <View style={styles.round} />
      )}
    </View>
  );
}

const SIZE = 48;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: colors.surface,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600', color: colors.textDark },
  round: {
    width: SIZE,
    height: SIZE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.error,
  },
  badgeText: { color: colors.background, fontSize: 11, fontWeight: '700' },
});
