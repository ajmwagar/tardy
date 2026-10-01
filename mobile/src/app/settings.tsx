import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationSettings } from '@/components/notification-settings';
import { PillButton } from '@/components/pill-button';
import { Avatar, Hairline, Icon, NameLine, PressableScale, VerifiedBadge } from '@/components/ui';
import { openWebCheckout } from '@/config';
import { PROVIDERS } from '@/auth/providers';
import { auth, useAuth } from '@/state/auth';
import { useAccount } from '@/state/store';
import { colors, radius, type } from '@/theme';


export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const state = useAuth();
  const session = state.status === 'signed_in' || state.status === 'onboarding' ? state.signedIn.session : null;
  const account = useAccount(session?.accountId);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = () =>
    Alert.alert('Sign out of Tardy?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          // Resolves once the gate has moved to sign-in; this screen unmounts with it.
          auth.signOut().catch((e: unknown) => {
            setSigningOut(false);
            Alert.alert("Couldn't sign out", e instanceof Error ? e.message : String(e));
          });
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <Section title="Account">
        {account && session && (
          <View style={styles.accountRow}>
            <Avatar account={account} size={52} />
            <View style={styles.grow}>
              <Text style={styles.name}>{account.name}</Text>
              <NameLine account={account} style={styles.handle} />
              <Text style={type.secondary}>Signed in with {PROVIDERS[session.provider].name}</Text>
            </View>
          </View>
        )}
        <Hairline />
        {account?.verified ? (
          <View style={styles.row}>
            <VerifiedBadge size={20} />
            <Text style={[styles.rowTitle, styles.grow]}>Verified</Text>
            <Text style={type.secondary}>Active</Text>
          </View>
        ) : (
          <PressableScale style={styles.row} scaleTo={0.98} onPress={() => void openWebCheckout('verify')} accessibilityRole="button">
            <Icon name="checkmark.seal" size={20} color={colors.primary} />
            <View style={styles.grow}>
              <Text style={styles.rowTitle}>Get verified</Text>
              <Text style={type.secondary}>Opens checkout on the Tardy website.</Text>
            </View>
            <Icon name="arrow.up.right" size={14} color={colors.textSecondary} weight="bold" />
          </PressableScale>
        )}
      </Section>

      {/* Owned by the push-notification session; it brings its own cards. */}
      <Section title="Notifications" plain>
        <NotificationSettings />
      </Section>

      <PillButton label="Sign out" variant="secondary" busy={signingOut} onPress={signOut} style={styles.signOut} />
    </ScrollView>
  );
}

function Section({ title, plain = false, children }: { title: string; plain?: boolean; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {plain ? children : <View style={styles.card}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionTitle: { ...type.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, overflow: 'hidden' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  grow: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  handle: { color: colors.textSecondary, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  signOut: { marginTop: 8 },
});
