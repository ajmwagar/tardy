import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Animated, AppState, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, haptic, Icon, IconButton, NameLine, PressableScale, StatusPill } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import type { Account, Message, Post, ThreadRef } from '@/data/types';
import { LinkPreview } from '@/components/link-preview';
import { ReactionChips, ReactionPicker, type ReactionAnchor } from '@/components/reactions';
import { ThreadAvatar } from '@/components/thread-avatar';
import { applyReaction, nextReaction, reactionOf, type ReactionKind } from '@/reactions/reactions';
import { lastSequence, LIVE_FULL_EVERY, mergeMessages, nextCheckMs, quickCheckCursor } from '@/messages/live';
import { messageSpans } from '@/messages/format';
import { isWork, promotionNotice } from '@/share/sections';
import { useSharedLink } from '@/share/use-shared-link';
import { isGroup, othersIn, threadLabel } from '@/share/thread-label';
import { api, cacheAccounts, ensureAccounts, refreshUnread, reportError, useAccount, useStore } from '@/state/store';
import { colors, IMAGE_TRANSITION_MS, radius, timeAgo } from '@/theme';

/** Messages further apart than this get a time divider. */
const BREAK_MS = 60 * 60 * 1000;
const LINK_CARD_WIDTH = 260;

/**
 * A message, or a local event line (an agent joining) that sits in the timeline. Event lines
 * are this device's record of what it just did; the server does not send them (yet).
 */
