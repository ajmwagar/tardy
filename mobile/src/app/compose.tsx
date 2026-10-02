import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { composerCount } from '@/compose/text-post';
import { TEXT_POST_MAX_CHARS, type PostAudience } from '@/data/types';
import { Avatar, haptic, PressableScale } from '@/components/ui';
import { publishTextPost, useAccount } from '@/state/store';
import { colors, radius } from '@/theme';

const AUDIENCES: { value: PostAudience; label: string }[] = [
  { value: 'public', label: 'Everyone' },
  { value: 'followers', label: 'Followers' },
  { value: 'private', label: 'Only me' },
];

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * New text post, like X: words only, at most 200 characters. The request id is made once
 * per draft, so tapping Post again after a failure retries instead of posting twice.
 */
export default function ComposeScreen() {
  const insets = useSafeAreaInsets();
  const me = useAccount('me');
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<PostAudience>('public');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(Crypto.randomUUID());
  const count = composerCount(text);

  const edit = (next: string) => {
    // A changed draft is a different post; only an unchanged retry may reuse the id.
    if (next.trim() !== text.trim()) requestId.current = Crypto.randomUUID();
    setText(next);
    setError(null);
  };

  const post = async () => {
    if (!count.canPost || sending) return;
    setSending(true);
    setError(null);
    try {
      await publishTextPost({ clientRequestId: requestId.current, text, audience });
      haptic.impact();
      router.back();
    } catch (e) {
      setError(`Couldn't post. Your draft is still here. ${describe(e)}`);
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={styles.cancel}>Cancel</Text>
        </PressableScale>
        <PressableScale
          style={[styles.post, (!count.canPost || sending) && styles.postDisabled]}
          onPress={post}
          disabled={!count.canPost || sending}
          accessibilityRole="button"
          accessibilityLabel="Post"
          accessibilityState={{ disabled: !count.canPost || sending, busy: sending }}>
          <Text style={styles.postText}>{sending ? 'Posting…' : 'Post'}</Text>
        </PressableScale>
      </View>

      <View style={styles.body}>
        <Avatar account={me} size={36} />
        <TextInput
          value={text}
          onChangeText={edit}
          placeholder="What shipped?"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoFocus
          multiline
          accessibilityLabel={`Post text, up to ${TEXT_POST_MAX_CHARS} characters`}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.audiences} accessibilityRole="radiogroup">
          {AUDIENCES.map((a) => (
            <PressableScale
              key={a.value}
              scaleTo={0.95}
              style={[styles.audience, audience === a.value && styles.audienceOn]}
              onPress={() => {
                haptic.selection();
                setAudience(a.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: audience === a.value }}>
              <Text style={[styles.audienceText, audience === a.value && styles.audienceTextOn]}>{a.label}</Text>
            </PressableScale>
          ))}
        </View>
        <Text
          style={[styles.count, count.tone === 'warn' && styles.countWarn, count.tone === 'over' && styles.countOver]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={count.remaining < 0 ? `${-count.remaining} characters over` : `${count.remaining} characters left`}>
          {count.remaining}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  cancel: { color: colors.text, fontSize: 16 },
  post: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  postDisabled: { opacity: 0.4 },
  postText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  input: { flex: 1, color: colors.text, fontSize: 18, lineHeight: 24, textAlignVertical: 'top' },
  error: { color: colors.alarm, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  audiences: { flexDirection: 'row', gap: 6 },
  audience: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.elevated },
  audienceOn: { backgroundColor: colors.text },
  audienceText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  audienceTextOn: { color: colors.surface },
  // Tabular figures so the counter doesn't jitter as it ticks.
  count: { color: colors.textTertiary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 32, textAlign: 'right' },
  countWarn: { color: colors.primary },
  countOver: { color: colors.alarm },
});
