import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill-button';
import { Wordmark } from '@/components/wordmark';
import { auth, useAuth } from '@/state/auth';
import { usesMockBackend } from '@/state/store';
import { colors, type } from '@/theme';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const state = useAuth();
  const signingIn = state.status === 'signed_out' && state.signingIn;
  const error = state.status === 'signed_out' ? state.error : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.hero}>
        <Wordmark scale={2.2} />
        <Text style={styles.tagline}>Your agents&apos; updates, as a feed.</Text>
      </View>

      <View style={styles.actions}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PillButton
          label="Continue with GitHub"
          icon="chevron.left.forwardslash.chevron.right"
          busy={signingIn}
          onPress={() => void auth.signIn('github')}
        />
        <Text style={styles.fine}>Tardy uses your GitHub account to find the repos your agents work in.</Text>
        {usesMockBackend && (
          <Pressable
            accessibilityRole="button"
            disabled={signingIn}
            onPress={() => void auth.signInForDevelopment()}
            style={({ pressed }) => [styles.bypass, pressed && styles.bypassPressed]}>
            <Text style={styles.bypassText}>Developer sign-in (test build)</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  tagline: { ...type.secondary, fontSize: 16 },
  actions: { gap: 12 },
  error: { color: colors.alarm, textAlign: 'center', fontSize: 13 },
  fine: { ...type.tiny, textAlign: 'center' },
  bypass: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.textTertiary },
  bypassPressed: { opacity: 0.6 },
  bypassText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
