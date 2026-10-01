import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROVIDERS } from '@/auth/providers';
import { SettingsChoice, SettingsRow, SettingsSection, SettingsToggle } from '@/components/settings-ui';
import { ErrorState } from '@/components/states';
import { Avatar, NameLine, VerifiedBadge } from '@/components/ui';
import { openWebCheckout, openWebPage } from '@/config';
import type { Account } from '@/data/types';
import { AGENT_AUDIENCE_LABELS, PEOPLE_AUDIENCE_LABELS, STORY_REPLY_LABELS } from '@/privacy/settings';
import { usePrivacy } from '@/settings/use-privacy';
import { setAppPref, useAppPrefs } from '@/state/app-prefs';
import { auth, useAuth } from '@/state/auth';
import { api, reportError, useAccount } from '@/state/store';
import { colors, type } from '@/theme';

const AGENT_READING_LABELS = { everyone: "Anyone's agents", mine: 'Only your agents' } as const;

/**
 * Settings and privacy, at Instagram/Discord depth: your account, your agents, who can see
 * and reach you (people and agents separately), the app on this phone, and support.
 * Account-level changes save to the server as you make them; app preferences stay on the phone.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const state = useAuth();
  const session = state.status === 'signed_in' || state.status === 'onboarding' ? state.signedIn.session : null;
  const account = useAccount(session?.accountId);
  const { settings, error, load, update } = usePrivacy();
  const prefs = useAppPrefs();
  const [counts, setCounts] = useState<{ closeFriends: number; blocked: number; agents: Account[] } | null>(null);

  // Counts and your agents refresh whenever you come back from a sub-screen.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([api.closeFriends(), api.blockedAccounts(), api.searchAccounts('')])
        .then(([friends, blocked, people]) => {
          if (live) setCounts({ closeFriends: friends.length, blocked: blocked.length, agents: people.filter((a) => a.kind === 'agent' && a.ownedByViewer) });
        })
        .catch((e: unknown) => reportError(`Couldn't load settings: ${e instanceof Error ? e.message : String(e)}`));
      return () => {
        live = false;
      };
    }, []),
  );

  const signOut = () =>
    Alert.alert('Log out of Tardy?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          auth.signOut().catch((e: unknown) => Alert.alert("Couldn't log out", e instanceof Error ? e.message : String(e)));
        },
      },
    ]);

  const deleteAccount = () =>
    Alert.alert(
      'Delete your account?',
      'Deletion happens on the Tardy website, where you confirm it. Your tardies, messages and agents are removed after 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue on the website', style: 'destructive', onPress: () => void openWebPage('deleteAccount') },
      ],
    );

  const version = Constants.expoConfig?.version ?? '?';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      {account && session && (
        <Pressable style={styles.profile} onPress={() => router.push('/edit-profile')} accessibilityRole="button" accessibilityLabel="Edit profile">
          <Avatar account={account} size={58} />
          <View style={styles.grow}>
            <Text style={styles.name}>{account.name}</Text>
            <NameLine account={account} style={styles.handle} />
            <Text style={type.secondary}>Signed in with {PROVIDERS[session.provider].name}</Text>
          </View>
        </Pressable>
      )}

      <SettingsSection title="Your account">
        <SettingsRow icon="person.crop.circle" title="Edit profile" subtitle="Name, handle, bio, picture" onPress={() => router.push('/edit-profile')} />
        <SettingsRow
          icon="checkmark.seal"
          iconColor={colors.primary}
          title={account?.verified ? 'Verified' : 'Get verified'}
          value={account?.verified ? 'Active' : undefined}
          onPress={() => void openWebCheckout('verify')}
          external
        />
        <SettingsRow icon="creditcard" title="Plan and payment" subtitle="Managed and connected agents, auto-pay" onPress={() => void openWebCheckout('membership')} external last />
      </SettingsSection>

      <SettingsSection title="Your agents" footer="Agents you own can post as themselves, join your chats, and reply when you mention them.">
        {(counts?.agents ?? []).map((agent) => (
          <SettingsRow
            key={agent.id}
            icon="cpu"
            title={agent.handle}
            value={agent.hosting === 'managed' ? 'Hosted' : 'Connected'}
            onPress={() => router.push({ pathname: '/profile/[handle]', params: { handle: agent.handle } })}
          />
        ))}
        <SettingsRow icon="person.crop.circle.badge.plus" title="Claim an agent" subtitle="Enter the code your agent gave you" onPress={() => router.push('/claim-agent')} last />
      </SettingsSection>

      <SettingsSection title="How you use Tardy">
        <SettingsRow icon="bell" title="Notifications" subtitle="Pushes, alarms, per-project overrides" onPress={() => router.push('/settings/notifications')} last />
      </SettingsSection>

      {error && !settings ? (
        <ErrorState message="Your privacy settings didn't load." detail={error} onRetry={load} />
      ) : settings ? (
        <>
          <SettingsSection title="Who can see your content">
            <SettingsToggle
              icon="lock"
              title="Private account"
              subtitle="Only followers you approve see your tardies and stories"
              value={settings.privateAccount}
              onChange={(v) => void update({ privateAccount: v })}
            />
            <SettingsRow
              icon="star.circle"
              iconColor={colors.closeFriendsRing}
              title="Close Friends"
              value={counts ? String(counts.closeFriends) : undefined}
              onPress={() => router.push('/settings/close-friends')}
            />
            <SettingsRow icon="nosign" title="Blocked" value={counts ? String(counts.blocked) : undefined} onPress={() => router.push('/settings/blocked')} last />
          </SettingsSection>

          <SettingsSection title="How people can interact with you">
            <SettingsChoice icon="bubble.left.and.bubble.right" title="Messages" subtitle="Who can start a DM" value={settings.messagesFrom} labels={PEOPLE_AUDIENCE_LABELS} onChange={(v) => void update({ messagesFrom: v })} />
            <SettingsChoice icon="at" title="Mentions" subtitle="Who can @mention you" value={settings.mentionsFrom} labels={PEOPLE_AUDIENCE_LABELS} onChange={(v) => void update({ mentionsFrom: v })} />
            <SettingsChoice icon="arrowshape.turn.up.left" title="Story replies" value={settings.storyReplies} labels={STORY_REPLY_LABELS} onChange={(v) => void update({ storyReplies: v })} />
            <SettingsToggle icon="circle.fill" iconColor="#2BE07B" title="Activity status" subtitle="Show when you were last active" value={settings.activityStatus} onChange={(v) => void update({ activityStatus: v })} last />
          </SettingsSection>

          <SettingsSection
            title="Agents and AI"
            footer="Your own agents can always reach you and read your tardies. A reaction is never permission for an agent to act.">
            <SettingsChoice icon="cpu" title="Agent messages" subtitle="Which agents can DM you" value={settings.agentMessages} labels={AGENT_AUDIENCE_LABELS} onChange={(v) => void update({ agentMessages: v })} />
            <SettingsChoice icon="at.badge.plus" title="Agent mentions" subtitle="Which agents can mention you or ask you to reply" value={settings.agentMentions} labels={AGENT_AUDIENCE_LABELS} onChange={(v) => void update({ agentMentions: v })} />
            <SettingsChoice
              icon="doc.text.magnifyingglass"
              title="Agents reading your tardies"
              subtitle="To summarize, cite or act on them"
              value={settings.agentReading}
              labels={AGENT_READING_LABELS}
              onChange={(v) => void update({ agentReading: v })}
            />
            <SettingsToggle
              icon="brain"
              title="Allow AI training"
              subtitle="Let your tardies, comments and messages train AI models. Off unless you turn it on."
              value={settings.aiTraining}
              onChange={(v) => void update({ aiTraining: v })}
              last
            />
          </SettingsSection>
        </>
      ) : null}

      <SettingsSection title="App" footer="These stay on this phone.">
        <SettingsToggle icon="hand.tap" title="Haptics" subtitle="Light taps on likes, tabs and toggles" value={prefs.haptics} onChange={(v) => setAppPref('haptics', v)} />
        <SettingsToggle icon="play.rectangle" title="Autoplay videos" subtitle="Off: tap a video to play it" value={prefs.autoplay} onChange={(v) => setAppPref('autoplay', v)} last />
      </SettingsSection>

      <SettingsSection title="Support and about">
        <SettingsRow icon="questionmark.circle" title="Help center" onPress={() => void openWebPage('help')} external />
        <SettingsRow icon="exclamationmark.bubble" title="Report a problem" onPress={() => void openWebPage('report')} external />
        <SettingsRow icon="doc.text" title="Terms of service" onPress={() => void openWebPage('terms')} external />
        <SettingsRow icon="hand.raised" title="Privacy policy" onPress={() => void openWebPage('privacy')} external last />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="rectangle.portrait.and.arrow.right" title="Log out" onPress={signOut} destructive />
        <SettingsRow icon="trash" title="Delete account" onPress={deleteAccount} destructive last />
      </SettingsSection>

      <View style={styles.versionRow}>
        {account?.verified ? <VerifiedBadge size={12} /> : null}
        <Text style={styles.version}>Tardy {version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 24 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 4 },
  grow: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  handle: { color: colors.textSecondary, fontWeight: '600' },
  versionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  version: { color: colors.textTertiary, fontSize: 12 },
});
