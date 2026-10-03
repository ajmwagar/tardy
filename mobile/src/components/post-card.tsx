import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { memo, useState } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Post } from '@/data/types';
import {
  logEngagement,
  toggleAlarm,
  toggleFollowing,
  toggleLiked,
  toggleRepost,
  toggleSaved,
  useAccount,
  useIsFollowing,
  usePostState,
} from '@/state/store';
import { colors, layout, radius, timeAgo } from '@/theme';

import { CollabHeader } from './collab';
import { CarouselDots, MediaCarousel } from './media-carousel';
import { StyleChip } from './style-chip';
import { Avatar, Icon, IconButton, NameLine, PressableScale, Reaction, StatusPill } from './ui';

/** Cards float with a gutter so the feed reads as a stack of updates, not a photo wall. */
export const CARD_GUTTER = layout.cardGutter;

const LINK_ICONS = {
  pull_request: 'arrow.triangle.pull',
  commit: 'smallcircle.filled.circle',
  issue: 'exclamationmark.circle',
  deploy: 'shippingbox',
  other: 'link',
} as const;

export const PostCard = memo(function PostCard({
  post,
  width,
  active,
  hasStory,
  onNotInterested,
}: {
  post: Post;
  width: number;
  active: boolean;
  hasStory: boolean;
  onNotInterested: (postId: string) => void;
}) {
  const author = useAccount(post.authorId);
  const project = useAccount(post.projectId);
  const state = usePostState(post.id);
  const following = useIsFollowing(post.authorId);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const liked = state?.liked ?? post.viewerHasLiked;
  const saved = state?.saved ?? post.viewerHasSaved;
  const likeCount = state?.likeCount ?? post.likeCount;
  const alarm = state?.alarm ?? post.viewerHasAlarm;
  const alarmCount = state?.alarmCount ?? post.alarmCount;
  const reposted = state?.reposted ?? post.viewerHasReposted;
  const repostCount = state?.repostCount ?? post.repostCount;
  const mediaWidth = width - CARD_GUTTER * 2;

  const openProfile = () => {
    if (!author) return;
    logEngagement({ type: 'profile_click', postId: post.id });
    router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  };
  const openComments = () => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } });
  const openReel = () => router.push({ pathname: '/(tabs)/reels', params: { postId: post.id } });
  const share = () => router.push({ pathname: '/share', params: { postId: post.id } });
  const more = () => {
    const canFollow = !author?.ownedByViewer;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: canFollow
          ? ['Cancel', 'Not interested', following ? 'Unfollow' : 'Follow', 'Copy link']
          : ['Cancel', 'Not interested', 'Copy link'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 0,
      },
      (i) => {
        if (i === 1) onNotInterested(post.id);
        if (canFollow && i === 2) void toggleFollowing(post.authorId);
        if ((canFollow && i === 3) || (!canFollow && i === 2)) logEngagement({ type: 'share_via_copy_link', postId: post.id });
      },
    );
  };

  const subtitle = project && project.id !== post.authorId ? project.name : author?.model;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {post.collaboratorIds?.length ? (
          <CollabHeader post={post} subtitle={subtitle} />
        ) : (
          <>
            <Pressable onPress={openProfile} accessibilityRole="button" accessibilityLabel={`${author?.handle ?? 'Author'}, open profile`}>
              <Avatar account={author} size={32} ring={hasStory ? 'unseen' : 'none'} />
            </Pressable>
            <Pressable onPress={openProfile} style={styles.headerText} accessible={false}>
              <NameLine account={author} />
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </Pressable>
          </>
        )}
        {author?.ownedByViewer ? (
          <View style={styles.followButton} accessibilityLabel={`${author.handle} is claimed by you`}>
            <Text style={styles.followText}>Claimed</Text>
          </View>
        ) : !following && (
          <PressableScale
            onPress={() => toggleFollowing(post.authorId)}
            style={styles.followButton}
            scaleTo={0.95}
            accessibilityRole="button"
            accessibilityLabel={`Follow ${author?.handle ?? ''}`}>
            <Text style={styles.followText}>Follow</Text>
          </PressableScale>
        )}
        <IconButton icon="ellipsis" size={18} label="More options" onPress={more} style={styles.moreButton} />
      </View>

      <View style={styles.media}>
        <MediaCarousel
          postId={post.id}
          media={post.media}
          width={mediaWidth}
          active={active}
          onIndexChange={setIndex}
          onSingleTap={post.format === 'reel' ? openReel : undefined}
        />
      </View>
      <CarouselDots count={post.media.length} index={index} />

      <View style={styles.actions}>
        <View style={styles.actionGroup}>
          <Reaction
            icon="hand.thumbsup"
          label="Thumbs up"
            activeIcon="hand.thumbsup.fill"
            active={liked}
            activeColor={colors.primary}
            count={likeCount}
            onPress={() => toggleLiked(post.id)}
          />
          <Reaction icon="bubble.left" label="Comments" count={state?.commentCount ?? post.commentCount} onPress={openComments} />
          <Reaction
            icon="arrow.2.squarepath"
            label="Repost"
            activeIcon="arrow.2.squarepath"
            active={reposted}
            activeColor={colors.repost}
            count={repostCount}
            onPress={() => toggleRepost(post.id)}
          />
          <Reaction
            icon="light.beacon.max"
          label="Ping me on status change"
            activeIcon="light.beacon.max.fill"
            active={alarm}
            activeColor={colors.alarm}
            count={alarmCount}
            onPress={() => toggleAlarm(post.id)}
          />
          <Reaction icon="paperplane" label="Share" onPress={share} />
        </View>
        <Reaction icon="bookmark" label="Save" activeIcon="bookmark.fill" active={saved} activeColor={colors.primary} onPress={() => toggleSaved(post.id)} />
      </View>

      <View style={styles.body}>
        <Text style={styles.caption} numberOfLines={expanded ? undefined : 2} onPress={() => setExpanded(true)}>
          <Text style={styles.captionHandle} onPress={openProfile}>
            {author?.handle}{' '}
          </Text>
          {post.caption}
        </Text>

        {(post.status || post.style || post.links.length > 0) && (
          <View style={styles.meta}>
            {post.status && <StatusPill value={post.status} />}
            <StyleChip style={post.style} variant="card" />
            {post.links.map((link) => (
              <PressableScale
                key={link.url + link.label}
                scaleTo={0.95}
                style={styles.linkChip}
                onPress={() => {
                  logEngagement({ type: 'open_link', postId: post.id });
                  void WebBrowser.openBrowserAsync(link.url);
                }}>
                <Icon name={LINK_ICONS[link.kind]} size={11} color={colors.textSecondary} />
                <Text style={styles.linkText}>{link.label}</Text>
              </PressableScale>
            ))}
          </View>
        )}

        <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: CARD_GUTTER,
    marginBottom: 10,
    paddingBottom: 14,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  media: { marginHorizontal: 0, borderRadius: radius.media, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  headerText: { flex: 1, justifyContent: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  // A 44pt target that keeps the header at the avatar's height and the glyph on the padding line.
  moreButton: { marginVertical: -6, marginRight: -12 },
  followButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
  followText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10 },
  actionGroup: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  body: { paddingHorizontal: 12, paddingTop: 8, gap: 5 },
  caption: { color: colors.text, fontSize: 14, lineHeight: 19 },
  captionHandle: { fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.elevated,
  },
  linkText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  time: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
});
