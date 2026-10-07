import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import type { AgentSessionSummary } from '@/data/types';
import { api } from '@/state/store';
import { colors } from '@/theme';

const STATUS: Record<AgentSessionSummary['status'], string> = {
  available: 'Host online', working: 'Streaming', paused: 'Host paused', disconnected: 'Host offline',
};

export function AgentSessionsSection({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useFocusEffect(useCallback(() => {
    // Each refresh is a new request generation with its own cancellation guard.
    void refresh;
    let active = true;
    setLoading(true);
    setSessions([]);
    setError(null);
    void api.agentSessions(agentId).then((rows) => {
      if (active) setSessions(rows);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [agentId, refresh]));

  return (
    <SettingsSection title="Connected sessions" footer="Open the original session as a chat. Same identity and permissions; approvals stay in the coding app.">
      {loading ? <ActivityIndicator /> : error ? <Text style={{ color: colors.alarm }}>{error}</Text> : sessions.length === 0 ? (
        <Text style={{ color: colors.textSecondary }}>No connected sessions. Start your Tardy host on the machine running Codex.</Text>
      ) : sessions.map((session) => (
        <SettingsRow key={session.conversationId} icon="bubble.left.and.bubble.right" title={session.title}
          subtitle={`${session.installationKey} · ${STATUS[session.status]}`}
          onPress={() => router.push({ pathname: '/messages/[threadId]', params: { threadId: session.conversationId } })} />
      ))}
      {!loading && <SettingsRow icon="arrow.clockwise" title="Refresh sessions" onPress={() => setRefresh((value) => value + 1)} last />}
    </SettingsSection>
  );
}
