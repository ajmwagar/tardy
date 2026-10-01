import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, haptic, Icon, NameLine, PressableScale, StatusPill } from '@/components/ui';
import { MODE_KEY } from '@/agents/controls';
import type { PostSuggestion } from '@/data/types';
import { feedFrameRatio } from '@/media/aspect';
import { requestVerb } from '@/suggestions/describe';
import { stampOpacity, swipeOutcome, type SwipeOutcome } from '@/suggestions/swipe';
import { api, ensureAccounts, reportError, useAccount } from '@/state/store';
import { colors, IMAGE_TRANSITION_MS, radius } from '@/theme';

const VISIBILITY_LABEL: Record<PostSuggestion['visibility'], string> = { private: 'Only you', followers: 'Followers', public: 'Public' };
const FLY_MS = 220;

/** What the right-swipe stamp says: what happens when you say yes. */
const YES_STAMP: Record<NonNullable<PostSuggestion['kind']>, string> = { post: 'POST', story: 'POST', comment: 'SEND', message: 'SEND', follow: 'FOLLOW' };
/** "post", "comment": the setting a shortcut loosens, in words. */
const KIND_NOUN: Record<NonNullable<PostSuggestion['kind']>, string> = { post: 'post', story: 'add to its story', comment: 'comment', message: 'message people', follow: 'follow accounts' };