type Row = Message & { pending?: boolean; failed?: boolean; event?: string };

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
        else reportError(`Couldn't load a shared tardy: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [ref]);

  if (!ref) return null;
  if (hidden) {
    return (
      <View style={[styles.shared, styles.sharedHidden]}>
        <Icon name="eye.slash" size={16} color={colors.textTertiary} />
        <Text style={styles.sharedHiddenText}>This tardy isn&apos;t available to you.</Text>
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

const isUrl = (text: string) => /^https?:\/\/\S+$/.test(text.trim());

function MessageText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <Text style={mine ? styles.textMine : styles.textTheirs}>
      {messageSpans(text).map((span, index) => (
        <Text key={index} style={span.kind === 'code' ? (mine ? styles.codeMine : styles.codeTheirs) : undefined}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

/** A shared link as its preview card, filling in as enrichment finishes. */
function LinkCard({ id, url }: { id: string; url: string }) {
  // A failed preview read leaves the plain card: the link itself still opens.
  const { link } = useSharedLink(id);
  return <LinkPreview url={url} link={link} width={LINK_CARD_WIDTH} />;
}

const Bubble = memo(function Bubble({
  row,
  mine,
  showAvatar,
  showName,
  me,
  onRetry,
  onReact,
  onToggleReaction,
  receipt,
}: {
  row: Row;
  mine: boolean;
  showAvatar: boolean;
  /** Groups: the sender's handle above the first bubble of their run. */
  showName: boolean;
  me: string | undefined;
  onRetry: (row: Row) => void;
  /** Long-press: open the tap-back bar above this bubble. */
  onReact: (row: Row, anchor: ReactionAnchor) => void;
  onToggleReaction: (row: Row, kind: ReactionKind) => void;
  receipt?: string;
}) {
  const sender = useAccount(row.senderId);
  const bubbleRef = useRef<View>(null);
  // Only delivered messages can be reacted to (a pending or failed one has no server id yet).
  const reactable = !row.pending && !row.failed && !row.id.startsWith('local-');
  const longPress = () => {
    if (!reactable) return;
    haptic.selection();
    bubbleRef.current?.measureInWindow((_x, y) => onReact(row, { y }));
  };
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      {!mine && <View style={styles.avatarSlot}>{showAvatar && <Avatar account={sender} size={26} />}</View>}
      <View style={[styles.bubbleColumn, mine && styles.bubbleColumnMine]}>
        {showName && !mine && sender && <Text style={styles.senderName}>{sender.handle}</Text>}
        {row.sharedPost && <SharedPostCard message={row} />}
        {row.sharedLinkId && !row.sharedPost && isUrl(row.text) ? (
          <LinkCard id={row.sharedLinkId} url={row.text} />
        ) : row.text ? (
          <Pressable
            ref={bubbleRef}
            onPress={row.failed ? () => onRetry(row) : undefined}
            onLongPress={longPress}
            delayLongPress={280}
            accessibilityActions={reactable ? [{ name: 'longpress', label: 'React' }] : undefined}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && longPress()}
            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, row.pending && styles.bubblePending]}>
            <MessageText text={row.text} mine={mine} />
          </Pressable>
        ) : null}
        <ReactionChips
          reactions={row.reactions}
          me={me}
          onToggle={(kind) => onToggleReaction(row, kind)}
          align={mine ? 'flex-end' : 'flex-start'}
        />
        {row.failed && <Text style={styles.failed}>Not delivered · tap to retry</Text>}
        {!row.failed && receipt ? <Text style={styles.receipt}>{receipt}</Text> : null}
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

function TypingRow({ profileId }: { profileId: string }) {
  const account = useAccount(profileId);
  const [dots] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        130,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [dots]);

  return (
    <View style={styles.typingRow} accessibilityLiveRegion="polite" accessibilityLabel={`${account?.handle ?? 'Someone'} is typing`}>
      <Avatar account={account} size={26} />
      <View style={styles.typingBubble}>
        {dots.map((dot, index) => (
          <Animated.View
            key={index}
            style={[
              styles.typingDot,
              { opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] },
            ]}
          />
        ))}
      </View>
      <Text style={styles.typingLabel}>{account?.handle ?? 'Someone'} is typing</Text>
    </View>
  );
}

export default function ThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const insets = useSafeAreaInsets();
  const meId = useStore((s) => s.accounts.get('me')?.id);
  const [thread, setThread] = useState<ThreadRef | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const group = thread !== null && isGroup(thread);
  const otherAccount = useAccount(thread ? othersIn(thread, meId)[0] : undefined);
  const accounts = useStore((s) => s.accounts);
  const groupLabel = thread && group ? threadLabel(thread, meId, (id) => accounts.get(id)?.handle) : null;
  const lastReadId = useRef<string | null>(null);

  // Live updates (see `messages/live.ts`): one check at a time, only new messages most of the
  // time, a full re-read every few checks for reactions, fast while the chat is moving, and
  // nothing while the app is in the background.
  const cursor = useRef(0);
  const checks = useRef(0);
  const inFlight = useRef(false);
  const lastActivity = useRef(0);
  const wake = useRef<() => void>(() => {});

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const full = cursor.current === 0 || checks.current++ % LIVE_FULL_EVERY === 0;
      const [current, fetched, typing] = await Promise.all([
        full ? api.thread(threadId) : Promise.resolve(null),
        api.messages(threadId, full ? undefined : quickCheckCursor(cursor.current)),
        api.typing(threadId),
      ]);
      await ensureAccounts([...(current?.participantIds ?? []), ...fetched.map((m) => m.senderId), ...typing]);
      if (current) setThread(current);
      setTypingIds(typing.filter((id) => id !== meId));
      if (fetched.some((m) => (m.sequence ?? 0) > cursor.current)) lastActivity.current = Date.now();
      cursor.current = Math.max(cursor.current, lastSequence(fetched));
      // Keep local pending/failed sends and event lines; everything else comes from the server.
      setRows((prev) => {
        const local = (prev ?? []).filter((r) => r.pending || r.failed || r.event);
        const stored = (prev ?? []).filter((r) => !(r.pending || r.failed || r.event));
        const merged = full ? fetched : mergeMessages(stored, fetched);
        return [...merged, ...local].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      });
      setError(null);

      const last = fetched[fetched.length - 1];
      if (last && last.id !== lastReadId.current) {
        lastReadId.current = last.id;
        await api.markThreadRead(threadId, last.id);
        void refreshUnread();
      }
    } catch (e) {
      if (e instanceof TardyApiError && e.code === 'forbidden') setError("You can't see this conversation anymore.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [threadId, meId]);

  const composing = draft.trim().length > 0;
  const chatReady = rows !== null;
  useEffect(() => {
    if (!chatReady) return;
    void api.setTyping(threadId, composing).catch(() => {});
    if (!composing) return;
    const renewal = setInterval(() => void api.setTyping(threadId, true).catch(() => {}), 3_000);
    return () => {
      clearInterval(renewal);
      void api.setTyping(threadId, false).catch(() => {});
    };
  }, [threadId, composing, chatReady]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Opening a chat counts as activity: check fast at first.
      lastActivity.current = Date.now();
      let foreground = AppState.currentState === 'active';
      const tick = async () => {
        clearTimeout(timer);
        if (!foreground) return;
        await sync();
        timer = setTimeout(tick, nextCheckMs(lastActivity.current, Date.now()));
      };
      wake.current = () => void tick();
      const appState = AppState.addEventListener('change', (next) => {
        foreground = next === 'active';
        if (foreground) void tick();
        else clearTimeout(timer);
      });
      void tick();
      return () => {
        clearTimeout(timer);
        appState.remove();
        wake.current = () => {};
      };
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
        // A reply (or an agent's 👀) is likely now: check right away and keep checking fast.
        lastActivity.current = Date.now();
        wake.current();
      } catch {
        setRows((prev) => (prev ?? []).map((r) => (r.id === temp.id ? { ...r, pending: false, failed: true } : r)));
      }
    },
    [meId, threadId],
  );

  const data = useMemo(() => [...(rows ?? [])].reverse(), [rows]); // inverted list: newest first
  const latestMineId = useMemo(() => [...(rows ?? [])].reverse().find((row) => row.senderId === meId && !row.event)?.id, [rows, meId]);

  /**
   * Adds one of the viewer's own agents. The confirmation names the agent and what it will
   * see before anything happens; a failure leaves the chat exactly as it was (human-only).
   */
  const addAgent = useCallback(async () => {
    if (!thread) return;
    let mine: Account[];
    try {
      mine = (await api.searchAccounts('')).filter((a) => a.kind === 'agent' && a.ownedByViewer && !thread.participantIds.includes(a.id));
    } catch (e) {
      reportError(`Couldn't load your agents: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (mine.length === 0) {
      Alert.alert('No agents to add', 'Agents you own show up here. Claim one in Settings with the code it gave you.');
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Add an agent', options: ['Cancel', ...mine.map((a) => a.handle)], cancelButtonIndex: 0 },
      (i) => {
        const agent = mine[i - 1];
        if (!agent) return;
        const notice = promotionNotice(agent.handle, isWork(thread));
        Alert.alert(notice.title, notice.message, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: async () => {
              try {
                const promoted = await api.addAgent(thread.id, agent.id);
                cacheAccounts([agent]);
                setThread(promoted);
                haptic.impact();
                const at = new Date().toISOString();
                setRows((prev) => [
                  ...(prev ?? []),
                  { id: `event-${at}`, threadId: thread.id, senderId: agent.id, text: '', createdAt: at, event: `${agent.handle} joined. It sees messages from here on.` },
                ]);
              } catch (e) {
                reportError(`Couldn't add ${agent.handle}: ${e instanceof Error ? e.message : String(e)}`);
              }
            },
          },
        ]);
      },
    );
  }, [thread]);
  const retry = useCallback((r: Row) => void send(r.text, r), [send]);
  // Tap-backs: one per person per message. Applied at once, rolled back if the server refuses.
  const [picker, setPicker] = useState<{ row: Row; anchor: ReactionAnchor } | null>(null);
  const openPicker = useCallback((row: Row, anchor: ReactionAnchor) => setPicker({ row, anchor }), []);
  const react = useCallback(
    async (row: Row, kind: ReactionKind | null) => {
      if (!meId) return;
      const patch = (reactions: Row['reactions']) =>
        setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, reactions: reactions?.length ? reactions : undefined } : r)));
      patch(applyReaction(row.reactions, meId, kind));
      try {
        patch((await api.reactToMessage(threadId, row.id, kind)).reactions);
      } catch (e) {
        patch(row.reactions);
        reportError(`Couldn't react: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [meId, threadId],
  );
  const toggleReaction = useCallback(
    (row: Row, kind: ReactionKind) => {
      haptic.impact();
      void react(row, nextReaction(meId ? reactionOf(row.reactions, meId) : null, kind));
    },
    [react, meId],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Row; index: number }) => {
      const older = data[index + 1];
      const newer = data[index - 1];
      const gap = older && Date.parse(item.createdAt) - Date.parse(older.createdAt) > BREAK_MS;
      const recipientCount = Math.max(0, (thread?.participantIds.length ?? 1) - 1);
      const readCount = item.readByIds?.length ?? 0;
      const receipt = item.id === latestMineId && !item.pending
        ? readCount >= recipientCount && recipientCount > 0
          ? 'Read'
          : readCount > 0
            ? `Read by ${readCount}`
            : 'Delivered'
        : undefined;
      if (item.event) {
        return (
          <Text style={styles.event} accessibilityRole="text">
            {item.event}
          </Text>
        );
      }
      return (
        <View>
          {(!older || gap) && <Text style={styles.timeBreak}>{timeAgo(item.createdAt)} ago</Text>}
          <Bubble
            row={item}
            mine={item.senderId === meId}
            showAvatar={!newer || newer.senderId !== item.senderId}
            showName={group && (!older || !!gap || older.senderId !== item.senderId)}
            me={meId}
            onRetry={retry}
            onReact={openPicker}
            onToggleReaction={toggleReaction}
            receipt={receipt}
          />
        </View>
      );
    },
    [data, meId, retry, group, openPicker, toggleReaction, latestMineId, thread],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => <IconButton icon="person.crop.circle.badge.plus" size={22} label="Add an agent" onPress={addAgent} />,
          headerTitle: () =>
            thread && groupLabel !== null ? (
              <View style={styles.titleRow} accessibilityRole="header" accessibilityLabel={`Group: ${groupLabel}`}>
                <ThreadAvatar thread={thread} me={meId} size={28} />
                <View>
                  <Text style={styles.groupTitle} numberOfLines={1}>
                    {groupLabel}
                  </Text>
                  <Text style={styles.titleSub}>
                    {isWork(thread) ? 'Work · ' : ''}
                    {thread.participantIds.length} members
                  </Text>
                </View>
              </View>
            ) : (
            <Pressable
              style={styles.titleRow}
              accessibilityRole="button"
              accessibilityLabel={`${otherAccount?.handle ?? 'Conversation'}, open profile`}
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
          <ReactionPicker
            anchor={picker?.anchor ?? null}
            current={picker && meId ? reactionOf(picker.row.reactions, meId) : null}
            onClose={() => setPicker(null)}
            onPick={(kind) => {
              if (picker) toggleReaction(picker.row, kind);
              setPicker(null);
            }}
          />
          <FlatList
            data={data}
            inverted
            keyExtractor={rowKey}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
          />
          {typingIds.map((id) => <TypingRow key={id} profileId={id} />)}
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={groupLabel ? `Message ${groupLabel}…` : otherAccount ? `Message ${otherAccount.handle}…` : 'Message…'}
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
  event: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 24 },
  groupTitle: { color: colors.text, fontSize: 15, fontWeight: '700', maxWidth: 220 },
  senderName: { color: colors.textTertiary, fontSize: 11.5, marginLeft: 12, marginBottom: 2 },
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
  codeMine: { fontFamily: 'ui-monospace', backgroundColor: 'rgba(0,0,0,0.18)' },
  codeTheirs: { fontFamily: 'ui-monospace', color: colors.primary, backgroundColor: colors.surface },
  failed: { color: colors.alarm, fontSize: 11.5 },
  receipt: { color: colors.textTertiary, fontSize: 11.5, paddingHorizontal: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 38, paddingHorizontal: 16, paddingVertical: 4 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 30, borderRadius: 16, backgroundColor: colors.elevated },
  typingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textSecondary },
  typingLabel: { color: colors.textTertiary, fontSize: 11.5 },
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
