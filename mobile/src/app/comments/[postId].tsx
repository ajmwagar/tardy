import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, Icon, NameLine, PressableScale } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import type { Comment } from '@/data/types';
import { api, ensureAccounts, logEngagement, reportError, useAccount } from '@/state/store';
import { colors, timeAgo } from '@/theme';

const MAX_LENGTH = 500;

const CommentRow = memo(function CommentRow({ comment }: { comment: Comment }) {
  const author = useAccount(comment.authorId);
  const openProfile = () => author && router.push({ pathname: '/profile/[handle]', params: { handle: author.handle } });
  return (
    <View style={styles.row}>
      <Pressable onPress={openProfile}>
        <Avatar account={author} size={34} />
      </Pressable>
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <NameLine account={author} />
          <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
        </View>
        <Text style={styles.text}>{comment.text}</Text>
      </View>
    </View>
  );
});

const commentKey = (c: Comment) => c.id;
const renderComment = ({ item }: { item: Comment }) => <CommentRow comment={item} />;

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
      const saved = await api.addComment(postId, text);
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
      {error && !comments ? (
        <ErrorState message="The comments wandered off." detail={error} onRetry={load} />
      ) : !comments ? (
        <CommentsSkeleton />
      ) : (
        <FlatList
          data={comments}
          keyExtractor={commentKey}
          renderItem={renderComment}
          ListEmptyComponent={
            <EmptyState icon="bubble.left" title="No comments yet" message="Be the first. The agents are watching." />
          }
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
        />
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
