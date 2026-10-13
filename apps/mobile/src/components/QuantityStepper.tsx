import { Feather } from '@expo/vector-icons';
import { colors, radius } from '@sellwasl/config';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** Quantité saisie : entier positif ou nul ; null si le texte n'en est pas un. */
export function parseQty(text: string): number | null {
  const clean = text.replace(/\s/g, '');
  if (clean === '') return 0;
  return /^\d+$/.test(clean) ? Number(clean) : null;
}

function StepButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'minus' | 'plus';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        pressed && { backgroundColor: colors.surface },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Feather name={icon} size={22} color={colors.primary} />
    </Pressable>
  );
}

/**
 * [−] [quantité] [+] (refonte mobile) : jamais sous `min`, ni au-dessus de `max` s'il est donné ;
 * saisie au clavier numérique.
 */
export function QuantityField({
  label,
  value,
  onChange,
  min = 0,
  max,
  hint,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  min?: number;
  max?: number;
  /** Information sous le libellé (stock, préparé, quota). */
  hint?: string;
}) {
  const qty = parseQty(value);
  const step = (delta: number) => {
    const next = Math.max(min, (qty ?? 0) + delta);
    onChange(String(max === undefined ? next : Math.min(max, next)));
  };
  return (
    <View style={styles.field}>
      <View style={styles.fieldText}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <StepButton
        icon="minus"
        label={`Moins ${label}`}
        onPress={() => step(-1)}
        disabled={qty !== null && qty <= min}
      />
      <TextInput
        accessibilityLabel={label.startsWith('Quantité') ? label : `Quantité ${label}`}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        selectTextOnFocus
        style={[styles.input, qty === null && styles.invalid]}
      />
      <StepButton
        icon="plus"
        label={`Plus ${label}`}
        onPress={() => step(1)}
        disabled={max !== undefined && qty !== null && qty >= max}
      />
    </View>
  );
}

/** ✓ vert (confirmer) et ✕ rouge (annuler la saisie en cours). */
export function ConfirmCancel({
  onConfirm,
  onCancel,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  busy = false,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}) {
  return (
    <View style={styles.confirmRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        onPress={onCancel}
        style={({ pressed }) => [styles.round, styles.cancel, pressed && { opacity: 0.7 }]}
      >
        <Feather name="x" size={26} color={colors.background} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onConfirm}
        style={({ pressed }) => [
          styles.round,
          styles.confirm,
          (pressed || busy) && { opacity: 0.7 },
        ]}
      >
        <Feather name="check" size={26} color={colors.background} />
      </Pressable>
    </View>
  );
}

const TOUCH = 48;

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldText: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  hint: { fontSize: 13, color: colors.muted },
  step: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  input: {
    width: 72,
    height: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: colors.textDark,
    backgroundColor: colors.background,
  },
  invalid: { borderColor: colors.status.error },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  round: {
    width: 56,
    height: TOUCH,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: { backgroundColor: colors.status.synced },
  cancel: { backgroundColor: colors.status.error },
});
