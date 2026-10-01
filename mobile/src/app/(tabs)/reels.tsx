import { FlashList, type ViewToken } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DoubleTapLike } from '@/components/double-tap-like';
import { BreakingTicker } from '@/components/breaking-ticker';
import { EmptyState, ErrorState, ReelSkeleton } from '@/components/states';
import { StyleChip } from '@/components/style-chip';
import { Avatar, Icon, NameLine, PressableScale, Reaction, StatusPill } from '@/components/ui';
import { VideoSurface } from '@/components/video-surface';
import type { Post } from '@/data/types';
import { api, loadFeedPage, logEngagement, toggleAlarm, toggleFollowing, toggleLiked, toggleMuted, toggleSaved, useAccount, useIsFollowing, usePostState, useStore } from '@/state/store';
import { colors } from '@/theme';

type Item = { key: string; post: Post };

/**
 * Height of the floating tab bar above the home indicator. Overlays sit just above it so
 * the caption hugs the bottom and the video keeps as much of the screen as possible.
 */
const TAB_BAR_CLEARANCE = 56;

const keyOf = (item: Item) => item.key;
/** A reel plays once 80% of it is on screen. */
const VIEWABILITY = { itemVisiblePercentThreshold: 80 };

const Reel = memo(function Reel({ post, active, height }: { post: Post; active: boolean; height: number }) {
  const insets = useSafeAreaInsets();
  const chrome = insets.bottom + TAB_BAR_CLEARANCE;
  const author = useAccount(post.authorId);
  const project = useAccount(post.projectId);
  const state = usePostState(post.id);
  const following = useIsFollowing(post.authorId);
  const muted = useStore((s) => s.muted);
  const [expanded, setExpanded] = useState(false);
  const media = post.media[0];

  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  const share = async () => {
    const r = await Share.share({ message: `${post.caption}\n\n— @${author?.handle} on Tardy` });
    if (r.action === Share.sharedAction) logEngagement({ type: 'share', postId: post.id });
  };

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <DoubleTapLike postId={post.id} onSingleTap={toggleMuted} heartSize={120}>
        <View style={{ height }}>
          {media?.type === 'video' && <VideoSurface postId={post.id} media={media} active={active} fullBleed />}
        </View>
      </DoubleTapLike>

      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.55)']} style={[styles.scrim, { height: chrome + 150 }]} />

      <View style={[styles.rail, { bottom: chrome + 8 }]}>
        <Reaction
          vertical
          size={30}
          color="#fff"
          icon="hand.thumbsup"
          label="Thumbs up"
          activeIcon="hand.thumbsup.fill"
          active={state?.liked}
          activeColor={colors.primary}
          count={state?.likeCount ?? post.likeCount}
          onPress={() => toggleLiked(post.id)}
        />
        <Reaction
          vertical
          size={29}
          color="#fff"
          icon="bubble.left"
          label="Comments"
          count={post.commentCount}
          onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}
        />
        <Reaction
          vertical
          size={29}
          color="#fff"
          icon="light.beacon.max"
          label="Ping me on status change"
          activeIcon="light.beacon.max.fill"
          active={state?.alarm}
          activeColor={colors.alarm}
          count={state?.alarmCount ?? post.alarmCount}
          onPress={() => toggleAlarm(post.id)}
        />
        <Reaction vertical size={28} color="#fff" icon="paperplane" label="Share" count={post.shareCount} onPress={share} />
        <Reaction
          vertical
          size={27}
          color="#fff"
          icon="bookmark"
          label="Save"
          activeIcon="bookmark.fill"
          active={state?.saved}
          activeColor={colors.primary}
          onPress={() => toggleSaved(post.id)}
        />
      </View>

      <View style={[styles.info, { bottom: chrome + 6 }]}>
        <View style={styles.authorRow}>
          <PressableScale onPress={openProfile} scaleTo={0.96} style={styles.authorRow}>
            <Avatar account={author} size={28} />
            <NameLine account={author} style={styles.white} />
          </PressableScale>
          {!following && (
            <PressableScale onPress={() => toggleFollowing(post.authorId)} style={styles.follow} scaleTo={0.95}>
              <Text style={styles.followText}>Follow</Text>
            </PressableScale>
          )}
        </View>
        <Text style={styles.caption} numberOfLines={expanded ? 6 : 1} onPress={() => setExpanded((e) => !e)}>
          {post.caption}
        </Text>
        <View style={styles.metaRow}>
          {post.status && <StatusPill value={post.status} compact />}
          <StyleChip style={post.style} variant="overlay" />
          {project && project.id !== post.authorId && (
            <View style={styles.chip}>
              <Icon name="folder.fill" size={10} color="#fff" />
              <Text style={styles.chipText}>{project.name}</Text>
            </View>
          )}
          {muted && (
            <View style={styles.chip}>
              <Icon name="speaker.slash.fill" size={10} color="#fff" />
              <Text style={styles.chipText}>Tap to unmute</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
});

