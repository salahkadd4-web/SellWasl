import { Feather } from '@expo/vector-icons';
import { colors } from '@sellwasl/config';
import { type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SheetAction } from './ActionSheet';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

/** Mêmes actions que la feuille « ⋯ » : le geste n'est jamais le seul accès. */
export type SwipeAction = SheetAction;

/** Largeur d'une action dévoilée : zone tactile confortable. */
const ACTION_WIDTH = 76;

/**
 * Ligne à glisser de la droite vers la gauche (refonte mobile) : dévoile des actions (clients),
 * ou déclenche `onOpen` (zone de quantité d'un produit, d'une ligne livrée) puis se referme.
 * Le geste ne démarre qu'au-delà d'un petit déplacement horizontal : le défilement vertical de la
 * liste reste libre. Les mêmes actions doivent rester accessibles sans geste (bouton visible).
 */
export function SwipeRow({
  children,
  actions,
  onOpen,
  openLabel,
}: {
  children: ReactNode;
  actions?: SwipeAction[];
  /** Ouverture complète : action unique (ex. saisir la quantité). */
  onOpen?: () => void;
  /** Libellé de l'action unique, montré pendant le glissement. */
  openLabel?: string;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const width = actions ? actions.length * ACTION_WIDTH : ACTION_WIDTH * 1.5;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      rightThreshold={width / 2}
      dragOffsetFromRight={-12}
      overshootRight={false}
      onSwipeableOpen={() => {
        if (!onOpen) return;
        onOpen();
        ref.current?.close();
      }}
      renderRightActions={() => (
        <View style={[styles.actions, { width }]}>
          {actions ? (
            actions.map((a) => (
              <Pressable
                key={a.key}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                accessibilityState={{ disabled: !!a.disabledReason }}
                disabled={!!a.disabledReason}
                onPress={() => {
                  ref.current?.close();
                  a.onPress();
                }}
                style={({ pressed }) => [
                  styles.action,
                  pressed && { backgroundColor: colors.surface },
                  a.disabledReason ? { opacity: 0.4 } : null,
                ]}
              >
                <Feather name={a.icon} size={22} color={colors.primary} />
                <Text style={styles.actionLabel}>{a.label}</Text>
              </Pressable>
            ))
          ) : (
            <View style={[styles.action, styles.openHint]}>
              <Feather name="edit-3" size={22} color={colors.background} />
              <Text style={[styles.actionLabel, { color: colors.background }]}>{openLabel}</Text>
            </View>
          )}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', backgroundColor: colors.background },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  actionLabel: { fontSize: 12, fontWeight: '600', color: colors.textDark },
  openHint: { backgroundColor: colors.primary, borderLeftWidth: 0 },
});
