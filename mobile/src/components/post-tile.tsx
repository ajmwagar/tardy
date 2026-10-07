import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Post } from '@/data/types';
import { colors, IMAGE_TRANSITION_MS, layout } from '@/theme';

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
      {uri ? <Image source={uri} recyclingKey={uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={IMAGE_TRANSITION_MS} /> : null}
      {post.article ? <View style={{ flex: 1, padding: 12, justifyContent: 'center', backgroundColor: colors.surface }}><Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>ARTICLE</Text><Text numberOfLines={5} style={{ color: colors.text, fontWeight: '700', marginTop: 8 }}>{post.article.title}</Text></View> : null}
      {post.format !== 'photo' && (
        <View style={styles.badge}>
          <Icon name={post.format === 'article' ? 'doc.text' : post.format === 'carousel' ? 'square.on.square' : 'play.fill'} size={13} color="#fff" />
        </View>
      )}
    </PressableScale>
  );
});

const styles = StyleSheet.create({ badge: { position: 'absolute', top: 6, right: 6 } });
