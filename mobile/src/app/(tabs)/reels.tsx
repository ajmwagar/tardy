import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSoundPlays } from '@/audio/use-sound-plays';
import { fitFor, mediaRatio } from '@/media/aspect';

import { DoubleTapLike } from '@/components/double-tap-like';
import { ActivityButton } from '@/components/activity-button';
import { BreakingTicker } from '@/components/breaking-ticker';
import { EmptyState, ErrorState, ReelSkeleton } from '@/components/states';
import { StyleChip } from '@/components/style-chip';
import { Avatar, Icon, NameLine, PressableScale, Reaction, StatusPill } from '@/components/ui';
import { VideoSurface } from '@/components/video-surface';
import type { Post } from '@/data/types';
import { api, ensureAccounts, ingestPosts, loadFeedPage, logEngagement, toggleAlarm, toggleFollowing, toggleLiked, toggleMuted, toggleRepost, toggleSaved, useAccount, useIsFollowing, usePostState, useStore } from '@/state/store';
import { colors } from '@/theme';
import { useRefresh } from '@/components/use-refresh';
import { freshReelOrder } from '@/reels/refresh';

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
  const { width } = useWindowDimensions();
  const chrome = insets.bottom + TAB_BAR_CLEARANCE;
  const author = useAccount(post.authorId);
  const project = useAccount(post.projectId);
  const state = usePostState(post.id);
  const following = useIsFollowing(post.authorId);
  const muted = useStore((s) => s.muted);
  const [expanded, setExpanded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [lockedSpeed, setLockedSpeed] = useState<2 | 4 | null>(null);
  const media = post.media[0];
  useSoundPlays(post, active, muted);

  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  const share = () => router.push({ pathname: '/share', params: { postId: post.id } });
  const previewSpeed = useCallback((nextSpeed: 2 | 4) => {
    if (!active) return;
    setSpeed(nextSpeed);
  }, [active]);
  const finishSpeed = useCallback((nextLockedSpeed: 2 | 4 | null) => {
    setLockedSpeed(nextLockedSpeed);
    setSpeed(nextLockedSpeed ?? lockedSpeed ?? 1);
  }, [lockedSpeed]);
  const unlockSpeed = useCallback(() => {
    setLockedSpeed(null);
    setSpeed(1);
  }, []);
  useEffect(() => {
    // Reset after the active reel changes without synchronously cascading another render.
    const frame = requestAnimationFrame(unlockSpeed);
    return () => cancelAnimationFrame(frame);
  }, [active, unlockSpeed]);

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <DoubleTapLike
        postId={post.id}
        onSingleTap={toggleMuted}
        singleTapIcon={muted ? 'speaker.wave.2.fill' : 'speaker.slash.fill'}
        onHoldSpeed={previewSpeed}
        onHoldEnd={finishSpeed}
        heartSize={148}>
        <View style={{ height }}>
          {media?.type === 'video' && (
            // Fill when the video's shape is close to the screen's, else show it whole over the blur
            // (landscape reels, iPads). The native player applies the same rule on its own.
            <VideoSurface postId={post.id} media={media} active={active} fullBleed playbackRate={speed} contentFit={fitFor(mediaRatio(media), width / height)} />
          )}
        </View>
      </DoubleTapLike>

      {speed > 1 ? (
        <Pressable onPress={lockedSpeed ? unlockSpeed : undefined} disabled={!lockedSpeed} style={styles.speedBadge} accessibilityRole={lockedSpeed ? 'button' : undefined} accessibilityLabel={lockedSpeed ? `Unlock ${speed} times playback` : undefined}>
          <Text style={styles.speedText}>{speed}×{lockedSpeed ? '  LOCKED' : ''}</Text>
          {!lockedSpeed ? <Text style={styles.speedHint}>↑ 4× lock   ↓ 2× lock</Text> : null}
        </Pressable>
      ) : null}

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
          count={state?.commentCount ?? post.commentCount}
          onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}
        />
        <Reaction
          vertical
          size={28}
          color="#fff"
          icon="arrow.2.squarepath"
          label="Repost"
          activeIcon="arrow.2.squarepath"
          active={state?.reposted}
          activeColor={colors.repost}
          count={state?.repostCount ?? post.repostCount}
          onPress={() => toggleRepost(post.id)}
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
          <Pressable
            style={styles.sound}
            onPress={() => router.push({ pathname: '/sounds', params: { trackId: post.sound!.trackId } })}
            accessibilityRole="button"
            accessibilityLabel={`Sound: ${post.sound.title} by ${post.sound.artistName}. See trending sounds`}>
            <Icon name="music.note" size={12} color="#fff" />
            <Text style={styles.soundText} numberOfLines={1}>
              {post.sound.title} · {post.sound.attribution ?? post.sound.artistName}
            </Text>
          </Pressable>
        )}
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
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const listRef = useRef<FlashListRef<Item>>(null);
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
    if (!postId) {
      void load();
      return;
    }
    let live = true;
    loading.current = true;
    void Promise.all([api.post(postId), loadFeedPage(api.reelsFeed(null))])
      .then(async ([requested, page]) => {
        await ensureAccounts([requested.authorId, requested.projectId, ...(requested.collaboratorIds ?? [])]);
        ingestPosts([requested]);
        if (!live) return;
        const ordered = [requested, ...page.items.filter((post) => post.id !== requested.id)];
        cursor.current = page.nextCursor;
        setItems(ordered.map((post, index) => ({ key: `opened:${postId}:${index}:${post.id}`, post })));
        setActiveKey(null);
        setExhausted(page.nextCursor === null);
        setError(null);
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      })
      .catch((error: unknown) => {
        if (live) setError({ page: 'first', message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        loading.current = false;
      });
    return () => {
      live = false;
    };
  }, [load, postId]);

  const reload = useCallback(() => {
    setExhausted(false);
    void load();
  }, [load]);
  const { refreshing, onRefresh } = useRefresh(
    useCallback(async () => {
      const previousId = items.find((item) => item.key === activeKey)?.post.id ?? items[0]?.post.id;
      const page = await loadFeedPage(api.reelsFeed(null));
      const fresh = freshReelOrder(page.items, previousId);
      cursor.current = page.nextCursor;
      setItems(fresh.map((post, index) => ({ key: `refresh:${Date.now()}:${index}:${post.id}`, post })));
      setActiveKey(null);
      setExhausted(page.nextCursor === null);
      setError(null);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, [activeKey, items]),
  );
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
            message="The projector jammed. Your agents' footage is fine, we just couldn't fetch it."
            detail={error.message}
            onRetry={reload}
          />
        ) : exhausted ? (
          <EmptyState
            style={[styles.fill, { paddingBottom: chrome }]}
            icon="video.badge.ellipsis"
            title="No reels yet"
            message="Nobody screen-recorded their agent today. Bold of them."
            action={{ label: 'Check again', onPress: reload }}
          />
        ) : (
          <ReelSkeleton height={height} bottom={chrome} />
        )
      ) : (
        <FlashList
          ref={listRef}
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        />
      )}
      <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top }]}>
        <BreakingTicker posts={trending} inline />
        <ActivityButton color="#fff" badgeBorder="#000" />
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  speedBadge: { position: 'absolute', top: '44%', alignSelf: 'center', minWidth: 72, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.68)' },
  speedText: { color: '#fff', fontSize: 19, fontWeight: '900', letterSpacing: 0.4 },
  speedHint: { color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: '800', marginTop: 2 },
  topBar: { position: 'absolute', left: 0, right: 0, height: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  rail: { position: 'absolute', right: 8, alignItems: 'center', gap: 18 },
  info: { position: 'absolute', left: 12, right: 70, gap: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  white: { color: '#fff', ...shadow },
  follow: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.primary },
  followText: { color: colors.onPrimary, fontSize: 12, fontWeight: '800' },
  caption: { color: '#fff', fontSize: 14, lineHeight: 19, ...shadow },
  expandedCaption: { flexGrow: 0, paddingRight: 4 },
  more: { color: colors.textSecondary, fontWeight: '700' },
  sound: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '85%' },
  soundText: { color: '#fff', fontSize: 13, fontWeight: '600', ...shadow },
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
