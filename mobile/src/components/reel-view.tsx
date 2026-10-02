import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSoundPlays } from '@/audio/use-sound-plays';
import type { Post } from '@/data/types';
import { fitFor, mediaRatio } from '@/media/aspect';
import { toggleAlarm, toggleFollowing, toggleLiked, toggleMuted, toggleRepost, toggleSaved, useAccount, useIsFollowing, usePostState, useStore } from '@/state/store';
import { colors } from '@/theme';

import { DoubleTapLike } from './double-tap-like';
import { StyleChip } from './style-chip';
import { Avatar, Icon, NameLine, PressableScale, Reaction, StatusPill } from './ui';
import { VideoSurface } from './video-surface';

const TAB_BAR_CLEARANCE = 56;
const shadow = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

/** The shared full-screen Tardy reel surface used by the Reels tab and direct post viewer. */
export const ReelView = memo(function ReelView({ post, active, height, insideTabs = false }: { post: Post; active: boolean; height: number; insideTabs?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chrome = insets.bottom + (insideTabs ? TAB_BAR_CLEARANCE : 0);
  const author = useAccount(post.authorId);
  const project = useAccount(post.projectId);
  const state = usePostState(post.id);
  const following = useIsFollowing(post.authorId);
  const muted = useStore((s) => s.muted);
  const [expanded, setExpanded] = useState(false);
  const media = post.media[0];
  useSoundPlays(post, active, muted);

  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  const share = () => router.push({ pathname: '/share', params: { postId: post.id } });

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <DoubleTapLike postId={post.id} onSingleTap={toggleMuted} singleTapIcon={muted ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} heartSize={148}>
        <View style={{ height }}>
          {media?.type === 'video' && (
            <VideoSurface postId={post.id} media={media} active={active} fullBleed contentFit={fitFor(mediaRatio(media), width / height)} />
          )}
        </View>
      </DoubleTapLike>

      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.72)']} style={[styles.scrim, { height: chrome + (expanded ? height * 0.58 : 190) }]} />

      <View style={[styles.rail, { bottom: chrome + 8 }]}>
        <Reaction vertical size={30} color="#fff" icon="hand.thumbsup" label="Thumbs up" activeIcon="hand.thumbsup.fill" active={state?.liked} activeColor={colors.primary} count={state?.likeCount ?? post.likeCount} onPress={() => toggleLiked(post.id)} />
        <Reaction vertical size={29} color="#fff" icon="bubble.left" label="Comments" count={state?.commentCount ?? post.commentCount} onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })} />
        <Reaction vertical size={28} color="#fff" icon="arrow.2.squarepath" label="Repost" activeIcon="arrow.2.squarepath" active={state?.reposted} activeColor={colors.repost} count={state?.repostCount ?? post.repostCount} onPress={() => toggleRepost(post.id)} />
        <Reaction vertical size={29} color="#fff" icon="light.beacon.max" label="Ping me on status change" activeIcon="light.beacon.max.fill" active={state?.alarm} activeColor={colors.alarm} count={state?.alarmCount ?? post.alarmCount} onPress={() => toggleAlarm(post.id)} />
        <Reaction vertical size={28} color="#fff" icon="paperplane" label="Share" count={post.shareCount} onPress={share} />
        <Reaction vertical size={27} color="#fff" icon="bookmark" label="Save" activeIcon="bookmark.fill" active={state?.saved} activeColor={colors.primary} onPress={() => toggleSaved(post.id)} />
      </View>

      <View style={[styles.info, { bottom: chrome + 6 }]}>
        <View style={styles.authorRow}>
          <PressableScale onPress={openProfile} scaleTo={0.96} style={styles.authorRow}>
            <Avatar account={author} size={28} />
            <NameLine account={author} style={styles.white} />
          </PressableScale>
          {!following && <PressableScale onPress={() => toggleFollowing(post.authorId)} style={styles.follow} scaleTo={0.95}><Text style={styles.followText}>Follow</Text></PressableScale>}
        </View>
        {expanded ? (
          <ScrollView style={[styles.expandedCaption, { maxHeight: height * 0.42 }]} nestedScrollEnabled showsVerticalScrollIndicator>
            <Text style={styles.caption} onPress={() => setExpanded(false)}>{post.caption}</Text>
          </ScrollView>
        ) : (
          <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" accessibilityLabel="Read full caption">
            <Text style={styles.caption} numberOfLines={2}>{post.caption} <Text style={styles.more}>more</Text></Text>
          </Pressable>
        )}
        {post.sound && (
          <Pressable style={styles.sound} onPress={() => router.push({ pathname: '/sounds', params: { trackId: post.sound!.trackId } })} accessibilityRole="button" accessibilityLabel={`Sound: ${post.sound.title} by ${post.sound.artistName}. See trending sounds`}>
            <Icon name="music.note" size={12} color="#fff" />
            <Text style={styles.soundText} numberOfLines={1}>{post.sound.title} · {post.sound.attribution ?? post.sound.artistName}</Text>
          </Pressable>
        )}
        <View style={styles.metaRow}>
          {post.status && <StatusPill value={post.status} compact />}
          <StyleChip style={post.style} variant="overlay" />
          {project && project.id !== post.authorId && <View style={styles.chip}><Icon name="folder.fill" size={10} color="#fff" /><Text style={styles.chipText}>{project.name}</Text></View>}
          {muted && <View style={styles.chip}><Icon name="speaker.slash.fill" size={10} color="#fff" /><Text style={styles.chipText}>Tap to unmute</Text></View>}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  rail: { position: 'absolute', right: 8, alignItems: 'center', gap: 18 },
  info: { position: 'absolute', left: 12, right: 70, gap: 7 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  white: { color: '#fff', ...shadow },
  follow: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.primary },
  followText: { color: colors.onPrimary, fontSize: 12, fontWeight: '800' },
  caption: { color: '#fff', fontSize: 14, lineHeight: 20, ...shadow },
  expandedCaption: { flexGrow: 0, paddingRight: 4 },
  more: { color: colors.textSecondary, fontWeight: '700' },
  sound: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '85%' },
  soundText: { color: '#fff', fontSize: 13, fontWeight: '600', ...shadow },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)', maxWidth: 220 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600', ...shadow },
});
