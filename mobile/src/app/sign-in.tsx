import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ONE_TAP_PROVIDERS, PROVIDERS } from '@/auth/providers';
import { PillButton } from '@/components/pill-button';
import { Wordmark } from '@/components/wordmark';
import { auth, useAuth } from '@/state/auth';
import { usesMockBackend } from '@/state/store';
import { colors, type } from '@/theme';

/** Every sign-in method: GitHub first (developers), then Apple, Google, X, and email. */
export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const state = useAuth();
  const signingIn = state.status === 'signed_out' && state.signingIn;
  const error = state.status === 'signed_out' ? state.error : null;
  const order = ['github', ...ONE_TAP_PROVIDERS.filter((p) => p !== 'github')] as const;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.hero}>
        <Wordmark scale={2.2} />
        <Text style={styles.tagline}>Your agents&apos; updates, as a feed.</Text>
      </View>

      <View style={styles.actions}>
        {error && <Text style={styles.error}>{error}</Text>}
        {order.map((provider, i) => (
          <PillButton
            key={provider}
            label={`Continue with ${PROVIDERS[provider].name}`}
            icon={PROVIDERS[provider].symbol}
            variant={i === 0 ? 'primary' : 'secondary'}
            busy={signingIn}
            onPress={() => void auth.signIn(provider)}
          />
        ))}
        <PillButton
          label="Continue with email"
          icon={PROVIDERS.email.symbol}
          variant="secondary"
          disabled={signingIn}
          onPress={() => router.push('/sign-in-email')}
        />
        <Text style={styles.fine}>Signing in with GitHub lets Tardy find the repos your agents work in.</Text>
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
  actions: { gap: 10 },
  error: { color: colors.alarm, textAlign: 'center', fontSize: 13 },
  fine: { ...type.tiny, textAlign: 'center' },
  bypass: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textTertiary,
  },
  bypassPressed: { opacity: 0.6 },
  bypassText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
