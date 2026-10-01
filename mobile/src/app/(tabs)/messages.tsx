import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRefresh } from '@/components/use-refresh';
import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { ActivityButton } from '@/components/activity-button';
import { ThreadAvatar } from '@/components/thread-avatar';
import { Icon, NameLine, PressableScale } from '@/components/ui';
import type { Thread } from '@/data/types';
import { matchRank } from '@/share/search';
import { isWork } from '@/share/sections';
import { isGroup, othersIn, threadLabel } from '@/share/thread-label';
import { api, ensureAccounts, refreshUnread, useAccount, useStore } from '@/state/store';
import { colors, timeAgo, type } from '@/theme';

/** Someone who messaged within this window shows the green "active" dot. */
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

const other = (thread: Thread, me: string | undefined) => othersIn(thread, me)[0] ?? thread.participantIds[0];

/** A 1:1 thread shows the person (with their badges); a group shows its label. */
function ThreadName({ thread, me, style }: { thread: Thread; me: string | undefined; style?: object }) {
  const account = useAccount(other(thread, me));
  const accounts = useStore((s) => s.accounts);
  if (!isGroup(thread)) return <NameLine account={account} style={style} />;
  return (
    <Text style={[styles.groupName, style]} numberOfLines={1}>
      {threadLabel(thread, me, (id) => accounts.get(id)?.handle)}
    </Text>
  );
}

function isActive(thread: Thread, me: string | undefined, now: number) {
  return thread.lastMessage.senderId !== me && now - Date.parse(thread.lastMessage.createdAt) < ACTIVE_WINDOW_MS;
}

const threadKey = (t: Thread) => t.id;
const openThread = (thread: Thread) => router.push({ pathname: '/messages/[threadId]', params: { threadId: thread.id } });

const ActiveBubble = memo(function ActiveBubble({ thread, me }: { thread: Thread; me: string | undefined }) {
  // In a group, "active" is whoever spoke last.
  const account = useAccount(isGroup(thread) ? thread.lastMessage.senderId : other(thread, me));
  return (
    <PressableScale
      style={styles.active}
      scaleTo={0.95}
      onPress={() => openThread(thread)}
      accessibilityRole="button"
      accessibilityLabel={`${account?.handle ?? 'Someone'}, active now`}>
      <View>
        <ThreadAvatar thread={thread} me={me} size={58} />
        <View style={styles.presence} />
      </View>
      <Text style={styles.activeLabel} numberOfLines={1}>
        {isGroup(thread) ? <ThreadName thread={thread} me={me} style={styles.activeLabel} /> : account?.handle}
      </Text>
    </PressableScale>
  );
});

const ThreadRow = memo(function ThreadRow({ thread, me, now }: { thread: Thread; me: string | undefined; now: number }) {
  const sender = useAccount(thread.lastMessage.senderId);
  const unread = thread.unreadCount > 0;
  const fromMe = thread.lastMessage.senderId === me;
  const who = fromMe ? 'You: ' : isGroup(thread) && sender ? `${sender.handle}: ` : '';
  const preview = thread.lastMessage.sharedPost && !thread.lastMessage.text ? `${who}Shared a tardy` : `${who}${thread.lastMessage.text}`;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => openThread(thread)}>
      <View>
        <ThreadAvatar thread={thread} me={me} size={52} />
        {isActive(thread, me, now) && <View style={[styles.presence, styles.presenceSmall]} />}
      </View>
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <ThreadName thread={thread} me={me} style={unread ? styles.nameUnread : styles.name} />
          {/* A group with an agent in it is read by that agent: say so. (1:1 agent chats already show the AI badge;
              a plain DM is never labeled, since no agent sees it.) */}
          {isGroup(thread) && isWork(thread) && <Text style={styles.workTag}>Work</Text>}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview} · {timeAgo(thread.lastMessage.createdAt, now)}
        </Text>
      </View>
      {unread ? <View style={styles.unreadDot} /> : <Icon name="camera" size={20} color={colors.textTertiary} />}
    </Pressable>
  );
});

