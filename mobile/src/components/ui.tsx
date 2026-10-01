import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { memo, type ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import type { Account, WorkStatus } from '@/data/types';
import { colors, compact, status as statusStyles, type as typeStyles } from '@/theme';

export const Icon = memo(function Icon({
  name,
  size = 24,
  color = colors.text,
  weight = 'regular',
}: {
  name: SFSymbol;
  size?: number;
  color?: string;
  weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
}) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} style={{ width: size, height: size }} />;
});

type RingState = 'none' | 'unseen' | 'seen';

/** Circular avatar with an optional story ring (gradient when unseen, grey when seen). */
export const Avatar = memo(function Avatar({
  account,
  size = 32,
  ring = 'none',
}: {
  account: Pick<Account, 'avatarUrl' | 'kind'> | undefined;
  size?: number;
  ring?: RingState;
}) {
  const inner = (
    <Image
      source={account?.avatarUrl}
      recyclingKey={account?.avatarUrl}
      cachePolicy="memory-disk"
      transition={120}
      style={{
        width: size,
        height: size,
        // Agents get a squircle so they read differently from people at a glance.
        borderRadius: account?.kind === 'agent' ? size * 0.3 : size / 2,
        backgroundColor: colors.elevated,
      }}
    />
  );
  if (ring === 'none') return inner;

  const pad = size > 48 ? 3 : 2;
  const outer = size + pad * 4;
  const radius = account?.kind === 'agent' ? outer * 0.3 : outer / 2;
  const gap = (
    <View style={{ padding: pad, borderRadius: radius, backgroundColor: colors.bg }}>{inner}</View>
  );
  return ring === 'unseen' ? (
    <LinearGradient colors={colors.storyRing} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={{ padding: pad, borderRadius: radius }}>
      {gap}
    </LinearGradient>
  ) : (
    <View style={{ padding: pad, borderRadius: radius, backgroundColor: colors.seenRing }}>{gap}</View>
  );
});

/** Paid verification seal, in Tardy yellow. */
export function VerifiedBadge({ size = 13 }: { size?: number }) {
  return <Icon name="checkmark.seal.fill" size={size} color={colors.primary} />;
}

/**
 * Icon + count reaction. On activate: a quick overshoot pop, a light haptic, and the
 * count ticks. Satisfying, not flashy: one spring, no particles.
 */
export function Reaction({
  icon,
  activeIcon,
  active,
  activeColor,
  count,
  onPress,
  vertical = false,
  size = 22,
  color = colors.text,
}: {
  icon: SFSymbol;
  activeIcon?: SFSymbol;
  active?: boolean;
  activeColor?: string;
  count?: number;
  onPress: () => void;
  vertical?: boolean;
  size?: number;
  color?: string;
}) {
  const pop = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const press = () => {
    if (!active) {
      pop.set(withSequence(withSpring(1.28, { duration: 140 }), withSpring(1, { duration: 260, dampingRatio: 0.5 })));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      void Haptics.selectionAsync();
    }
    onPress();
  };
  const tint = active && activeColor ? activeColor : color;
  return (
    <Pressable onPress={press} hitSlop={8} style={vertical ? styles.reactionVertical : styles.reaction}>
      <Animated.View style={style}>
        <Icon name={active && activeIcon ? activeIcon : icon} size={size} color={tint} weight="medium" />
      </Animated.View>
      {count !== undefined && (
        <Text style={[styles.count, { color: vertical ? '#fff' : active && activeColor ? activeColor : colors.text }]}>{compact(count)}</Text>
      )}
    </Pressable>
  );
}

export function AgentBadge() {
  return (
    <View style={styles.agentBadge}>
      <Text style={styles.agentBadgeText}>AI</Text>
    </View>
  );
}

export function NameLine({ account, style }: { account: Account | undefined; style?: object }) {
  if (!account) return null;
  return (
    <View style={styles.nameLine}>
      <Text style={[styles.handle, style]} numberOfLines={1}>
        {account.handle}
      </Text>
      {account.verified && <VerifiedBadge />}
      {account.kind === 'agent' && <AgentBadge />}
    </View>
  );
}

export function StatusPill({ value, compact = false }: { value: WorkStatus; compact?: boolean }) {
  const s = statusStyles[value];
  return (
    <View style={[styles.pill, { borderColor: s.color + '66', backgroundColor: s.color + '1F' }]}>
      <Icon name={s.symbol as SFSymbol} size={compact ? 10 : 12} color={s.color} weight="semibold" />
      <Text style={[styles.pillText, { color: s.color, fontSize: compact ? 10 : 12 }]}>{s.label}</Text>
    </View>
  );
}

/** Pressable that springs down slightly on touch: the tactile feel of IG's buttons. */
export function PressableScale({
  children,
  style,
  scaleTo = 0.9,
  ...props
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      hitSlop={8}
      onPressIn={() => scale.set(withSpring(scaleTo, { duration: 120 }))}
      onPressOut={() => scale.set(withSpring(1, { duration: 220 }))}
      {...props}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />;
}

const styles = StyleSheet.create({
  reaction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  reactionVertical: { alignItems: 'center', gap: 3 },
  count: { ...typeStyles.count },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  handle: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  agentBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: colors.elevated },
  agentBadgeText: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontWeight: '600' },
});
