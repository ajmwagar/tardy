import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '@/config';
import { dataSource, probeBackend } from '@/dev/diagnostics';
import { useAuth } from '@/state/auth';
import { colors, type } from '@/theme';

type Probe = { state: 'loading' } | { state: 'ready'; latencyMs: number; version: string | null } | { state: 'error'; message: string };

export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });
  const refresh = useCallback(() => {
    setProbe({ state: 'loading' });
    probeBackend(config.apiUrl)
      .then(({ latencyMs, serverVersion }) => setProbe({ state: 'ready', latencyMs, version: serverVersion }))
      .catch((error: unknown) => setProbe({ state: 'error', message: error instanceof Error ? error.message : String(error) }));
  }, []);
  useEffect(refresh, [refresh]);
  const signedIn = auth.status === 'signed_in' || auth.status === 'onboarding' ? auth.signedIn : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={type.secondary}>Development only. This screen is omitted from release builds.</Text>
      <View style={styles.card}>
        <Row label="Data source" value={dataSource(config.apiUrl)} />
        <Row label="API origin" value={config.apiUrl ?? 'in-app mock'} />
        <Row label="Profile" value={signedIn ? `@${signedIn.account.handle} · ${signedIn.account.id}` : 'signed out'} />
        <Row label="Provider" value={signedIn?.session.provider ?? '—'} />
        <Row label="Server" value={probe.state === 'ready' ? probe.version ?? 'revision not exposed' : probe.state} />
        <Row label="Latency" value={probe.state === 'ready' ? `${probe.latencyMs} ms` : probe.state === 'error' ? probe.message : 'checking…'} last />
      </View>
      <Pressable style={styles.button} onPress={refresh} accessibilityRole="button">
        <Text style={styles.buttonText}>Run check again</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <View style={[styles.row, last && styles.last]}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' },
  row: { padding: 14, borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth, gap: 5 },
  last: { borderBottomWidth: 0 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: colors.text, fontSize: 14 },
  button: { backgroundColor: colors.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
});
