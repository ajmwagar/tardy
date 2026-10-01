import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { openWebCheckout } from '@/config';
import type { Story, StoryGroup } from '@/data/types';
import { markStoriesSeen, useAccount } from '@/state/store';
import { nextPosition, previousPosition, storyDurationMs, tapAction, type StoryPosition } from '@/stories/playback';
import { colors, radius, timeAgo } from '@/theme';

import { MediaError } from './states';
import { Avatar, Icon, NameLine, PressableScale } from './ui';
import { VideoSurface } from './video-surface';

/** Drag distance or downward speed that dismisses the viewer. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * Full-screen, Instagram-style story player over the whole tray. Starts at `start` and
 * plays through every group in tray order; closes after the last. Tap the right third
 * for next, the left third for previous; hold to pause; swipe down to close.
 */
export function StoryViewer({ groups, start, onClose }: { groups: StoryGroup[]; start: StoryPosition; onClose: () => void }) {
  const [pos, setPos] = useState(start);
  /** Bumped to restart the current story (previous at the very first one). */
  const [restarts, setRestarts] = useState(0);
  const [dragging, setDragging] = useState(false);
  const translateY = useSharedValue(0);

  const next = useCallback(() => {
    const n = nextPosition(groups, pos);
    if (n) setPos(n);
    else onClose();
  }, [groups, pos, onClose]);

  const previous = useCallback(() => {
    const p = previousPosition(groups, pos);
    if (p.group === pos.group && p.story === pos.story) setRestarts((r) => r + 1);
    else setPos(p);
  }, [groups, pos]);

  const swipeDown = Gesture.Pan()
    .activeOffsetY(15)
    .failOffsetX([-20, 20])
    .onStart(() => scheduleOnRN(setDragging, true))
    .onUpdate((e) => translateY.set(Math.max(0, e.translationY)))
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) scheduleOnRN(onClose);
      else translateY.set(withSpring(0, { duration: 260 }));
    })
    .onFinalize(() => scheduleOnRN(setDragging, false));

  const dragStyle = useAnimatedStyle(() => {
    const y = translateY.get();
    return { transform: [{ translateY: y }, { scale: 1 - Math.min(y, 400) / 2000 }], borderRadius: y > 0 ? radius.card : 0 };
  });

  const group = groups[pos.group];
  const story = group.stories[pos.story];
  return (
    <View style={styles.backdrop}>
      <GestureDetector gesture={swipeDown}>
        <Animated.View style={[styles.fill, styles.clip, dragStyle]}>
          <StoryPage
            key={`${story.id}:${restarts}`}
            group={group}
            index={pos.story}
            paused={dragging}
            onNext={next}
            onPrevious={previous}
            onClose={onClose}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** One story on screen. Remounted per story, so its timer, load state and hold start fresh. */
function StoryPage({
  group,
  index,
  paused,
  onNext,
  onPrevious,
  onClose,
}: {
  group: StoryGroup;
  index: number;
  /** Paused from outside (e.g. while being swiped down). */
  paused: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const story = group.stories[index];
  const duration = storyDurationMs(story.media);
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [held, setHeld] = useState(false);
  const progress = useSharedValue(0);
  const playing = ready && !held && !paused;

  useEffect(() => {
    markStoriesSeen([story.id]);
  }, [story.id]);

  // The timer: runs while playing, resumes from where it stopped, advances when it fills.
  useEffect(() => {
    if (!playing) return;
    progress.set(
      withTiming(1, { duration: (1 - progress.get()) * duration, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(onNext);
      }),
    );
    return () => cancelAnimation(progress);
  }, [playing, duration, progress, onNext]);

  const tap = Gesture.Tap()
    .maxDuration(250)
    .maxDistance(12)
    .runOnJS(true)
    .onEnd((e, success) => {
      if (!success) return;
      const action = tapAction(e.x, width);
      if (action === 'next') onNext();
      else if (action === 'previous') onPrevious();
    });
  const hold = Gesture.LongPress()
    .minDuration(200)
    .maxDistance(12)
    .runOnJS(true)
    .onStart(() => setHeld(true))
    .onFinalize(() => setHeld(false));

  const markReady = useCallback(() => setReady(true), []);

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={Gesture.Race(hold, tap)}>
        <View style={styles.fill} collapsable={false}>
          <StoryMedia story={story} active={!held && !paused} onReady={markReady} />
        </View>
      </GestureDetector>
      {/* Chrome hides while holding, like Instagram, so you can look at the media. */}
      <StoryHeader group={group} index={index} progress={progress} hidden={held} onClose={onClose} />
    </View>
  );
}

function StoryMedia({ story, active, onReady }: { story: Story; active: boolean; onReady: () => void }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  if (story.media.type === 'video') {
    return <VideoSurface media={story.media} active={active} onReady={onReady} />;
  }
  return (
    <>
      <Image
        key={attempt}
        source={story.media.url}
        style={styles.fill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
        onLoad={onReady}
        onError={(e) => setFailure(e.error)}
      />
      {failure !== null && (
        <MediaError
          message="This story didn’t load. Tap the right side to skip it."
          detail={`${failure} (${story.media.url})`}
          onRetry={() => {
            setFailure(null);
            setAttempt((a) => a + 1);
          }}
        />
      )}
    </>
  );
}

function StoryHeader({
  group,
  index,
  progress,
  hidden,
  onClose,
}: {
  group: StoryGroup;
  index: number;
  progress: SharedValue<number>;
  hidden: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const author = useAccount(group.authorId);
  const story = group.stories[index];
  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.header, { paddingTop: insets.top + 6, opacity: hidden ? 0 : 1 }]}>
      <View style={styles.segments}>
        {group.stories.map((s, i) => (
          <View key={s.id} style={styles.segment}>
            {i < index ? <View style={[styles.segmentFill, styles.full]} /> : i === index ? <ActiveFill progress={progress} /> : null}
          </View>
        ))}
      </View>
      <View style={styles.authorRow}>
        <Avatar account={author} size={32} />
        <View style={styles.nameLine}>
          <NameLine account={author} style={styles.shadowText} />
          <Text style={[styles.time, styles.shadowText]}>{timeAgo(story.createdAt)}</Text>
        </View>
        <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close stories">
          <Icon name="xmark" size={22} color="#fff" weight="semibold" />
        </PressableScale>
      </View>
      {group.authorId === 'me' && (
        <View style={styles.boostHost}>
          <PressableScale style={styles.boost} scaleTo={0.96} onPress={() => void openWebCheckout('boost')} accessibilityRole="button">
            <Icon name="flame.fill" size={13} color={colors.alarm} weight="semibold" />
            <Text style={styles.boostText}>Boost my story</Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

function ActiveFill({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));
  return <Animated.View style={[styles.segmentFill, style]} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  fill: StyleSheet.absoluteFill,
  clip: { overflow: 'hidden', backgroundColor: '#000' },

  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 10 },
  segments: { flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 2.5, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.35)' },
  segmentFill: { height: '100%', backgroundColor: '#fff' },
  full: { width: '100%' },

  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  nameLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '500' },
  shadowText: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },

  boostHost: { alignSelf: 'flex-start', marginLeft: 2 },
  boost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
  boostText: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
