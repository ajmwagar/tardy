import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { ReactionChips, ReactionPicker, type ReactionAnchor } from '@/components/reactions';
import { Avatar, haptic, Icon, NameLine, PressableScale } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import type { Account, Comment } from '@/data/types';
import { applyReaction, nextReaction, reactionOf, type ReactionKind } from '@/reactions/reactions';
import { completeMention, mentionQuery, resolveMentions } from '@/share/mentions';
import { api, cacheAccounts, ensureAccounts, logEngagement, reportError, useAccount, useStore } from '@/state/store';
import { colors, timeAgo } from '@/theme';

const MAX_LENGTH = 500;
/** When to re-read comments after mentioning an agent, so its reply shows up. */
const AGENT_REPLY_RECHECK_MS = 2500;

const CommentRow = memo(function CommentRow({
  comment,
  me,
  onReact,
  onToggleReaction,
}: {
  comment: Comment;
  me: string | undefined;
  onReact: (comment: Comment, anchor: ReactionAnchor) => void;
  onToggleReaction: (comment: Comment, kind: ReactionKind) => void;
}) {
  const author = useAccount(comment.authorId);
  const rowRef = useRef<View>(null);
  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  const longPress = () => {
    haptic.selection();
    rowRef.current?.measureInWindow((_x, y) => onReact(comment, { y }));
  };
  return (
    <Pressable ref={rowRef} style={styles.row} onLongPress={longPress} delayLongPress={280} accessibilityActions={[{ name: 'longpress', label: 'React' }]} onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && longPress()}>
      <Pressable onPress={openProfile} accessibilityRole="button" accessibilityLabel={`${author?.handle ?? 'Author'}, open profile`}>
        <Avatar account={author} size={34} />
      </Pressable>
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <NameLine account={author} />
          <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
        </View>
        <Text style={styles.text}>{comment.text}</Text>
        <ReactionChips reactions={comment.reactions} me={me} onToggle={(kind) => onToggleReaction(comment, kind)} />
      </View>
    </Pressable>
  );
});

const commentKey = (c: Comment) => c.id;

function CommentsSkeleton() {
  return (
    <Pulse style={{ padding: 16, gap: 18 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          <SkeletonBlock style={{ width: 34, height: 34, borderRadius: 17 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock style={{ width: 110, height: 11 }} />
            <SkeletonBlock style={{ width: '80%', height: 11 }} />
          </View>
        </View>
      ))}
    </Pulse>
  );
}

/** Comments on a post, newest last, with a composer. Opens as a sheet over the feed. */
export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const me = useAccount('me');
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<Account[]>([]);
  const accounts = useStore((s) => s.accounts);
  const typing = mentionQuery(draft);
  const meId = me?.id;

  // Tap-backs: applied at once, rolled back if the server refuses.
  const [picker, setPicker] = useState<{ comment: Comment; anchor: ReactionAnchor } | null>(null);
  const openPicker = useCallback((comment: Comment, anchor: ReactionAnchor) => setPicker({ comment, anchor }), []);
  const toggleReaction = useCallback(
    async (comment: Comment, kind: ReactionKind) => {
      if (!meId) return;
      haptic.impact();
      const next = nextReaction(reactionOf(comment.reactions, meId), kind);
      const patch = (reactions: Comment['reactions']) =>
        setComments((prev) => (prev ?? []).map((c) => (c.id === comment.id ? { ...c, reactions: reactions?.length ? reactions : undefined } : c)));
      patch(applyReaction(comment.reactions, meId, next));
      try {
        patch((await api.reactToComment(postId, comment.id, next)).reactions);
      } catch (e) {
        patch(comment.reactions);
        reportError(`Couldn't react: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [meId, postId],
  );
  const renderComment = useCallback(
    ({ item }: { item: Comment }) => (
      <CommentRow comment={item} me={meId} onReact={openPicker} onToggleReaction={(c, k) => void toggleReaction(c, k)} />
    ),
    [meId, openPicker, toggleReaction],
  );

  // Suggest accounts while an @handle is being typed. Picking one is what makes it a mention.
  useEffect(() => {
    if (typing === null) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const found = await api.searchAccounts(typing);
        if (!live) return;
        cacheAccounts(found);
        setSuggestions(found.slice(0, 5));
      } catch (e) {
        if (live) reportError(`Couldn't search for that handle: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [typing]);

  const load = useCallback(async () => {
    try {
      const list = await api.comments(postId);
      await ensureAccounts(list.map((c) => c.authorId));
      setComments(list);
      setError(null);
    } catch (e) {
      setError(
        e instanceof TardyApiError && e.code === 'forbidden'
          ? "You can't see this post anymore."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [postId]);

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles or fails.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const byHandle = (handle: string) => [...accounts.values()].find((a) => a.handle === handle);
      const mentionedIds = resolveMentions(text, byHandle);
      const saved = await api.addComment(postId, text, mentionedIds);
      // A mentioned agent replies in the thread; look again once it has had a moment.
      if (mentionedIds.some((id) => accounts.get(id)?.kind === 'agent')) setTimeout(() => void load(), AGENT_REPLY_RECHECK_MS);
      logEngagement({ type: 'reply', postId });
      setComments((prev) => [...(prev ?? []), saved]);
      setDraft('');
    } catch (e) {
      reportError(`Couldn't post your comment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Text style={styles.title}>Comments</Text>
      <ReactionPicker
        anchor={picker?.anchor ?? null}
        current={picker && meId ? reactionOf(picker.comment.reactions, meId) : null}
        onClose={() => setPicker(null)}
        onPick={(kind) => {
          if (picker) void toggleReaction(picker.comment, kind);
          setPicker(null);
        }}
      />
      {error && !comments ? (
        <ErrorState message="The comments wandered off." detail={error} onRetry={load} />
      ) : !comments ? (
        <CommentsSkeleton />
      ) : (
        <FlatList
          data={comments}
          keyExtractor={commentKey}
          renderItem={renderComment}
          extraData={meId}
          ListEmptyComponent={
            <EmptyState icon="bubble.left" title="No comments yet" message="Be the first. The agents are watching." />
          }
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
        />
      )}
      {typing !== null && suggestions.length > 0 && (
        <View style={styles.suggestions} accessibilityRole="menu">
          {suggestions.map((a) => (
            <Pressable
              key={a.id}
              style={styles.suggestion}
              onPress={() => {
                setDraft((d) => completeMention(d, a.handle));
                setSuggestions([]);
              }}
              accessibilityRole="menuitem"
              accessibilityLabel={`Mention ${a.handle}`}>
              <Avatar account={a} size={26} />
              <NameLine account={a} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Avatar account={me} size={32} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          maxLength={MAX_LENGTH}
          multiline
        />
        {/* Always laid out (dimmed when empty) so the input doesn't jump wider and narrower. */}
        <PressableScale
          style={[styles.send, !draft.trim() && styles.sendDisabled]}
          onPress={send}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}>
          <Icon name="arrow.up" size={16} color={colors.onPrimary} weight="bold" />
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center', paddingTop: 18, paddingBottom: 10 },
  list: { paddingHorizontal: 16, paddingBottom: 12, gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  rowBody: { flex: 1, gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: colors.textTertiary, fontSize: 12 },
  text: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  suggestions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, paddingVertical: 4 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: 18,
    backgroundColor: colors.elevated,
    color: colors.text,
    fontSize: 15,
  },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  sendDisabled: { opacity: 0.35 },
});
