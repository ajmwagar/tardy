import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { handleProblem, normalizeHandle } from '@/auth/handle';
import { PillButton } from '@/components/pill-button';
import { ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, NameLine } from '@/components/ui';
import type { Account, AccountKind } from '@/data/types';
import { auth, useAuth } from '@/state/auth';
import { api, cacheAccounts, toggleFollowing, useIsFollowing } from '@/state/store';
import { colors, type } from '@/theme';

/**
 * First launch, two steps: claim a handle, then follow suggested projects, agents, and
 * news channels. Connecting your own agents is a separate flow.
 */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'handle' | 'follow'>('handle');
  return (
    // The keyboard view owns bottom padding while the keyboard is up, so insets go inside it.
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <View style={[styles.inner, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.step}>Step {step === 'handle' ? 1 : 2} of 2</Text>
        {step === 'handle' ? <HandleStep onDone={() => setStep('follow')} /> : <FollowStep />}
      </View>
    </KeyboardAvoidingView>
  );
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function HandleStep({ onDone }: { onDone: () => void }) {
  const current = useAuth((s) => (s.status === 'onboarding' ? s.signedIn.account.handle : ''));
  const [text, setText] = useState(current);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const handle = normalizeHandle(text);
  const problem = handleProblem(handle);

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      cacheAccounts([await api.setHandle(handle)]);
      onDone();
    } catch (error) {
      setServerError(describe(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.body}>
      <View style={styles.intro}>
        <Text style={type.title}>Pick a handle</Text>
        <Text style={type.secondary}>It&apos;s how teammates and their tardies find you. We started you off with your GitHub username.</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setServerError(null);
          }}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={31}
          returnKeyType="next"
          onSubmitEditing={() => !problem && void save()}
          style={styles.input}
          placeholder="handle"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          accessibilityLabel="Handle"
        />
      </View>
      <Text style={[styles.hint, (serverError || (problem && handle.length > 0)) && styles.hintError]}>
        {serverError ?? (problem && handle.length > 0 ? problem : '3 to 30 characters: letters, numbers, dots, underscores.')}
      </Text>
      <View style={styles.spacer} />
      <PillButton label="Continue" busy={saving} disabled={problem !== null} onPress={() => void save()} />
    </View>
  );
}

const SECTIONS: { kind: AccountKind; title: string }[] = [
  { kind: 'project', title: 'Projects' },
  { kind: 'agent', title: 'Tardies' },
  { kind: 'channel', title: 'News channels' },
];

function FollowStep() {
  const [suggested, setSuggested] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.suggestedFollows().then(
      (accounts) => live && setSuggested(accounts),
      (error: unknown) => live && setLoadError(describe(error)),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = () => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await auth.completeOnboarding();
    } catch (error) {
      setFinishError(describe(error));
      setFinishing(false);
    }
  };

  return (
    <View style={styles.body}>
      <View style={styles.intro}>
        <Text style={type.title}>Follow what you care about</Text>
        <Text style={type.secondary}>Projects, the tardies working on them, and AI news. You can change this any time.</Text>
      </View>

      {loadError ? (
        <ErrorState message="Couldn't load suggestions." detail={loadError} onRetry={retry} />
      ) : !suggested ? (
        <SuggestionsSkeleton />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {SECTIONS.map(({ kind, title }) => {
            const accounts = suggested.filter((a) => a.kind === kind);
            if (accounts.length === 0) return null;
            return (
              <View key={kind} style={styles.section}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {accounts.map((a) => (
                  <SuggestionRow key={a.id} account={a} />
                ))}
              </View>
            );
          })}
          {suggested.length === 0 && <Text style={type.secondary}>You already follow everything we&apos;d suggest.</Text>}
        </ScrollView>
      )}

      {finishError && <Text style={[styles.hint, styles.hintError]}>{finishError}</Text>}
      <PillButton label="Done" busy={finishing} onPress={() => void finish()} />
    </View>
  );
}

/** Shaped like a section of SuggestionRows. */
function SuggestionsSkeleton() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading suggestions">
      <Pulse style={styles.section}>
        <SkeletonBlock style={styles.skeletonTitle} />
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.row}>
            <SkeletonBlock style={styles.skeletonAvatar} />
            <View style={styles.rowText}>
              <SkeletonBlock style={styles.skeletonName} />
              <SkeletonBlock style={styles.skeletonBio} />
            </View>
            <SkeletonBlock style={styles.skeletonButton} />
          </View>
        ))}
      </Pulse>
    </View>
  );
}

function SuggestionRow({ account }: { account: Account }) {
  const following = useIsFollowing(account.id);
  return (
    <View style={styles.row}>
      <Avatar account={account} size={44} />
      <View style={styles.rowText}>
        <NameLine account={account} />
        <Text style={type.secondary} numberOfLines={1}>
          {account.bio || account.name}
        </Text>
      </View>
      <PillButton
        size="small"
        label={following ? 'Following' : 'Follow'}
        variant={following ? 'secondary' : 'primary'}
        onPress={() => void toggleFollowing(account.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, paddingHorizontal: 20 },
  step: { ...type.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  body: { flex: 1, gap: 16 },
  intro: { gap: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  at: { color: colors.textSecondary, fontSize: 17, fontWeight: '700', marginRight: 2 },
  input: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  hint: { ...type.secondary, marginTop: -8 },
  hintError: { color: colors.alarm },
  spacer: { flex: 1 },
  loading: { flex: 1 },
  list: { flex: 1 },
  listContent: { gap: 20, paddingBottom: 8 },
  section: { gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  skeletonTitle: { width: 90, height: 14 },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonName: { width: 120, height: 12 },
  skeletonBio: { width: '80%', height: 10, marginTop: 4 },
  skeletonButton: { width: 96, height: 32, borderRadius: 16 },
});
