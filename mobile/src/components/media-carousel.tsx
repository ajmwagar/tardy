import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { MediaItem } from '@/data/types';
import { logEngagement, toggleMuted, useStore } from '@/state/store';
import { feedFrameRatio, fitFor, mediaRatio } from '@/media/aspect';
import { colors, IMAGE_TRANSITION_MS } from '@/theme';

import { DoubleTapLike } from './double-tap-like';
import { Icon } from './ui';
import { VideoSurface } from './video-surface';

/**
 * Feed media at its real shape: the frame follows the first item (4:5 tall to 1.91:1 wide,
 * see `media/aspect.ts`), and an item that doesn't fit the frame is shown whole over a blurred
 * copy of itself instead of being cropped.
 */
function Backdrop({ uri }: { uri: string }) {
  return (
    <Image
      source={uri}
      style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.2 }] }]}
      contentFit="cover"
      blurRadius={30}
      cachePolicy="memory-disk"
      accessible={false}
    />
  );
}

export const MediaCarousel = memo(function MediaCarousel({
  postId,
  media,
  width,
  active,
  onIndexChange,
}: {
  postId: string;
  media: MediaItem[];
  width: number;
  /** Whether this post is the one on screen; only then does video play. */
  active: boolean;
  onIndexChange?: (index: number) => void;
}) {
  const frame = feedFrameRatio(media);
  const height = width / frame;
  const [index, setIndex] = useState(0);
  const muted = useStore((s) => s.muted);
  const hasVideo = media.some((m) => m.type === 'video');

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== index) {
        setIndex(next);
        onIndexChange?.(next);
        logEngagement({ type: 'photo_expand', postId });
      }
    },
    [index, onIndexChange, postId, width],
  );

  const renderItem = useCallback(
    ({ item, index: i }: { item: MediaItem; index: number }) => (
      <View style={{ width, height, backgroundColor: colors.surface, overflow: 'hidden' }}>
        {fitFor(mediaRatio(item), frame) === 'contain' && <Backdrop uri={item.type === 'image' ? item.url : item.posterUrl} />}
        {item.type === 'image' ? (
          <Image
            source={item.url}
            recyclingKey={item.url}
            style={StyleSheet.absoluteFill}
            contentFit={fitFor(mediaRatio(item), frame)}
            cachePolicy="memory-disk"
            transition={IMAGE_TRANSITION_MS}
            priority={i === 0 ? 'high' : 'normal'}
          />
        ) : (
          <VideoSurface postId={postId} media={item} active={active && i === index} contentFit={fitFor(mediaRatio(item), frame)} />
        )}
      </View>
    ),
    [active, frame, height, index, postId, width],
  );

  return (
    <DoubleTapLike postId={postId} onSingleTap={hasVideo ? toggleMuted : undefined}>
      {media.length === 1 ? (
        renderItem({ item: media[0], index: 0 })
      ) : (
        <FlatList
          data={media}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(m, i) => `${i}-${m.url}`}
          renderItem={renderItem}
          onMomentumScrollEnd={onScrollEnd}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          initialNumToRender={2}
          windowSize={3}
          style={{ width, height }}
        />
      )}

      {media.length > 1 && (
        <View style={styles.counter} pointerEvents="none">
          <Text style={styles.counterText}>
            {index + 1}/{media.length}
          </Text>
        </View>
      )}
      {hasVideo && (
        <View style={styles.mute} pointerEvents="none">
          <Icon name={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size={12} color="#fff" />
        </View>
      )}
    </DoubleTapLike>
  );
});

/**
 * The dot row under a carousel, in its own line between the media and the action row (the
 * action row is full now that it shows counts). Active dot in Tardy yellow.
 */
export function CarouselDots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  return (
    <View style={styles.dots} accessibilityLabel={`Photo ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  counter: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(18,18,18,0.75)',
  },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  mute: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,18,18,0.75)',
  },
  dots: { flexDirection: 'row', gap: 4, justifyContent: 'center', paddingTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textTertiary },
  dotActive: { backgroundColor: colors.primary },
});
