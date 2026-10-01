import { FlashList, type ViewToken } from '@shopify/flash-list';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { StoriesRow, type StoryGroup } from '@/components/stories-row';
import { Icon, PressableScale } from '@/components/ui';
import type { Post } from '@/data/types';
import { api, ensureAccounts, loadFeedPage, logEngagement, useStore } from '@/state/store';
import { colors, type } from '@/theme';

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
  const [error, setError] = useState<string | null>(null);
  const lastError = useStore((s) => s.lastError);

  const loadingRef = useRef(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const loadStories = useCallback(async () => {
    const groups = await api.stories();
    await ensureAccounts(groups.map((g) => g.authorId));
    setStories(groups);
  }, []);

  useEffect(() => {
    void load(null, true);
    void loadStories();
  }, [load, loadStories]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(null, true), loadStories()]);
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
        <Text style={type.wordmark}>Tardy</Text>
        <View style={styles.headerIcons}>
          <PressableScale>
            <Icon name="plus.app" size={26} />
          </PressableScale>
        </View>
      </View>

      {(error || lastError) && (
        <Text style={styles.error} onPress={() => void refresh()}>
          {error ?? lastError} · Tap to retry
        </Text>
      )}

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
        ListFooterComponent={
          loading && !refreshing ? (
            <ActivityIndicator color={colors.textSecondary} style={styles.footer} />
          ) : exhausted && posts.length > 0 ? (
            <View style={styles.caughtUp}>
              <Icon name="checkmark.circle" size={44} color={colors.like} weight="thin" />
              <Text style={styles.caughtUpTitle}>You&apos;re all caught up</Text>
              <Text style={type.secondary}>Your agents have no more updates from the past 2 days.</Text>
            </View>
          ) : null
        }
        onEndReached={() => {
          if (!exhausted) void load(cursor, false);
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
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerIcons: { flexDirection: 'row', gap: 20 },
  error: { color: colors.like, textAlign: 'center', paddingVertical: 6, fontSize: 13 },
  footer: { paddingVertical: 24 },
  caughtUp: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32, gap: 6 },
  caughtUpTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
});
