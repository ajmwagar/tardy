import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

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
  heartSize = 96,
  children,
}: {
  postId: string;
  onSingleTap?: () => void;
  heartSize?: number;
  children: ReactNode;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const burst = () => {
    scale.value = withSequence(withSpring(1.15, { duration: 260 }), withSpring(1, { duration: 120 }), withTiming(0.9, { duration: 360 }));
    opacity.value = withSequence(withTiming(1, { duration: 80 }), withTiming(1, { duration: 520 }), withTiming(0, { duration: 180 }));
    haptic.impact();
    void setLiked(postId, true);
  };

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(240).runOnJS(true).onEnd(burst);
  const singleTap = Gesture.Tap().runOnJS(true).onEnd(() => onSingleTap?.());
  const gesture = Gesture.Exclusive(doubleTap, singleTap);

  const heartStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>
        {children}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <Animated.View style={[heartStyle, styles.shadow]}>
            <Icon name="hand.thumbsup.fill" size={heartSize} color={colors.primary} />
          </Animated.View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  shadow: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
