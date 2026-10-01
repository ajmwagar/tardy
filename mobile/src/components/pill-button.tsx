import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme';

import { Icon, PressableScale } from './ui';

/** Full-width pill: Tardy yellow for the primary action, elevated grey otherwise. */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy = false,
  disabled = false,
  size = 'large',
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  icon?: SFSymbol;
  busy?: boolean;
  disabled?: boolean;
  size?: 'large' | 'small';
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === 'primary' ? colors.onPrimary : colors.text;
  return (
    <PressableScale
      style={[
        styles.base,
        size === 'large' ? styles.large : styles.small,
        { backgroundColor: variant === 'primary' ? colors.primary : colors.elevated, opacity: disabled ? 0.45 : 1 },
        style,
      ]}
      scaleTo={0.97}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={size === 'large' ? 18 : 13} color={fg} weight="bold" />}
          <Text style={[size === 'large' ? styles.largeText : styles.smallText, { color: fg }]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  large: { height: 52 },
  small: { height: 32, paddingHorizontal: 16, minWidth: 96 },
  largeText: { fontWeight: '800', fontSize: 16 },
  smallText: { fontWeight: '800', fontSize: 13 },
});
