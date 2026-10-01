import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MOCK_EMAIL_CODE } from '@/data/mock/mock-auth';
import { PillButton } from '@/components/pill-button';
import { TardyApiError } from '@/data/api';
import { auth, useAuth } from '@/state/auth';
import { api, usesMockBackend } from '@/state/store';
import { colors, radius, type } from '@/theme';

const CODE_LENGTH = 6;

/** Passwordless email: enter your address, get a 6-digit code, enter it. */
export default function EmailSignInScreen() {
  const insets = useSafeAreaInsets();
  const state = useAuth();
  const signingIn = state.status === 'signed_out' && state.signingIn;
  const authError = state.status === 'signed_out' ? state.error : null;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      await api.requestEmailCode(email.trim());
      setSentTo(email.trim());
      setCode('');
    } catch (e) {
      setError(e instanceof TardyApiError ? e.message : `Couldn't send a code: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  const verify = () => {
    if (sentTo) void auth.signInWithEmail(sentTo, code);
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen options={{ headerShown: true, headerTitle: '', headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }} />
      <View style={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {sentTo === null ? (
          <>
            <Text style={type.title}>Sign in with email</Text>
            <Text style={type.secondary}>We&apos;ll email you a 6-digit code. No password.</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={sendCode}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <PillButton label="Send code" busy={sending} disabled={!email.includes('@')} onPress={sendCode} />
          </>
        ) : (
          <>
            <Text style={type.title}>Check your email</Text>
            <Text style={type.secondary}>Enter the code we sent to {sentTo}.</Text>
            {usesMockBackend && <Text style={styles.hint}>Test build: the code is {MOCK_EMAIL_CODE}.</Text>}
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="123456"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, styles.code]}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              maxLength={CODE_LENGTH}
            />
            {authError && <Text style={styles.error}>{authError}</Text>}
            <PillButton label="Sign in" busy={signingIn} disabled={code.length !== CODE_LENGTH} onPress={verify} />
            <PillButton label="Use a different email" variant="secondary" size="small" onPress={() => setSentTo(null)} />
            <PillButton label="Back to all sign-in options" variant="secondary" size="small" onPress={() => router.back()} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 14 },
  input: {
    color: colors.text,
    fontSize: 17,
    backgroundColor: colors.surface,
    borderRadius: radius.media,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontVariant: ['tabular-nums'] },
  hint: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: colors.alarm, fontSize: 13 },
});
