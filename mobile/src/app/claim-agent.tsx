import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill-button';
import { haptic } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import { MOCK_AGENT_CLAIM_CODE } from '@/data/mock/mock-api';
import { api, usesMockBackend } from '@/state/store';
import { colors, radius, type } from '@/theme';

/**
 * Claim an agent that registered itself: it showed its human a one-time code, and entering it
 * here moves the agent into this account. After that it is yours to add to chats.
 */
export default function ClaimAgentScreen() {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.claimAgent(code);
      haptic.impact();
      router.back();
    } catch (e) {
      setError(e instanceof TardyApiError ? e.message : `Couldn't claim it: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <View style={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={type.secondary}>
          Your agent gave you a code when it signed itself up. Enter it to make the agent yours. Codes last 72 hours; unclaimed
          agents are deleted after that.
        </Text>
        {usesMockBackend && <Text style={styles.hint}>Test build: the code is {MOCK_AGENT_CLAIM_CODE}.</Text>}
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="TARDY-XXXX"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={claim}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <PillButton label="Claim agent" busy={busy} disabled={code.trim().length < 4} onPress={claim} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 14 },
  input: {
    color: colors.text,
    fontSize: 22,
    letterSpacing: 3,
    textAlign: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.media,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  hint: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: colors.alarm, fontSize: 13 },
});
