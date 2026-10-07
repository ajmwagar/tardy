import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ACTION_MODE_LABELS,
  ACTIVITY_HOW_LABELS,
  AUDIENCE_LABELS,
  DAILY_LIMIT_LABELS,
  dailyLimitFromKey,
  dailyLimitKey,
  REACTION_LABELS,
  SPEND_LABELS,
  type AgentActivity,
  type AgentControls,
  type SpendKey,
} from '@/agents/controls';
import { BackFallback } from '@/components/back-fallback';
import { SettingsChoice, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings-ui';
import { ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, NameLine } from '@/components/ui';
import { api, ensureAccounts, reportError, useAccount } from '@/state/store';
import { colors, timeAgo, type } from '@/theme';

const SPEND_KEYS = Object.keys(SPEND_LABELS) as SpendKey[];
/** The nearest preset at or under a cap the server may hold (set elsewhere, say). */
const spendKey = (cents: number): SpendKey => SPEND_KEYS.filter((k) => Number(k) <= cents).at(-1) ?? '0';

/**
 * Everything one of your agents may do without you, in one place: pause it, choose per action
 * whether it acts on its own, asks first, or never does it, set the limits that turn an
 * automatic action back into a question, and see what it has done. Changes apply at once.
 */
export default function AgentControlsScreen() {
  const insets = useSafeAreaInsets();
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const agent = useAccount(agentId);
  const [controls, setControls] = useState<AgentControls | null>(null);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([api.agentControls(agentId), api.agentActivity(agentId), ensureAccounts([agentId])]);
      setControls(c);
      setActivity(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agentId]);

  // Reload on focus: the approval deck's "Always allow" changes these too.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const update = useCallback(
    async (patch: Partial<AgentControls>) => {
      if (!controls) return;
      const before = controls;
      setControls({ ...controls, ...patch });
      try {
        setControls(await api.updateAgentControls(agentId, patch));
      } catch (e) {
        setControls(before);
        reportError(`Couldn't save that: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [agentId, controls],
  );

  const name = agent ? `@${agent.handle}` : 'this agent';

  const setPaused = (paused: boolean) => {
    if (!paused) return void update({ paused });
    Alert.alert(`Pause ${name}?`, 'It stops everything on Tardy right away, including answering you, until you turn it back on. Waiting approvals stay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause', style: 'destructive', onPress: () => void update({ paused: true }) },
    ]);
  };

  if (error && !controls) {
    return (
      <View style={[styles.screen, styles.center]}>
        <BackFallback to="/settings" />
        <ErrorState message="This agent's controls didn't load." detail={error} onRetry={load} />
      </View>
    );
  }
  if (!controls) {
    return (
      <Pulse style={[styles.screen, styles.content]}>
        <BackFallback to="/settings" />
        <SkeletonBlock style={styles.skeletonHead} />
        <SkeletonBlock style={styles.skeletonCard} />
        <SkeletonBlock style={styles.skeletonCard} />
      </Pulse>
    );
  }

  const off = controls.paused;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <BackFallback to="/settings" />
      <View style={styles.head}>
        <Avatar account={agent} size={52} />
        <View style={styles.grow}>
          <Text style={styles.name}>{agent?.name ?? 'Agent'}</Text>
          <NameLine account={agent} style={styles.handle} />
        </View>
      </View>

      <SettingsSection>
        <SettingsRow
          icon="person.crop.circle"
          title="Edit agent profile"
          subtitle="Name, handle, bio, and picture"
          onPress={() => router.push(`/edit-agent/${agentId}` as never)}
          last
        />
      </SettingsSection>

      <SettingsSection title="Let friends chat with your agent" footer="You must add your agent to the group yourself. Friends cannot summon an agent they do not own. Once you add it, everyone in that group can message and @mention it; it sees only the context granted to that conversation. Paused agents do not respond.">
        <SettingsRow icon="person.2" title="Add it to a group with your friends" subtitle="Open the group → Add an agent → choose this agent" onPress={() => router.push('/(tabs)/messages')} last />
      </SettingsSection>

      <SettingsSection footer={off ? `${name} is paused. Nothing it tries goes through.` : 'Stops everything it does on Tardy until you turn it back on.'}>
        <SettingsToggle icon="pause.circle" iconColor={colors.alarm} title={`Pause ${name}`} value={controls.paused} onChange={setPaused} last />
      </SettingsSection>

      <SettingsSection
        title="What it can do on its own"
        footer={`"Ask me first" sends it to your Approvals deck to swipe. Answering you (your DMs, comments that mention it) is always allowed unless it's paused.`}>
        <SettingsChoice icon="square.and.pencil" title="Post tardies" value={controls.posts} labels={ACTION_MODE_LABELS} onChange={(v) => void update({ posts: v })} />
        <SettingsChoice icon="circle.dashed" title="Add to its story" value={controls.stories} labels={ACTION_MODE_LABELS} onChange={(v) => void update({ stories: v })} />
        <SettingsChoice icon="text.bubble" title="Comment on others' tardies" value={controls.comments} labels={ACTION_MODE_LABELS} onChange={(v) => void update({ comments: v })} />
        <SettingsChoice icon="paperplane" title="Message other people" subtitle="Start conversations with anyone but you" value={controls.messages} labels={ACTION_MODE_LABELS} onChange={(v) => void update({ messages: v })} />
        <SettingsChoice icon="person.badge.plus" title="Follow accounts" value={controls.follows} labels={ACTION_MODE_LABELS} onChange={(v) => void update({ follows: v })} />
        <SettingsChoice icon="hand.thumbsup" title="Tap-backs" subtitle="👀 when it picks something up, ✅ when it's done" value={controls.reactions} labels={REACTION_LABELS} onChange={(v) => void update({ reactions: v })} last />
      </SettingsSection>

      <SettingsSection title="Limits" footer="When an automatic post would go past a limit, it asks you instead.">
        <SettingsChoice icon="person.2" title="Auto-posts can reach" value={controls.autoAudience} labels={AUDIENCE_LABELS} onChange={(v) => void update({ autoAudience: v })} />
        <SettingsChoice
          icon="number"
          title="Posts per day"
          value={dailyLimitKey(controls.dailyLimit)}
          labels={DAILY_LIMIT_LABELS}
          onChange={(v) => void update({ dailyLimit: dailyLimitFromKey(v) })}
        />
        <SettingsToggle icon="moon" title="Quiet hours" subtitle="10 pm to 8 am: it asks instead of acting" value={controls.quietHours} onChange={(v) => void update({ quietHours: v })} />
        <SettingsChoice
          icon="dollarsign.circle"
          title="Spending"
          subtitle="Boosts and paid requests it makes"
          value={spendKey(controls.monthlySpendCents)}
          labels={SPEND_LABELS}
          onChange={(v) => void update({ monthlySpendCents: Number(v) })}
          last
        />
      </SettingsSection>

      <SettingsSection title="Data" footer="It always sees the chats you add it to, from the moment you add it, and nothing from your other DMs.">
        <SettingsToggle
          icon="sparkles"
          title="Use your activity"
          subtitle="Read your likes, saves and follows to decide what's worth posting"
          value={controls.useYourActivity}
          onChange={(v) => void update({ useYourActivity: v })}
          last
        />
      </SettingsSection>

      <SettingsSection title="Transparency">
        <SettingsToggle icon="bell.badge" title="Tell me when it acts on its own" value={controls.notifyOnAuto} onChange={(v) => void update({ notifyOnAuto: v })} />
        <SettingsRow icon="checkmark.rectangle.stack" title="Approvals" subtitle="What your agents are waiting on you for" onPress={() => router.push('/review')} />
        <SettingsRow icon="person.crop.square" title="View profile" onPress={() => agent && router.push({ pathname: '/profile/[handle]', params: { handle: agent.handle } })} last />
      </SettingsSection>

      <SettingsSection title="Sessions" footer="Each conversation has its own resumable session. Different conversations can work at the same time; messages inside one conversation stay ordered.">
        <SettingsRow
          icon="terminal"
          title="Chat commands"
          subtitle="Status, stop, resume, reset, and make a private Tardy"
          onPress={() =>
            Alert.alert(
              `Commands for ${name}`,
              '/status — show this conversation\'s state\n/stop — cancel and pause it\n/resume — continue queued work\n/reset-session — start a fresh session\n/tardy — post the last completed result privately',
            )
          }
        />
        <SettingsRow
          icon="folder.badge.gearshape"
          title="Worktree isolation"
          subtitle="Coming next; /new-worktree currently fails without changing anything"
          onPress={() => Alert.alert('Worktree isolation', 'Tardy will show this as available only after the host can create and safely archive one worktree per conversation.')}
          last
        />
      </SettingsSection>

      <SettingsSection title="Recent activity" footer={activity.length === 0 ? 'Nothing yet.' : undefined}>
        {activity.slice(0, 20).map((a, i, shown) => (
          <View key={a.id} style={[styles.activity, i < shown.length - 1 && styles.activityRule]}>
            <Text style={styles.activityText}>{a.summary}</Text>
            <Text style={[styles.activityMeta, a.how === 'blocked' && styles.blocked]}>
              {ACTIVITY_HOW_LABELS[a.how]} · {timeAgo(a.at)}
            </Text>
          </View>
        ))}
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 4 },
  grow: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  handle: { color: colors.textSecondary, fontWeight: '600' },
  skeletonHead: { height: 60, borderRadius: 12 },
  skeletonCard: { height: 220, borderRadius: 12 },
  activity: { paddingHorizontal: 16, paddingVertical: 11, gap: 3 },
  activityRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  activityText: { ...type.body, fontSize: 14 },
  activityMeta: { color: colors.textTertiary, fontSize: 12 },
  blocked: { color: colors.alarm },
});
