import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import type { Post } from '@/data/types';
import { useStore } from '@/state/store';

/** Points per second; slow enough to read, fast enough to feel live. */
const SPEED = 42;

/**
 * Frosted breaking-news strip for posts going viral right now: white text on blur, nothing
 * else competing for attention. The headlines scroll
 * continuously (two copies laid end to end, so the loop is seamless); tap to open the
 * top story. Holds still under Reduce Motion. Renders nothing when nothing is trending.
 */
export const BreakingTicker = memo(function BreakingTicker({ posts }: { posts: Post[] }) {
  const accounts = useStore((s) => s.accounts);
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  // Reduce Motion: the strip holds still and shows the first headline instead of scrolling.
  const still = useReducedMotion();

  const headline = posts
    .map((p) => `${accounts.get(p.authorId)?.handle ?? ''}: ${p.caption}`)
    .join('     •     ');

  useEffect(() => {
    if (width === 0 || still) return;
    offset.value = 0;
    offset.value = withRepeat(withTiming(-width, { duration: (width / SPEED) * 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(offset);
  }, [offset, width, still]);

  const scroll = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (posts.length === 0) return null;

  return (
    <Pressable
      style={styles.bar}
      onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: posts[0].id } })}
      accessibilityRole="button"
      accessibilityLabel={`Breaking: ${headline}`}
      accessibilityHint="Opens the top story's comments">
      <BlurView intensity={40} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
      <Text style={styles.labelText} maxFontSizeMultiplier={1.2}>
        Breaking
      </Text>
      <View style={styles.divider} />
      <View style={styles.track}>
        <Animated.View style={[styles.row, scroll]}>
          <Text style={styles.headline} numberOfLines={1} maxFontSizeMultiplier={1.2} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {headline}
            {'     •     '}
          </Text>
          <Text style={styles.headline} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {headline}
            {'     •     '}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bar: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  labelText: { color: '#fff', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.2 },
  divider: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: 'rgba(255,255,255,0.45)' },
  track: { flex: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', width: 100_000 },
  headline: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '500' },
});
