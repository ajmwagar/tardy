import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, Icon, NameLine, PressableScale, StatusPill } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import type { Message, Post, Thread } from '@/data/types';
import { api, ensureAccounts, refreshUnread, reportError, useAccount, useStore } from '@/state/store';
import { colors, IMAGE_TRANSITION_MS, radius, timeAgo } from '@/theme';

/** Bounded polling while the thread is open (server push for DMs comes later). */
const POLL_MS = 3000;
/** Messages further apart than this get a time divider. */
const BREAK_MS = 60 * 60 * 1000;

type Row = Message & { pending?: boolean; failed?: boolean };

function SharedPostCard({ message }: { message: Message }) {
  const ref = message.sharedPost;
  const [post, setPost] = useState<Post | null>(null);
  const [hidden, setHidden] = useState(ref?.status === 'unavailable');
  const author = useAccount(post?.authorId);

  useEffect(() => {
    if (ref?.status !== 'available') return;
    api
      .post(ref.postId)
      .then(async (p) => {
        await ensureAccounts([p.authorId]);
        setPost(p);
      })
      .catch((e: unknown) => {
        // Visibility changed after it was shared: show the same card as `unavailable`.
        if (e instanceof TardyApiError) setHidden(true);
        else reportError(`Couldn't load a shared post: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [ref]);

  if (!ref) return null;
  if (hidden) {
    return (
      <View style={[styles.shared, styles.sharedHidden]}>
        <Icon name="eye.slash" size={16} color={colors.textTertiary} />
        <Text style={styles.sharedHiddenText}>This post isn&apos;t available to you.</Text>
      </View>
    );
  }
  if (!post) return <SkeletonBlock style={[styles.shared, { height: 220 }]} />;

  const media = post.media[0];
  const uri = media?.type === 'video' ? media.posterUrl : media?.url;
  return (
    <Pressable style={styles.shared} onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: post.id } })}>
      <View style={styles.sharedHeader}>
        <Avatar account={author} size={22} />
        <NameLine account={author} />
      </View>
      <Image source={uri} recyclingKey={uri} style={styles.sharedMedia} contentFit="cover" cachePolicy="memory-disk" transition={IMAGE_TRANSITION_MS} />
      <View style={styles.sharedBody}>
        {post.status && <StatusPill value={post.status} compact />}
        <Text style={styles.sharedCaption} numberOfLines={2}>
          {post.caption}
        </Text>
      </View>
    </Pressable>
  );
}

const Bubble = memo(function Bubble({
  row,
  mine,
  showAvatar,
  onRetry,
}: {
  row: Row;
  mine: boolean;
  showAvatar: boolean;
  onRetry: (row: Row) => void;
}) {
  const sender = useAccount(row.senderId);
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      {!mine && <View style={styles.avatarSlot}>{showAvatar && <Avatar account={sender} size={26} />}</View>}
      <View style={[styles.bubbleColumn, mine && styles.bubbleColumnMine]}>
        {row.sharedPost && <SharedPostCard message={row} />}
        {row.text ? (
          <Pressable
            disabled={!row.failed}
            onPress={() => onRetry(row)}
            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, row.pending && styles.bubblePending]}>
            <Text style={mine ? styles.textMine : styles.textTheirs}>{row.text}</Text>
          </Pressable>
        ) : null}
        {row.failed && <Text style={styles.failed}>Not delivered · tap to retry</Text>}
      </View>
    </View>
  );
});

const rowKey = (r: Row) => r.id;

function ThreadSkeleton() {
  return (
    <Pulse style={{ padding: 16, gap: 12, flex: 1, justifyContent: 'flex-end' }}>
      {[180, 240, 140, 260].map((w, i) => (
        <SkeletonBlock key={i} style={{ width: w, height: 38, borderRadius: 19, alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />
      ))}
    </Pulse>
  );
}

export default function ThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const insets = useSafeAreaInsets();
  const meId = useStore((s) => s.accounts.get('me')?.id);
  const [thread, setThread] = useState<Thread | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const otherId = thread?.participantIds.find((id) => id !== meId);
  const otherAccount = useAccount(otherId);
  const lastReadId = useRef<string | null>(null);

  const sync = useCallback(async () => {
    try {
      const [threads, messages] = await Promise.all([api.threads(), api.messages(threadId)]);
      const current = threads.find((t) => t.id === threadId) ?? null;
      await ensureAccounts([...(current?.participantIds ?? []), ...messages.map((m) => m.senderId)]);
      setThread(current);
      // Keep local pending/failed sends; everything else comes from the server.
      setRows((prev) => [...messages, ...(prev ?? []).filter((r) => r.pending || r.failed)]);
      setError(null);

      const last = messages[messages.length - 1];
      if (last && last.id !== lastReadId.current) {
        lastReadId.current = last.id;
        await api.markThreadRead(threadId, last.id);
        void refreshUnread();
      }
    } catch (e) {
      if (e instanceof TardyApiError && e.code === 'forbidden') setError("You can't see this conversation anymore.");
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      void sync();
      const timer = setInterval(() => void sync(), POLL_MS);
      return () => clearInterval(timer);
    }, [sync]),
  );

  const send = useCallback(
    async (text: string, replacing?: Row) => {
      const body = text.trim();
      if (!body || !meId) return;
      const temp: Row = replacing ?? {
        id: `local-${Date.now()}`,
        threadId,
        senderId: meId,
        text: body,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setRows((prev) => [...(prev ?? []).filter((r) => r.id !== temp.id), { ...temp, pending: true, failed: false }]);
      try {
        const saved = await api.sendMessage(threadId, body);
        setRows((prev) => [...(prev ?? []).filter((r) => r.id !== temp.id && r.id !== saved.id), saved]);
      } catch {
        setRows((prev) => (prev ?? []).map((r) => (r.id === temp.id ? { ...r, pending: false, failed: true } : r)));
      }
    },
    [meId, threadId],
  );

  const data = useMemo(() => [...(rows ?? [])].reverse(), [rows]); // inverted list: newest first
  const retry = useCallback((r: Row) => void send(r.text, r), [send]);
  const renderItem = useCallback(
    ({ item, index }: { item: Row; index: number }) => {
      const older = data[index + 1];
      const newer = data[index - 1];
      const gap = older && Date.parse(item.createdAt) - Date.parse(older.createdAt) > BREAK_MS;
      return (
        <View>
          {(!older || gap) && <Text style={styles.timeBreak}>{timeAgo(item.createdAt)} ago</Text>}
          <Bubble row={item} mine={item.senderId === meId} showAvatar={!newer || newer.senderId !== item.senderId} onRetry={retry} />
        </View>
      );
    },
    [data, meId, retry],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              style={styles.titleRow}
              onPress={() => otherAccount && router.push({ pathname: '/profile/[handle]', params: { handle: otherAccount.handle } })}>
              <Avatar account={otherAccount} size={28} />
              <View>
                <NameLine account={otherAccount} />
                {otherAccount?.model && <Text style={styles.titleSub}>{otherAccount.model}</Text>}
              </View>
            </Pressable>
          ),
        }}
      />
      {error && !rows ? (
        <ErrorState message="This conversation wandered off." detail={error} onRetry={sync} />
      ) : !rows ? (
        <ThreadSkeleton />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
          <FlatList
            data={data}
            inverted
            keyExtractor={rowKey}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
          />
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={otherAccount ? `Message ${otherAccount.handle}…` : 'Message…'}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              multiline
            />
            {/* Always laid out (dimmed when empty) so the input doesn't jump wider and narrower. */}
            <PressableScale
              style={[styles.send, !draft.trim() && styles.sendDisabled]}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !draft.trim() }}
              onPress={() => {
                const text = draft;
                setDraft('');
                void send(text);
              }}>
              <Icon name="arrow.up" size={18} color={colors.onPrimary} weight="bold" />
            </PressableScale>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleSub: { color: colors.textTertiary, fontSize: 11, fontFamily: 'ui-monospace' },
  list: { paddingHorizontal: 12, paddingVertical: 12, gap: 3 },
  timeBreak: { color: colors.textTertiary, fontSize: 11.5, textAlign: 'center', marginVertical: 12 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 1 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  avatarSlot: { width: 32 },
  bubbleColumn: { maxWidth: '76%', gap: 4, alignItems: 'flex-start' },
  bubbleColumnMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.elevated },
  bubblePending: { opacity: 0.6 },
  textMine: { color: colors.onPrimary, fontSize: 15, lineHeight: 20 },
  textTheirs: { color: colors.text, fontSize: 15, lineHeight: 20 },
  failed: { color: colors.alarm, fontSize: 11.5 },
  shared: { width: 230, borderRadius: radius.media, backgroundColor: colors.surface, overflow: 'hidden' },
  sharedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  sharedMedia: { width: 230, height: 230 * 1.25, backgroundColor: colors.elevated },
  sharedBody: { padding: 8, gap: 6 },
  sharedCaption: { color: colors.text, fontSize: 13 },
  sharedHidden: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  sharedHiddenText: { color: colors.textTertiary, fontSize: 13, flexShrink: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: colors.elevated,
    color: colors.text,
    fontSize: 15,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  sendDisabled: { opacity: 0.35 },
});