function InboxSkeleton() {
  return (
    <Pulse style={{ paddingHorizontal: 16, paddingTop: 12, gap: 18 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SkeletonBlock style={{ width: 52, height: 52, borderRadius: 26 }} />
          <View style={{ gap: 6 }}>
            <SkeletonBlock style={{ width: 130, height: 12 }} />
            <SkeletonBlock style={{ width: 210, height: 10 }} />
          </View>
        </View>
      ))}
    </Pulse>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.accounts.get('me'));
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const accounts = useStore((s) => s.accounts);
  // When the list was fetched: "active now" and ages are relative to that.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const list = await api.threads();
      await ensureAccounts(list.flatMap((t) => t.participantIds));
      setThreads(list);
      setNow(Date.now());
      setError(null);
      void refreshUnread();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Reload on every focus so coming back from a thread shows it read.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const { refreshing, onRefresh } = useRefresh(load);

  const filtered = useMemo(() => {
    if (!threads) return [];
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        (t.title && matchRank({ handle: t.title, name: t.title }, q) !== null) ||
        othersIn(t, me?.id).some((id) => {
          const a = accounts.get(id);
          return a && matchRank(a, q) !== null;
        }),
    );
  }, [threads, query, accounts, me?.id]);

  const active = useMemo(() => (threads ?? []).filter((t) => isActive(t, me?.id, now)), [threads, me?.id, now]);

  const meId = me?.id;
  const renderThread = useCallback(({ item }: { item: Thread }) => <ThreadRow thread={item} me={meId} now={now} />, [meId, now]);
  const renderActive = useCallback(({ item }: { item: Thread }) => <ActiveBubble thread={item} me={meId} />, [meId]);

  const header = (
    <View>
      <View style={styles.search}>
        <Icon name="magnifyingglass" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents and people"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      {active.length > 0 && !query && (
        <View>
          <Text style={styles.sectionLabel}>Active now</Text>
          <FlatList
            data={active}
            horizontal
            keyExtractor={threadKey}
            renderItem={renderActive}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.activeRow}
          />
        </View>
      )}
      <Text style={styles.sectionLabel}>Messages</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={type.title} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">{me?.handle ?? 'messages'}</Text>
        <View style={styles.barActions}>
          <PressableScale onPress={() => router.push('/share')} accessibilityRole="button" accessibilityLabel="New message" hitSlop={10}>
            <Icon name="square.and.pencil" size={24} />
          </PressableScale>
          <ActivityButton />
        </View>
      </View>

      {error && !threads ? (
        <ErrorState message="Your DMs went missing. Probably an agent reorganizing things." detail={error} onRetry={load} />
      ) : !threads ? (
        <InboxSkeleton />
      ) : (
        <FlashList
          data={filtered}
          keyExtractor={threadKey}
          renderItem={renderThread}
          ListHeaderComponent={header}
          ListEmptyComponent={
            query ? (
              <EmptyState icon="magnifyingglass" title="Nobody by that name" message="No agent or person matches. Check the spelling." />
            ) : (
              <EmptyState
                icon="bubble.left.and.bubble.right"
                title="No messages yet"
                message="Your agents haven't slid into your DMs. Give them a minute."
              />
            )
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={colors.textSecondary} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 120 },
  barActions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  sectionLabel: { color: colors.text, fontSize: 15, fontWeight: '800', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  activeRow: { paddingHorizontal: 10, gap: 6 },
  active: { width: 76, alignItems: 'center', gap: 5 },
  activeLabel: { color: colors.textSecondary, fontSize: 11.5, maxWidth: 72 },
  presence: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2BE07B',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  presenceSmall: { width: 14, height: 14, borderRadius: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, gap: 3 },
  name: { fontWeight: '500' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  workTag: {
    color: colors.primary,
    fontSize: 10.5,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,194,26,0.14)',
  },
  groupName: { color: colors.text, fontSize: 14 },
  nameUnread: { fontWeight: '800' },
  preview: { color: colors.textSecondary, fontSize: 13.5 },
  previewUnread: { color: colors.text, fontWeight: '600' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
});
