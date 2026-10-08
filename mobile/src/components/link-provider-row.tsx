import { useState } from 'react';
import { Alert } from 'react-native';
import { auth } from '@/state/auth';
import { SettingsRow } from './settings-ui';

export function LinkProviderRow({ provider }: { provider: 'apple' | 'github' }) {
  const [busy, setBusy] = useState(false);
  const label = provider === 'apple' ? 'Apple' : 'GitHub';
  return <SettingsRow icon={provider === 'apple' ? 'apple.logo' : 'chevron.left.forwardslash.chevron.right'}
    title={`Link ${label}`} subtitle={busy ? 'Connecting…' : 'Use this identity to sign in to the same account'}
    onPress={() => {
      if (busy) return;
      Alert.alert(`Link ${label} to your Tardy account?`, 'This does not merge another Tardy account or grant repository access.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Link account', onPress: () => {
          setBusy(true);
          auth.linkProvider(provider).catch((error: unknown) => Alert.alert('Could not link account', error instanceof Error ? error.message : String(error)))
            .finally(() => setBusy(false));
        } },
      ]);
    }} />;
}
