import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { Account, WorkStatus } from '@/data/types';
import { colors, status as statusStyles } from '@/theme';

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

export function VerifiedBadge({ size = 12 }: { size?: number }) {
  return <Icon name="checkmark.seal.fill" size={size} color={colors.accent} />;
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
      onPressIn={() => (scale.value = withSpring(scaleTo, { duration: 120 }))}
      onPressOut={() => (scale.value = withSpring(1, { duration: 220 }))}
      {...props}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />;
}

const styles = StyleSheet.create({
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  handle: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  agentBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.elevated },
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