function SuggestionCard({ suggestion, width }: { suggestion: PostSuggestion; width: number }) {
  const agent = useAccount(suggestion.agentId);
  const target = useAccount(suggestion.target?.accountId);
  const accounts = { get: (id: string) => (id === target?.id ? target : undefined) };
  const kind = suggestion.kind ?? 'post';
  const publishes = kind === 'post' || kind === 'story';
  const media = suggestion.post.media[0];
  const uri = media?.type === 'video' ? media.posterUrl : media?.url;
  const mediaHeight = Math.min(width / feedFrameRatio(suggestion.post.media), width * 1.1);
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardHead}>
        <Avatar account={agent} size={34} />
        <View style={{ flex: 1 }}>
          <NameLine account={agent} />
          <Text style={styles.wants}>
            {requestVerb(suggestion, accounts)}
            {publishes ? ` · ${VISIBILITY_LABEL[suggestion.visibility]}` : ''}
          </Text>
        </View>
      </View>
      {uri ? <Image source={uri} style={{ width, height: mediaHeight }} contentFit="cover" transition={IMAGE_TRANSITION_MS} /> : null}
      <View style={styles.cardBody}>
        {suggestion.post.status ? <StatusPill value={suggestion.post.status} compact /> : null}
        <Text style={styles.caption}>{suggestion.post.caption}</Text>
        {suggestion.post.links.map((l) => (
          <Text key={l.url + l.label} style={styles.link} numberOfLines={1}>
            ↗ {l.label}
          </Text>
        ))}
        {suggestion.reason ? <Text style={styles.reason}>Why: {suggestion.reason}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Approvals: what your agents want to do, one card at a time. Swipe right (or tap ✓) to let
 * the agent do it now, left (or ✕) to say no; the agent hears the answer either way. Cards
 * come from your agent controls (Settings → your agent): anything set to "Ask me first", or
 * an automatic action that hit a limit. A shortcut under the card loosens the control.
 */
export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(screen - 32, 480);
  const [queue, setQueue] = useState<PostSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(0);
  const x = useSharedValue(0);

  const load = useCallback(async () => {
    try {
      const list = await api.postSuggestions();
      await ensureAccounts(list.flatMap((s) => [s.agentId, s.target?.accountId]));
      setQueue(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const top = queue?.[0];
  const topKind = top?.kind ?? 'post';
  const topAgent = useAccount(top?.agentId);

  const alwaysAllow = useCallback(() => {
    if (!top) return;
    const key = MODE_KEY[topKind];
    const handle = topAgent ? `@${topAgent.handle}` : 'this agent';
    Alert.alert(
      `Let ${handle} ${KIND_NOUN[topKind]} without asking?`,
      'It still follows your audience, daily and quiet-hours limits. You can change this in its controls any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Allow',
          onPress: () => {
            api.updateAgentControls(top.agentId, { [key]: 'auto' }).then(
              () => haptic.impact(),
              (e: unknown) => reportError(`Couldn't change that: ${e instanceof Error ? e.message : String(e)}`),
            );
          },
        },
      ],
    );
  }, [top, topKind, topAgent]);

  const decide = useCallback(
    async (outcome: Exclude<SwipeOutcome, null>) => {
      if (!top) return;
      haptic.impact();
      // The card has flown off; drop it now so the next one is live, put it back if the server says no.
      setQueue((q) => (q ?? []).slice(1));
      x.set(0);
      try {
        const result = await api.decideSuggestion(top.id, outcome);
        if (result) setPosted((n) => n + 1);
      } catch (e) {
        setQueue((q) => [top, ...(q ?? [])]);
        reportError(`Couldn't ${outcome === 'approve' ? 'post' : 'drop'} that: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [top, x],
  );

  const fly = useCallback(
    (outcome: Exclude<SwipeOutcome, null>) => {
      x.set(withTiming(outcome === 'approve' ? screen * 1.4 : -screen * 1.4, { duration: FLY_MS }, (done) => {
        if (done) scheduleOnRN(decide, outcome);
      }));
    },
    [decide, screen, x],
  );

  const pan = Gesture.Pan()
    .enabled(!!top)
    .onUpdate((e) => {
      x.set(e.translationX);
    })
    .onEnd((e) => {
      const outcome = swipeOutcome(e.translationX, e.velocityX, width);
      if (outcome === null) x.set(withSpring(0));
      else x.set(withTiming(outcome === 'approve' ? screen * 1.4 : -screen * 1.4, { duration: FLY_MS }, (done) => {
        if (done) scheduleOnRN(decide, outcome);
      }));
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { rotate: `${interpolate(x.get(), [-screen, screen], [-14, 14])}deg` }],
  }));
  const approveStamp = useAnimatedStyle(() => ({ opacity: x.get() > 0 ? stampOpacity(x.get(), width) : 0 }));
  const rejectStamp = useAnimatedStyle(() => ({ opacity: x.get() < 0 ? stampOpacity(x.get(), width) : 0 }));
  const nextStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(Math.abs(x.get()), [0, width], [0.94, 1], 'clamp') }] }));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.bar}>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
          <Icon name="xmark" size={22} />
        </PressableScale>
        <Text style={styles.title} accessibilityRole="header">
          Approvals
        </Text>
        <Text style={styles.count}>{queue ? `${queue.length} left` : ''}</Text>
      </View>

      <View style={styles.deck}>
        {error && !queue ? (
          <ErrorState message="Your agents' suggestions didn't load." detail={error} onRetry={load} />
        ) : !queue ? (
          <Pulse style={{ width, gap: 12 }}>
            <SkeletonBlock style={{ width, height: width * 1.2, borderRadius: radius.card }} />
          </Pulse>
        ) : !top ? (
          <EmptyState
            icon="checkmark.circle"
            title="All caught up"
            message={
              posted > 0
                ? `${posted} approved. Your agents ask here when your controls say "Ask me first".`
                : 'Your agents ask here before doing anything your controls say to ask about.'
            }
          />
        ) : (
          <>
            {queue[1] ? (
              <Animated.View style={[styles.behind, nextStyle]} pointerEvents="none">
                <SuggestionCard suggestion={queue[1]} width={width} />
              </Animated.View>
            ) : null}
            <GestureDetector gesture={pan}>
              <Animated.View style={cardStyle} accessibilityHint="Swipe right to allow, left to say no">
                <SuggestionCard suggestion={top} width={width} />
                <Animated.View style={[styles.stamp, styles.stampApprove, approveStamp]} pointerEvents="none">
                  <Text style={[styles.stampText, { color: '#2BE07B' }]}>{YES_STAMP[topKind]}</Text>
                </Animated.View>
                <Animated.View style={[styles.stamp, styles.stampReject, rejectStamp]} pointerEvents="none">
                  <Text style={[styles.stampText, { color: colors.alarm }]}>NOPE</Text>
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </>
        )}
      </View>

      {top ? (
        <>
          <View style={styles.buttons}>
            <PressableScale style={[styles.round, styles.reject]} onPress={() => fly('reject')} accessibilityRole="button" accessibilityLabel="Say no">
              <Icon name="xmark" size={28} color={colors.alarm} weight="bold" />
            </PressableScale>
            <PressableScale style={[styles.round, styles.approve]} onPress={() => fly('approve')} accessibilityRole="button" accessibilityLabel="Allow it">
              <Icon name="checkmark" size={28} color="#2BE07B" weight="bold" />
            </PressableScale>
          </View>
          <View style={styles.shortcuts}>
            <PressableScale onPress={alwaysAllow} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.shortcut}>Always allow</Text>
            </PressableScale>
            <Text style={styles.dot}>·</Text>
            <PressableScale
              onPress={() => router.push({ pathname: '/settings/agent/[agentId]', params: { agentId: top.agentId } })}
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.shortcut}>{topAgent ? `@${topAgent.handle}'s controls` : 'Agent controls'}</Text>
            </PressableScale>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  count: { color: colors.textSecondary, fontSize: 13, minWidth: 50, textAlign: 'right' },
  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  behind: { position: 'absolute' },
  card: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  wants: { color: colors.textSecondary, fontSize: 12.5, marginTop: 1 },
  cardBody: { padding: 14, gap: 8 },
  caption: { color: colors.text, fontSize: 15.5, lineHeight: 21 },
  link: { color: colors.link, fontSize: 13.5 },
  reason: { color: colors.textTertiary, fontSize: 13, fontStyle: 'italic' },
  stamp: { position: 'absolute', top: 70, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 4, borderRadius: 8 },
  stampApprove: { left: 22, borderColor: '#2BE07B', transform: [{ rotate: '-14deg' }] },
  stampReject: { right: 22, borderColor: colors.alarm, transform: [{ rotate: '14deg' }] },
  stampText: { fontSize: 32, fontWeight: '900', letterSpacing: 2 },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: 48, paddingTop: 12 },
  shortcuts: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 14 },
  shortcut: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  dot: { color: colors.textTertiary },
  round: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2 },
  reject: { borderColor: colors.alarm },
  approve: { borderColor: '#2BE07B' },
});
