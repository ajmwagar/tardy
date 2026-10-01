import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Post } from '@/data/types';
import { IMAGE_TRANSITION_MS, layout } from '@/theme';

import { Icon, PressableScale } from './ui';

/** A tardy as a grid tile (profiles, Search): its first frame, a badge for carousels and video. */
export const PostTile = memo(function PostTile({ post, size }: { post: Post; size: number }) {
  const media = post.media[0];
  const uri = media?.type === 'video' ? media.posterUrl : media?.url;
  return (
    <PressableScale
      scaleTo={0.97}
      style={{ width: size, height: size / layout.gridTileAspect }}
      onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: post.id } })}
      accessibilityRole="button"
      accessibilityLabel={post.caption}>
      <Image source={uri} recyclingKey={uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={IMAGE_TRANSITION_MS} />
      {post.format !== 'photo' && (
        <View style={styles.badge}>
          <Icon name={post.format === 'carousel' ? 'square.on.square' : 'play.fill'} size={13} color="#fff" />
        </View>
      )}
    </PressableScale>
  );
});

const styles = StyleSheet.create({ badge: { position: 'absolute', top: 6, right: 6 } });
