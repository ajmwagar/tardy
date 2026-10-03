import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SFSymbol } from 'expo-symbols';

import { setLiked } from '@/state/store';
import { colors } from '@/theme';

import { haptic, Icon } from './ui';

/**
 * Wraps media so a double tap gives the post a thumbs up with a pop; a single tap is
 * forwarded (e.g. to mute/unmute video). Double tap never removes it.
 */
export function DoubleTapLike({
  postId,
  onSingleTap,
  singleTapIcon,
  onHoldSpeed,
  onHoldEnd,
  heartSize = 96,
  children,
}: {
  postId: string;
  onSingleTap?: () => void;
  /** Icon flashed after the single-tap action, e.g. the resulting audio state. */
  singleTapIcon?: SFSymbol;
  /** Called while a side hold is active and moves between 2x and 4x. */
  onHoldSpeed?: (speed: 2 | 4) => void;
  /** A vertical drag locks the selected speed; a stationary release returns null. */
  onHoldEnd?: (lockedSpeed: 2 | 4 | null) => void;
  heartSize?: number;
  children: ReactNode;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const feedbackScale = useSharedValue(0);
  const feedbackOpacity = useSharedValue(0);
  const surfaceWidth = useSharedValue(0);
  const sideHold = useSharedValue(false);

  const commitLike = () => {
    haptic.impact();
    void setLiked(postId, true);
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(350)
    .onEnd((_event, success) => {
      if (!success) return;
      // Start the visible response on the UI thread so video/React work cannot delay it.
      scale.set(0.62);
      opacity.set(0);
      scale.set(withSequence(withSpring(1.18, { duration: 220 }), withSpring(1, { duration: 140 }), withTiming(0.92, { duration: 360 })));
      opacity.set(withSequence(withTiming(1, { duration: 70 }), withTiming(1, { duration: 540 }), withTiming(0, { duration: 190 })));
      scheduleOnRN(commitLike);
    });
  const singleTap = Gesture.Tap().onEnd((_event, success) => {
    if (!success || !onSingleTap) return;
    if (singleTapIcon) {
      feedbackScale.set(0.72);
      feedbackOpacity.set(0);
      feedbackScale.set(withSequence(withSpring(1.08, { duration: 180 }), withTiming(1, { duration: 160 })));
      feedbackOpacity.set(withSequence(withTiming(1, { duration: 70 }), withTiming(1, { duration: 320 }), withTiming(0, { duration: 180 })));
    }
    scheduleOnRN(onSingleTap);
  });
  const hold = Gesture.Pan()
    .activateAfterLongPress(260)
    .minDistance(0)
    .onStart((event) => {
      const onSide = event.x <= surfaceWidth.get() * 0.3 || event.x >= surfaceWidth.get() * 0.7;
      sideHold.set(onSide);
      if (onSide && onHoldSpeed) scheduleOnRN(onHoldSpeed, 2);
    })
    .onUpdate((event) => {
      if (sideHold.get() && onHoldSpeed) scheduleOnRN(onHoldSpeed, event.translationY < -60 ? 4 : 2);
    })
    .onEnd((event) => {
      if (!sideHold.get() || !onHoldEnd) return;
      const locked = event.translationY < -60 ? 4 : event.translationY > 60 ? 2 : null;
      scheduleOnRN(onHoldEnd, locked);
    })
    .onFinalize((_event, success) => {
      if (!success && sideHold.get() && onHoldEnd) scheduleOnRN(onHoldEnd, null);
      sideHold.set(false);
    });
  const gesture = onHoldSpeed ? Gesture.Race(hold, Gesture.Exclusive(doubleTap, singleTap)) : Gesture.Exclusive(doubleTap, singleTap);

  const heartStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const feedbackStyle = useAnimatedStyle(() => ({ opacity: feedbackOpacity.value, transform: [{ scale: feedbackScale.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} onLayout={(event) => surfaceWidth.set(event.nativeEvent.layout.width)}>
        {children}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, styles.overlay]}>
          <Animated.View style={[heartStyle, styles.shadow]}>
            <Icon name="hand.thumbsup.fill" size={heartSize} color={colors.primary} />
          </Animated.View>
        </View>
        {singleTapIcon ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, styles.overlay]}>
            <Animated.View style={[feedbackStyle, styles.audioBubble]}>
              <Icon name={singleTapIcon} size={36} color="#fff" />
            </Animated.View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  overlay: { zIndex: 40, elevation: 40 },
  shadow: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  audioBubble: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
});
