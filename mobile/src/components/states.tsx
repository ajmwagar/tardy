/**
 * Loading, empty, and error states: use these on every screen instead of ad hoc spinners
 * or red text, so the whole app fails and waits the same way.
 *
 *   First load      <FeedSkeleton width={width} />  or  <ReelSkeleton height={h} bottom={chrome} />
 *                   (shapes match PostCard / a reel; for other lists, compose <SkeletonBlock>
 *                   inside <Pulse>).
 *   Nothing there   <EmptyState icon="zzz" title="No updates yet" message="Your agents are
 *                   suspiciously quiet." action={{ label: 'Find agents', onPress }} />
 *   Load failed     <ErrorState message="..." detail={error} onRetry={reload} />  (whole screen)
 *   Next page       <InlineRetry message="..." detail={error} onRetry={loadMore} />  as the list
 *   failed          footer; keep the items you already have, and stop onEndReached from
 *                   re-firing while it shows.
 *   Media failed    <MediaError detail={...} onRetry={...} />  absolutely filled over the media.
 *   Write failed    nothing to do: store writes roll back and set `lastError`, and the single
 *                   <ErrorToast /> (mounted in app/_layout.tsx) shows it. For other non-blocking
 *                   failures call `reportError(message)` from the store.
 *
 * Copy: specific and a little funny, Tardy's voice. Never "Something went wrong". Always
 * pass the raw error as `detail` so failures stay debuggable (fail loud).
 * Dev: long-press the Home wordmark for fault injection to see each state on demand.
 */
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';

import { clearError, useStore } from '@/state/store';
import { colors, layout, radius, type } from '@/theme';

import { Icon, PressableScale } from './ui';

// MARK: skeletons

/** Slow opacity breathing shared by everything inside it. */
export function Pulse({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** A placeholder block. Put several inside one <Pulse>. */
export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.block, style]} />;
}

/** Shaped like PostCard: header, 4:5 media, action row, two caption lines. */
export function PostSkeleton({ width }: { width: number }) {
  const mediaWidth = width - layout.cardGutter * 2;
  return (
    <Pulse style={styles.card}>
      <View style={styles.cardHeader}>
        <SkeletonBlock style={{ width: 32, height: 32, borderRadius: 16 }} />
        <View style={{ gap: 5 }}>
          <SkeletonBlock style={{ width: 120, height: 11 }} />
          <SkeletonBlock style={{ width: 80, height: 9 }} />
        </View>
      </View>
      <SkeletonBlock style={{ width: mediaWidth, height: mediaWidth / layout.feedMediaAspect, borderRadius: radius.media }} />
      <View style={styles.cardActions}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} style={{ width: 24, height: 24, borderRadius: 12 }} />
        ))}
      </View>
      <View style={styles.cardBody}>
        <SkeletonBlock style={{ width: '90%', height: 11 }} />
        <SkeletonBlock style={{ width: '55%', height: 11 }} />
      </View>
    </Pulse>
  );
}

/** A few PostSkeletons: the Home first-load state. */
export function FeedSkeleton({ width, count = 2 }: { width: number; count?: number }) {
  return (
    <View accessibilityLabel="Loading updates">
      {Array.from({ length: count }, (_, i) => (
        <PostSkeleton key={i} width={width} />
      ))}
    </View>
  );
}

/** Shaped like a reel: action rail on the right, author and caption bottom-left. */
export function ReelSkeleton({ height, bottom }: { height: number; /** Clearance above the tab bar. */ bottom: number }) {
  return (
    <View style={{ height, backgroundColor: '#000' }} accessibilityLabel="Loading reels">
      <Pulse style={StyleSheet.absoluteFill}>
        <View style={[styles.reelRail, { bottom: bottom + 8 }]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} style={[styles.reelBlock, { width: 30, height: 30, borderRadius: 15 }]} />
          ))}
        </View>
        <View style={[styles.reelInfo, { bottom: bottom + 6 }]}>
          <View style={styles.row}>
            <SkeletonBlock style={[styles.reelBlock, { width: 28, height: 28, borderRadius: 14 }]} />
            <SkeletonBlock style={[styles.reelBlock, { width: 110, height: 12 }]} />
          </View>
          <SkeletonBlock style={[styles.reelBlock, { width: '85%', height: 12 }]} />
          <SkeletonBlock style={[styles.reelBlock, { width: 90, height: 18, borderRadius: radius.pill }]} />
        </View>
      </Pulse>
    </View>
  );
}

/** Shaped like the profile grid: rows of 4:5 tiles. */
export function GridSkeleton({ width, rows = 3 }: { width: number; rows?: number }) {
  const { gridColumns: columns, gridGap: gap, gridTileAspect } = layout;
  const size = (width - gap * (columns - 1)) / columns;
  const tile = { width: size, height: size / gridTileAspect, borderRadius: 0 };
  return (
    <Pulse style={[styles.grid, { gap }]}>
      {Array.from({ length: rows * columns }, (_, i) => (
        <SkeletonBlock key={i} style={tile} />
      ))}
    </Pulse>
  );
}

/** Shaped like ProfileView's header (avatar, three stats, name, bio, buttons) over its grid. */
export function ProfileSkeleton({ width }: { width: number }) {
  return (
    <View accessibilityLabel="Loading profile">
      <Pulse style={styles.profileHeader}>
        <View style={styles.profileTop}>
          <SkeletonBlock style={styles.profileAvatar} />
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.profileStat}>
              <SkeletonBlock style={styles.profileStatValue} />
              <SkeletonBlock style={styles.profileStatLabel} />
            </View>
          ))}
        </View>
        <SkeletonBlock style={styles.profileName} />
        <SkeletonBlock style={styles.profileBio} />
        <SkeletonBlock style={styles.profileButton} />
      </Pulse>
      <GridSkeleton width={width} rows={2} />
    </View>
  );
}

