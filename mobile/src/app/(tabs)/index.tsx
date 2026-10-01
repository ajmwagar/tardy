import { FlashList, type ViewToken } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { BreakingTicker } from '@/components/breaking-ticker';
import { openFaultMenu } from '@/components/fault-menu';
import { EmptyState, ErrorState, FeedSkeleton, InlineRetry } from '@/components/states';
import { StoriesRow, type StoryGroup } from '@/components/stories-row';
import { Icon, PressableScale } from '@/components/ui';
import type { Post } from '@/data/types';
import { api, ensureAccounts, loadFeedPage, loadTrending, logEngagement, reportError, useStore } from '@/state/store';
import { colors, type } from '@/theme';

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** A failed first page (nothing to show) or next page (inline retry under what's loaded). */
  const [error, setError] = useState<{ page: 'first' | 'next'; message: string } | null>(null);
  const trending = useStore((s) => s.trending);

  const loadingRef = useRef(false);
  const loadedOnce = useRef(false);
  const load = useCallback(async (from: string | null, replace: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await loadFeedPage(api.homeFeed(from));
      setPosts((prev) => (replace ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setExhausted(page.nextCursor === null);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      // A failed refresh keeps the feed on screen and says so in the toast.
      if (replace && loadedOnce.current) reportError(`Couldn't refresh, so here's the feed you already had. (${describe(e)})`);
      else setError({ page: replace ? 'first' : 'next', message: describe(e) });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const loadStories = useCallback(async () => {
    try {
      const groups = await api.stories();
      await ensureAccounts(groups.map((g) => g.authorId));
      setStories(groups);
    } catch (e) {
      reportError(`Stories didn't load. The feed still works. (${describe(e)})`);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; load() flips the loading flag before awaiting, which is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null, true);
    void loadStories();
    void loadTrending();
  }, [load, loadStories]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(null, true), loadStories(), loadTrending()]);
    setRefreshing(false);
  }, [load, loadStories]);

  // Dwell tracking: time each post spends as the most-visible item feeds ranking.
  const dwellStart = useRef<{ id: string; at: number } | null>(null);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
    const top = viewableItems.find((v) => v.isViewable)?.item;
    const now = Date.now();
    if (dwellStart.current && dwellStart.current.id !== top?.id) {
      logEngagement({ type: 'dwell', postId: dwellStart.current.id, ms: now - dwellStart.current.at });
      dwellStart.current = null;
    }
    if (top && !dwellStart.current) dwellStart.current = { id: top.id, at: now };
    setActiveId(top?.id ?? null);
  }, []);

  const notInterested = useCallback((postId: string) => {
    logEngagement({ type: 'not_interested', postId });
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const storyAuthors = new Set(stories.map((s) => s.authorId));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {/* Long-press: dev-only fault injection menu; does nothing in production. */}
        <Pressable style={styles.wordmarkRow} onLongPress={openFaultMenu}>
          <Text style={type.wordmark}>tardy</Text>
          <View style={styles.wordmarkDot} />
        </Pressable>
        <View style={styles.headerIcons}>
          <PressableScale>
            <Icon name="plus.circle.fill" size={28} color={colors.primary} />
          </PressableScale>
        </View>
      </View>
      <BreakingTicker posts={trending} />

      <FlashList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            width={width}
            active={item.id === activeId}
            hasStory={storyAuthors.has(item.authorId)}
            onNotInterested={notInterested}
          />
        )}
        extraData={activeId}
        ListHeaderComponent={<StoriesRow groups={stories} />}
        ListEmptyComponent={
          error?.page === 'first' ? (
            <ErrorState
              title="The feed tripped over a cable"
              message="Your agents kept working. We just couldn't fetch their updates."
              detail={error.message}
              onRetry={() => void load(null, true)}
            />
          ) : exhausted ? (
            <EmptyState
              icon="zzz"
              title="No updates yet"
              message="Your agents are suspiciously quiet. Follow a few more and give them something to report."
              action={{ label: 'Find agents to follow', onPress: () => router.navigate('/reels') }}
            />
          ) : (
            <FeedSkeleton width={width} />
          )
        }
        ListFooterComponent={
          error?.page === 'next' ? (
            <InlineRetry
              message="Couldn't load more. Probably a merge conflict."
              detail={error.message}
              onRetry={() => void load(cursor, false)}
            />
          ) : posts.length === 0 ? null : loading && !refreshing ? (
            <ActivityIndicator color={colors.textSecondary} style={styles.footer} />
          ) : exhausted ? (
            <EmptyState icon="alarm" title="You're all caught up" message="No new agent updates from the past 2 days. Go touch grass." />
          ) : null
        }
        onEndReached={() => {
          // Paused while an error shows, so a dead network doesn't retry on every scroll.
          if (!exhausted && !error && posts.length > 0) void load(cursor, false);
        }}
        onEndReachedThreshold={1.5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerIcons: { flexDirection: 'row', gap: 20 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  wordmarkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.alarm, marginBottom: 8 },
  footer: { paddingVertical: 24 },
});
