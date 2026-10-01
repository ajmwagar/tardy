import { FlashList, type ViewToken } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DoubleTapLike } from '@/components/double-tap-like';
import { Avatar, Icon, NameLine, PressableScale, StatusPill } from '@/components/ui';
import { VideoSurface } from '@/components/video-surface';
import type { Post } from '@/data/types';
import { api, loadFeedPage, logEngagement, toggleFollowing, toggleLiked, toggleMuted, toggleSaved, useAccount, useIsFollowing, usePostState, useStore } from '@/state/store';
import { colors, compact } from '@/theme';

type Item = { key: string; post: Post };

const TAB_BAR_HEIGHT = 82;

const Reel = memo(function Reel({ post, active, height }: { post: Post; active: boolean; height: number }) {
  const insets = useSafeAreaInsets();
  // The native video layer stops at the safe area; keep overlays above the tab bar.
  const chrome = insets.bottom + TAB_BAR_HEIGHT;
  const author = useAccount(post.authorId);
  const project = useAccount(post.projectId);
  const state = usePostState(post.id);
  const following = useIsFollowing(post.authorId);
  const muted = useStore((s) => s.muted);
  const [expanded, setExpanded] = useState(false);
  const media = post.media[0];

  const liked = state?.liked ?? false;
  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <DoubleTapLike postId={post.id} onSingleTap={toggleMuted} heartSize={120}>
        <View style={{ height }}>
          {media?.type === 'video' && <VideoSurface postId={post.id} media={media} active={active} />}
        </View>
      </DoubleTapLike>

      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.65)']} style={styles.scrim} />

      <View style={[styles.rail, { bottom: chrome + 20 }]}>
        <RailButton
          icon={liked ? 'heart.fill' : 'heart'}
          color={liked ? colors.like : '#fff'}
          label={compact(state?.likeCount ?? post.likeCount)}
          onPress={() => {
            void Haptics.selectionAsync();
            void toggleLiked(post.id);
          }}
        />
        <RailButton
          icon="bubble.right"
          label={compact(post.commentCount)}
          onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}
        />
        <RailButton
          icon="paperplane"
          label={compact(post.shareCount)}
          onPress={async () => {
            const r = await Share.share({ message: `${post.caption}\n\n— @${author?.handle} on Tardy` });
            if (r.action === Share.sharedAction) logEngagement({ type: 'share', postId: post.id });
          }}
        />
        <RailButton icon={state?.saved ? 'bookmark.fill' : 'bookmark'} onPress={() => toggleSaved(post.id)} />
        <PressableScale onPress={openProfile} style={styles.railAvatar}>
          <Avatar account={author} size={30} />
        </PressableScale>
      </View>

      <View style={[styles.info, { bottom: chrome + 14 }]}>
        <View style={styles.authorRow}>
          <PressableScale onPress={openProfile} scaleTo={0.96} style={styles.authorRow}>
            <Avatar account={author} size={32} />
            <NameLine account={author} style={styles.white} />
          </PressableScale>
          {!following && (
            <PressableScale onPress={() => toggleFollowing(post.authorId)} style={styles.follow} scaleTo={0.95}>
              <Text style={styles.followText}>Follow</Text>
            </PressableScale>
          )}
        </View>
        <Text style={styles.caption} numberOfLines={expanded ? 6 : 2} onPress={() => setExpanded((e) => !e)}>
          {post.caption}
        </Text>
        <View style={styles.metaRow}>
          {post.status && <StatusPill value={post.status} compact />}
          {project && project.id !== post.authorId && (
            <View style={styles.projectChip}>
              <Icon name="folder.fill" size={10} color="#fff" />
              <Text style={styles.projectText}>{project.name}</Text>
            </View>
          )}
          <View style={styles.projectChip}>
            <Icon name={muted ? 'speaker.slash.fill' : 'music.note'} size={10} color="#fff" />
            <Text style={styles.projectText} numberOfLines={1}>
              {muted ? 'Tap to unmute' : `Original audio · ${author?.handle ?? ''}`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

function RailButton({ icon, label, color = '#fff', onPress }: { icon: Parameters<typeof Icon>[0]['name']; label?: string; color?: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.railButton} scaleTo={0.8}>
      <Icon name={icon} size={29} color={color} />
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
    </PressableScale>
  );
}

export default function ReelsScreen() {
  const window = useWindowDimensions();
  // Size each reel to the list's real viewport (between the status bar and tab bar), not
  // the window, so paging lands exactly on item boundaries.
  const [height, setHeight] = useState(window.height);
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [items, setItems] = useState<Item[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <View style={styles.screen} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <FlashList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <Reel post={item.post} height={height} active={focused && item.key === (activeKey ?? items[0]?.key)} />}
        extraData={`${activeKey}-${focused}`}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onEndReached={load}
        onEndReachedThreshold={3}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        drawDistance={height}
      />
      <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top + 4 }]}>
        <Text style={styles.topTitle}>Reels</Text>
        <Icon name="camera" size={24} color="#fff" />
      </View>
      {error && (
        <Text style={[styles.error, { top: insets.top + 48 }]} onPress={load}>
          {error} · Tap to retry
        </Text>
      )}
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 360 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topTitle: { color: '#fff', fontSize: 22, fontWeight: '700', ...shadow },
  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 20 },
  railButton: { alignItems: 'center', gap: 4 },
  railLabel: { color: '#fff', fontSize: 12, fontWeight: '600', ...shadow },
  railAvatar: { borderWidth: 2, borderColor: '#fff', borderRadius: 10, overflow: 'hidden' },
  info: { position: 'absolute', left: 14, right: 76, gap: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  white: { color: '#fff', ...shadow },
  follow: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  followText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  caption: { color: '#fff', fontSize: 14, lineHeight: 19, ...shadow },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    maxWidth: 220,
  },
  projectText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  error: { position: 'absolute', alignSelf: 'center', color: colors.like, fontSize: 13 },
});