// MARK: empty & error

type Action = { label: string; onPress: () => void };

function Button({ label, onPress }: Action) {
  return (
    <PressableScale onPress={onPress} style={styles.button} scaleTo={0.95} accessibilityRole="button">
      <Text style={styles.buttonText}>{label}</Text>
    </PressableScale>
  );
}

/** Nothing to show (yet). One icon, a title, one line, and an optional way forward. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  style,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  action?: Action;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.state, style]}>
      <Icon name={icon} size={40} color={colors.primary} weight="light" />
      <Text style={styles.title}>{title}</Text>
      <Text style={[type.secondary, styles.center]}>{message}</Text>
      {action && <Button {...action} />}
    </View>
  );
}

/** A load failed and there is nothing to show instead. Always offers retry. */
export function ErrorState({
  title = 'That didn’t load',
  message,
  detail,
  onRetry,
  retryLabel = 'Try again',
  style,
}: {
  title?: string;
  message: string;
  /** The raw error, shown small so failures stay debuggable. */
  detail?: string;
  onRetry: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.state, style]}>
      <Icon name="exclamationmark.arrow.triangle.2.circlepath" size={40} color={colors.alarm} weight="light" />
      <Text style={styles.title}>{title}</Text>
      <Text style={[type.secondary, styles.center]}>{message}</Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      <Button label={retryLabel} onPress={onRetry} />
    </View>
  );
}

/** List footer when the next page failed; everything above it stays put. */
export function InlineRetry({ message, detail, onRetry }: { message: string; detail?: string; onRetry: () => void }) {
  return (
    <View style={styles.inline}>
      <Text style={[type.secondary, styles.center]}>{message}</Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      <PressableScale onPress={onRetry} style={styles.inlineButton} scaleTo={0.95} accessibilityRole="button">
        <Icon name="arrow.clockwise" size={13} color={colors.text} weight="semibold" />
        <Text style={styles.inlineButtonText}>Retry</Text>
      </PressableScale>
    </View>
  );
}

/** Overlay for media (video, image) that failed to load. Sits on top of the poster. */
export function MediaError({
  message = 'This one didn’t render. Its agent is probably “on it.”',
  detail,
  onRetry,
}: {
  message?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.media]}>
      <Icon name="video.slash" size={30} color={colors.text} weight="light" />
      <Text style={[styles.mediaText, styles.center]}>{message}</Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      {onRetry && (
        <PressableScale onPress={onRetry} style={styles.inlineButton} scaleTo={0.95} accessibilityRole="button">
          <Icon name="arrow.clockwise" size={13} color={colors.text} weight="semibold" />
          <Text style={styles.inlineButtonText}>Retry</Text>
        </PressableScale>
      )}
    </View>
  );
}

// MARK: toast

const TOAST_MS = 5000;
/** Clears the floating tab bar. */
const TAB_BAR_CLEARANCE = 64;

/**
 * App-wide, non-blocking error toast driven by the store's `lastError` (rolled-back likes,
 * saves, alarms, follows; `reportError`). Tap to dismiss; auto-dismisses. Mount once.
 */
export function ErrorToast() {
  const message = useStore((s) => s.lastError);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clearError, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastHost, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]}>
      <Animated.View key={message} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(160)}>
        <Pressable onPress={clearError} style={styles.toast} accessibilityRole="alert" accessibilityHint="Dismisses">
          <Icon name="arrow.uturn.backward" size={13} color="#fff" weight="bold" />
          <Text style={styles.toastText} numberOfLines={3}>
            {message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.elevated, borderRadius: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { textAlign: 'center' },

  // Mirrors PostCard's card, header, actions, and body.
  card: {
    marginHorizontal: layout.cardGutter,
    marginBottom: 10,
    paddingBottom: 14,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 12, paddingTop: 14 },
  cardBody: { paddingHorizontal: 12, paddingTop: 12, gap: 6 },

  // Mirrors ProfileView's header and grid.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  profileHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 10 },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  profileAvatar: { width: 96, height: 96, borderRadius: 48 },
  profileStat: { flex: 1, alignItems: 'center', gap: 6 },
  profileStatValue: { width: 34, height: 16 },
  profileStatLabel: { width: 50, height: 10 },
  profileName: { width: 140, height: 14 },
  profileBio: { width: '75%', height: 11 },
  profileButton: { height: 36, borderRadius: radius.pill, marginTop: 6 },

  // Mirrors the reel overlays.
  reelRail: { position: 'absolute', right: 8, alignItems: 'center', gap: 22 },
  reelInfo: { position: 'absolute', left: 12, right: 70, gap: 8 },
  reelBlock: { backgroundColor: 'rgba(255,255,255,0.14)' },

  state: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32, gap: 6 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  detail: { color: colors.textTertiary, fontSize: 11, textAlign: 'center' },
  button: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.primary },
  buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },

  inline: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 32, gap: 6 },
  inlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
  },
  inlineButtonText: { color: colors.text, fontSize: 13, fontWeight: '700' },

  media: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: 24, gap: 6 },
  mediaText: { color: colors.text, fontWeight: '600' },

  toastHost: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.card,
    backgroundColor: colors.alarm,
  },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