export default function ReelsScreen() {
  const window = useWindowDimensions();
  // Size each reel to the list's real viewport (between the status bar and tab bar), not
  // the window, so paging lands exactly on item boundaries.
  const [height, setHeight] = useState(window.height);
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const trending = useStore((s) => s.trending);
  const [items, setItems] = useState<Item[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** A failed first page (full-screen retry) or next page (retry reel at the end). */
  const [error, setError] = useState<{ page: 'first' | 'next'; message: string } | null>(null);
  /** The feed loops, so this only happens when there is nothing to show at all. */
  const [exhausted, setExhausted] = useState(false);
  const cursor = useRef<string | null>(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const page = await loadFeedPage(api.reelsFeed(cursor.current));
      cursor.current = page.nextCursor;
      // The reels feed loops, so the same post can appear twice: key by position.
      setItems((prev) => [...prev, ...page.items.map((post, i) => ({ key: `${prev.length + i}:${post.id}`, post }))]);
      setExhausted(page.nextCursor === null);
      setError(null);
    } catch (e) {
      setError({ page: cursor.current === null ? 'first' : 'next', message: e instanceof Error ? e.message : String(e) });
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    setExhausted(false);
    void load();
  }, [load]);
  const chrome = insets.bottom + TAB_BAR_CLEARANCE;

  const dwell = useRef<{ id: string; at: number } | null>(null);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const top = viewableItems.find((v) => v.isViewable)?.item;
    if (!top) return;
    const now = Date.now();
    if (dwell.current && dwell.current.id !== top.post.id) {
      logEngagement({ type: 'dwell', postId: dwell.current.id, ms: now - dwell.current.at });
    }
    if (dwell.current?.id !== top.post.id) {
      dwell.current = { id: top.post.id, at: now };
      logEngagement({ type: 'video_open', postId: top.post.id });
    }
    setActiveKey(top.key);
  }, []);

  const playingKey = focused ? (activeKey ?? items[0]?.key) : null;
  const renderItem = useCallback(
    ({ item }: { item: Item }) => <Reel post={item.post} height={height} active={item.key === playingKey} />,
    [height, playingKey],
  );

  return (
    <View style={styles.screen} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {items.length === 0 ? (
        error?.page === 'first' ? (
          <ErrorState
            style={[styles.fill, { paddingBottom: chrome }]}
            title="Reels are buffering forever"
            message="The projector jammed. Your tardies' footage is fine, we just couldn't fetch it."
            detail={error.message}
            onRetry={reload}
          />
        ) : exhausted ? (
          <EmptyState
            style={[styles.fill, { paddingBottom: chrome }]}
            icon="video.badge.ellipsis"
            title="No reels yet"
            message="Nobody screen-recorded their tardy today. Bold of them."
            action={{ label: 'Check again', onPress: reload }}
          />
        ) : (
          <ReelSkeleton height={height} bottom={chrome} />
        )
      ) : (
        <FlashList
          data={items}
          keyExtractor={keyOf}
          renderItem={renderItem}
          extraData={`${activeKey}-${focused}`}
          pagingEnabled
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            // Paused while an error shows, so a dead network doesn't retry on every swipe.
            if (!error && !exhausted) void load();
          }}
          ListFooterComponent={
            error?.page === 'next' ? (
              <ErrorState
                style={[styles.fill, { height, paddingBottom: chrome }]}
                title="End of the reel (for now)"
                message="Couldn't load the next batch. Everything you've watched is still above."
                detail={error.message}
                onRetry={() => void load()}
              />
            ) : null
          }
          onEndReachedThreshold={3}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          drawDistance={height}
        />
      )}
      <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top }]}>
        <BreakingTicker posts={trending} />
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topBar: { position: 'absolute', left: 0, right: 0 },
  rail: { position: 'absolute', right: 8, alignItems: 'center', gap: 18 },
  info: { position: 'absolute', left: 12, right: 70, gap: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  white: { color: '#fff', ...shadow },
  follow: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.primary },
  followText: { color: colors.onPrimary, fontSize: 12, fontWeight: '800' },
  caption: { color: '#fff', fontSize: 14, lineHeight: 19, ...shadow },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    maxWidth: 220,
  },
  chipText: { color: '#fff', fontSize: 11.5, fontWeight: '600' },
});
