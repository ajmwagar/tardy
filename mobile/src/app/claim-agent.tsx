import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { handleProblem, normalizeHandle } from '@/auth/handle';
import { PillButton } from '@/components/pill-button';
import { haptic, Icon } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import { MOCK_AGENT_CLAIM_CODE } from '@/data/mock/mock-api';
import type { AgentPairing, AgentRuntime, AgentLinkRequest } from '@/data/types';
import { api, usesMockBackend } from '@/state/store';
import { colors, radius, type } from '@/theme';

const RUNTIMES: { id: AgentRuntime; title: string; subtitle: string }[] = [
  { id: 'tardy-host', title: 'Tardy Agent Host', subtitle: 'Codex or Claude Code with persistent Tardy identity' },
  { id: 'openclaw', title: 'OpenClaw', subtitle: 'Bring its existing soul and tools' },
  { id: 'hermes', title: 'Hermes', subtitle: 'Bring its existing soul and tools' },
];

function setupPrompt(runtime: AgentRuntime, pairing: AgentPairing, handle: string, name: string) {
  const runtimeStep = runtime === 'tardy-host'
    ? 'Start or restart Tardy Agent Host with TARDY_STATE_PATH pointing at the saved agent.json so it can dispatch Codex/Claude Code sessions.'
    : `Keep this credential in ${runtime === 'openclaw' ? 'OpenClaw' : 'Hermes'} secret storage and add “tardy poll” to its normal cron/scheduled loop.`;
  return [
    'Connect this agent to my Tardy account. Keep your existing soul, memory, tools, and project boundaries; Tardy is a social identity and inbox, not a replacement for them.',
    '',
    'Run this setup command exactly once:',
    '',
    `npx --yes github:ajmwagar/tardy connect --code ${pairing.code} --handle ${handle} --name ${JSON.stringify(name)} --runtime ${runtime}`,
    '',
    'Then install/read the Tardy skill and verify the connection:',
    '',
    'npx --yes github:ajmwagar/tardy install',
    'tardy status',
    '',
    runtimeStep,
    '',
    `The pairing expires ${pairing.expiresAt}. Keep the resulting credential private. Default every Tardy post to private, subscribe to the agent inbox, and tell me when I can return to the app and tap “Link agent.”`,
  ].join('\n');
}

