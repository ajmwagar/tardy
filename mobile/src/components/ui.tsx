import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { memo, type ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import type { Account, WorkStatus } from '@/data/types';
import { appPrefs } from '@/state/app-prefs';
import { colors, compact, countLabel, IMAGE_TRANSITION_MS, status as statusStyles, type as typeStyles } from '@/theme';

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

/**
 * Story ring around an avatar: `unseen` light grey, `seen` dark grey, `boosted` alarm red
 * (a paid boost, shown regardless of seen state).
 */
export type RingState = 'none' | 'unseen' | 'seen' | 'boosted' | 'boostedSeen' | 'closeFriends' | 'closeFriendsSeen';

const ringColor: Record<Exclude<RingState, 'none'>, string> = {
  unseen: colors.unseenRing,
  seen: colors.seenRing,
  boosted: colors.alarm,
  boostedSeen: colors.boostedSeenRing,
  closeFriends: colors.closeFriendsRing,
  closeFriendsSeen: colors.closeFriendsSeenRing,
};

/** Watched stories dim the picture as well as the ring, so new ones stand out. */
const SEEN_AVATAR_OPACITY = 0.5;

/**
 * Shape says what an account is at a glance: people are circles, agents squircles, and
 * brands (projects and channels) rounded squares, so a logo is never cropped to a circle.
 */
export function avatarRadius(kind: Account['kind'] | undefined, size: number): number {
  if (kind === 'agent') return size * 0.3;
  if (kind === 'project' || kind === 'channel') return size * 0.18;
  return size / 2;
}

/** Avatar shaped by account kind (see `avatarRadius`), with an optional story ring (see `RingState`). */
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
      transition={IMAGE_TRANSITION_MS}
      style={{
        width: size,
        height: size,
        borderRadius: avatarRadius(account?.kind, size),
        backgroundColor: colors.elevated,
        opacity: ring === 'seen' || ring === 'boostedSeen' || ring === 'closeFriendsSeen' ? SEEN_AVATAR_OPACITY : 1,
      }}
    />
  );
  if (ring === 'none') return inner;

  const pad = size > 48 ? 3 : 2;
  const outer = size + pad * 4;
  const radius = avatarRadius(account?.kind, outer);
  const gap = (
    <View style={{ padding: pad, borderRadius: radius, backgroundColor: colors.bg }}>{inner}</View>
  );
  return <View style={{ padding: pad, borderRadius: radius, backgroundColor: ringColor[ring] }}>{gap}</View>;
});

/** Paid verification seal, in Tardy yellow. */
export function VerifiedBadge({ size = 13 }: { size?: number }) {
  return <Icon name="checkmark.seal.fill" size={size} color={colors.primary} />;
}

/**
 * The app's three haptics, after Apple's feedback types. Selection when a choice changes
 * (tabs, segments, filter chips); a light impact when something is set (thumbs up, alarm,
 * save, double tap). Nothing fires while scrolling, and navigation stays silent.
 */
export const haptic = {
  selection: () => {
    if (appPrefs().haptics) void Haptics.selectionAsync();
  },
  impact: () => {
    if (appPrefs().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
};

/**
 * Icon + count reaction. A toggle (it has an `activeIcon`) pops with a light impact when
 * switched on and a selection tick when switched off; a plain action (comments, share)
 * just presses down. Satisfying, not flashy: one spring, no particles.
 */
export function Reaction({
  icon,
  activeIcon,
  active,
  activeColor,
  count,
  label,
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
  /** What the button does, for VoiceOver; the count is appended. */
  label: string;
  onPress: () => void;
  vertical?: boolean;
  size?: number;
  color?: string;
}) {
  const toggle = activeIcon !== undefined;
  const pop = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const press = () => {
    if (toggle && !active) {
      pop.set(withSequence(withSpring(1.28, { duration: 140 }), withSpring(1, { duration: 260, dampingRatio: 0.5 })));
      haptic.impact();
    } else if (toggle) {
      haptic.selection();
    }
    onPress();
  };
  const tint = active && activeColor ? activeColor : color;
  return (
    <PressableScale
      onPress={press}
      scaleTo={0.92}
      style={vertical ? styles.reactionVertical : styles.reaction}
      accessibilityRole={toggle ? 'togglebutton' : 'button'}
      accessibilityLabel={countLabel(label, count)}
      accessibilityState={toggle ? { checked: !!active } : undefined}>
      <Animated.View style={style}>
        <Icon name={active && activeIcon ? activeIcon : icon} size={size} color={tint} weight="medium" />
      </Animated.View>
      {count !== undefined && (
        <Text
          style={[styles.count, vertical ? styles.countVertical : active && activeColor ? { color: activeColor } : null]}
          maxFontSizeMultiplier={1.3}>
          {compact(count)}
        </Text>
      )}
    </PressableScale>
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable that springs down slightly on touch: the tactile feel of IG's buttons. The
 * style (and the scale) sit on the pressable itself, so layout props like `flex: 1` work.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.9,
  ...props
}: Omit<PressableProps, 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      hitSlop={8}
      onPressIn={() => scale.set(withSpring(scaleTo, { duration: 120 }))}
      onPressOut={() => scale.set(withSpring(1, { duration: 220 }))}
      {...props}
      style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}

/**
 * Icon-only button for headers and toolbars: a 44pt target (Apple's minimum) with the icon
 * centred, press feedback, and a required VoiceOver label. In a header row, pull it to the
 * edge with a negative margin so the glyph lines up with the row's padding.
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 24,
  color = colors.text,
  style,
}: {
  icon: SFSymbol;
  label: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} style={[styles.iconButton, style]}>
      <Icon name={icon} size={size} color={color} />
    </PressableScale>
  );
}

export function Hairline() {
  return <View style={styles.hairline} />;
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  reaction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  reactionVertical: { alignItems: 'center', gap: 3 },
  count: { ...typeStyles.count },
  countVertical: { color: '#fff' },
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