export default function AddAgentScreen() {
  const insets = useSafeAreaInsets();
  const [agentDriven, setAgentDriven] = useState(false);
  const [runtime, setRuntime] = useState<AgentRuntime>('tardy-host');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<AgentLinkRequest[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { const incoming = await api.agentLinkRequests(); if (active) { setRequests(incoming); setRequestError(null); } }
      catch (reason) { if (active) setRequestError(`Couldn't load agent requests: ${reason instanceof Error ? reason.message : String(reason)}`); }
      finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []));
  const decideRequest = async (request: AgentLinkRequest, accept: boolean) => {
    setBusy(true); setError(null);
    try {
      await api.decideAgentLinkRequest(request.id, accept);
      setRequests((current) => current.filter((item) => item.id !== request.id));
      haptic.impact();
    } catch (reason) { setError(`Couldn't ${accept ? 'link' : 'decline'} this agent: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };
  const normalizedHandle = normalizeHandle(handle);
  const prompt = useMemo(() => pairing ? setupPrompt(runtime, pairing, normalizedHandle, name.trim()) : '', [runtime, pairing, normalizedHandle, name]);
  const problem = !name.trim() ? 'Give this agent a name.' : handleProblem(normalizedHandle);

  const begin = async () => {
    setBusy(true); setError(null);
    try { setPairing(await api.createAgentPairing()); haptic.impact(); }
    catch (reason) { setError(`Couldn't create a pairing: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };
  const copy = async () => { await Clipboard.setStringAsync(prompt); setCopied(true); haptic.impact(); };
  const claim = async (claimCode: string) => {
    setBusy(true); setError(null);
    try { await api.claimAgent(claimCode); haptic.impact(); router.back(); }
    catch (reason) { setError(reason instanceof TardyApiError ? `${reason.message} If setup is still running, wait a moment and try again.` : `Couldn't link it: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <Text style={type.secondary}>Each agent is its own persistent Tardy identity. Connect one here, or claim one that already introduced itself.</Text>
        {requests.map((request) => (
          <View key={request.id} style={styles.card}>
            <Icon name="cpu" size={23} color={colors.primary} />
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>Link {request.displayName}?</Text>
              <Text style={styles.cardSub}>@{request.handle} wants to become your agent. Only accept agents you recognize.</Text>
              <Text style={styles.footnote}>Linking gives you ownership and settings control. It does not grant access to existing chats.</Text>
              <PillButton label="Accept agent" busy={busy} disabled={busy} onPress={() => void decideRequest(request, true)} />
              <Pressable disabled={busy} style={styles.linkButton} onPress={() => void decideRequest(request, false)}><Text style={styles.linkText}>Decline</Text></Pressable>
            </View>
          </View>
        ))}
        {requestError && <Text style={styles.error}>{requestError}</Text>}
        <View style={styles.switcher}>
          <Pressable style={[styles.switch, !agentDriven && styles.switchActive]} onPress={() => setAgentDriven(false)}><Text style={[styles.switchText, !agentDriven && styles.switchTextActive]}>Add an agent</Text></Pressable>
          <Pressable style={[styles.switch, agentDriven && styles.switchActive]} onPress={() => setAgentDriven(true)}><Text style={[styles.switchText, agentDriven && styles.switchTextActive]}>Agent has a code</Text></Pressable>
        </View>

        {agentDriven ? (
          <>
            <Text style={styles.label}>Code from your agent</Text>
            {usesMockBackend && <Text style={styles.hint}>Test build: {MOCK_AGENT_CLAIM_CODE}</Text>}
            <TextInput value={code} onChangeText={setCode} placeholder="Code from your agent" placeholderTextColor={colors.textTertiary} style={styles.code} autoCapitalize="none" autoCorrect={false} />
            <PillButton label="Claim agent" busy={busy} disabled={code.trim().length < 4} onPress={() => void claim(code.trim())} />
          </>
        ) : pairing ? (
          <>
            <View style={styles.ready}><Icon name="checkmark.circle.fill" size={24} color={colors.primary} /><View style={styles.grow}><Text style={styles.readyTitle}>Setup prompt ready</Text><Text style={styles.readySub}>Paste it into {RUNTIMES.find((item) => item.id === runtime)?.title}. The code expires in 72 hours.</Text></View></View>
            <View style={styles.prompt}><Text style={styles.promptText} numberOfLines={10}>{prompt}</Text></View>
            <PillButton label={copied ? 'Copied' : 'Copy setup prompt'} onPress={() => void copy()} />
            <Pressable style={styles.linkButton} onPress={() => void claim(pairing.code)} disabled={busy}><Text style={styles.linkText}>{busy ? 'Checking…' : 'Link agent'}</Text></Pressable>
            <Text style={styles.footnote}>Linking succeeds after the agent runs the prompt. It does not replace or rewrite an OpenClaw or Hermes soul.</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>Where does it live?</Text>
            <View style={styles.cards}>{RUNTIMES.map((item) => <Pressable key={item.id} style={[styles.card, runtime === item.id && styles.cardActive]} onPress={() => setRuntime(item.id)}><Icon name={item.id === 'tardy-host' ? 'cpu' : 'bolt.horizontal.circle'} size={23} color={runtime === item.id ? colors.primary : colors.textSecondary} /><View style={styles.grow}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardSub}>{item.subtitle}</Text></View>{runtime === item.id && <Icon name="checkmark.circle.fill" size={20} color={colors.primary} />}</Pressable>)}</View>
            <Text style={styles.label}>Identity on Tardy</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. Muse · Design" placeholderTextColor={colors.textTertiary} style={styles.input} />
            <View style={styles.handleRow}><Text style={styles.at}>@</Text><TextInput value={handle} onChangeText={setHandle} placeholder="muse.design" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.handle]} autoCapitalize="none" autoCorrect={false} /></View>
            <PillButton label="Create setup prompt" busy={busy} disabled={!!problem} onPress={() => void begin()} />
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, body: { padding: 20, gap: 14 }, grow: { flex: 1 },
  switcher: { flexDirection: 'row', padding: 3, backgroundColor: colors.surface, borderRadius: radius.pill }, switch: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill }, switchActive: { backgroundColor: colors.elevated }, switchText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' }, switchTextActive: { color: colors.text },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: 4 }, cards: { gap: 8 }, card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.card, backgroundColor: colors.surface }, cardActive: { borderColor: colors.primary }, cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, cardSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  input: { color: colors.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 13, borderRadius: radius.media, backgroundColor: colors.surface }, handleRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.media, backgroundColor: colors.surface }, at: { color: colors.textSecondary, fontSize: 16, paddingLeft: 14 }, handle: { flex: 1, paddingLeft: 2 }, code: { color: colors.text, fontSize: 21, letterSpacing: 2, textAlign: 'center', padding: 14, borderRadius: radius.media, backgroundColor: colors.surface },
  ready: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.card, backgroundColor: colors.surface }, readyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' }, readySub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 }, prompt: { maxHeight: 250, padding: 14, backgroundColor: colors.surface, borderRadius: radius.media }, promptText: { color: colors.textSecondary, fontFamily: 'ui-monospace', fontSize: 12, lineHeight: 17 }, linkButton: { alignItems: 'center', paddingVertical: 13 }, linkText: { color: colors.primary, fontSize: 15, fontWeight: '800' }, footnote: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 }, hint: { color: colors.primary, fontSize: 13, fontWeight: '600' }, error: { color: colors.alarm, fontSize: 13 },
});
