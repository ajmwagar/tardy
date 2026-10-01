import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { TardyApiError } from '@/data/api';
import type { Account, NotificationKind, NotificationPreferences } from '@/data/types';
import { devPushAvailable, devPushEvents, emitDevPush } from '@/notifications/dev-trigger';
import { NOTIFICATION_KINDS, overrideFor, WORK_KINDS, withDefault, withOverride } from '@/notifications/preferences';
import { requestPushPermission, usePushStatus, type PushStatus } from '@/notifications/push';
import { api, ensureAccounts, getState } from '@/state/store';
import { colors, radius, type } from '@/theme';

import { Avatar, Hairline, haptic, Icon, PressableScale } from './ui';

const LABELS: Record<NotificationKind, { title: string; detail: string }> = {
  blocked: { title: 'Blocked', detail: 'An agent is stuck and needs a call from you.' },
  review_requested: { title: 'Review requested', detail: 'An agent wants your eyes on a PR.' },
  shipped: { title: 'Shipped', detail: 'An agent shipped something.' },
  comment: { title: 'Comments', detail: 'Someone commented on your post.' },
  mention: { title: 'Mentions', detail: 'Someone mentioned you.' },
  like: { title: 'Thumbs up', detail: 'Someone gave your post a thumbs up.' },
  follow: { title: 'New followers', detail: 'Someone started following you.' },
};

const SOCIAL_KINDS = NOTIFICATION_KINDS.filter((k) => !WORK_KINDS.includes(k));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Push preferences: the device permission, a default per kind, and per-project overrides
 * for agent work. Renders as a plain column (no scroll view) so the settings screen can
 * place it inside its own scroll. Edits apply immediately and roll back on failure.
 */
export function NotificationSettings() {
  const push = usePushStatus();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [projects, setProjects] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [loaded, following] = await Promise.all([api.notificationPreferences(), api.followingIds()]);
      // Projects worth tuning: ones the viewer follows, plus any they've already overridden.
      const ids = [...new Set([...following, ...loaded.overrides.map((o) => o.projectId)])];
      await ensureAccounts(ids);
      const accounts = getState().accounts;
      const found = ids.map((id) => accounts.get(id)).filter((a): a is Account => a?.kind === 'project');
      if (!live) return;
      setPrefs(loaded);
      setProjects(found.sort((a, b) => a.name.localeCompare(b.name)));
    })().catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, []);

  /** Optimistic write: show `next` now, take the server's answer, or roll back loudly. */
  const save = async (next: NotificationPreferences, write: () => Promise<NotificationPreferences>) => {
    const before = prefs;
    setPrefs(next);
    setError(null);
    try {
      setPrefs(await write());
    } catch (e) {
      setPrefs(before);
      setError(message(e));
    }
  };

  const setDefault = (kind: NotificationKind, enabled: boolean) =>
    prefs && save(withDefault(prefs, kind, enabled), () => api.setNotificationDefault(kind, enabled));

  const setOverride = (projectId: string, kind: NotificationKind, enabled: boolean | null) =>
    prefs && save(withOverride(prefs, projectId, kind, enabled), () => api.setNotificationOverride(projectId, kind, enabled));

  return (
    <View style={styles.container}>
      <PermissionCard status={push} />

      {!prefs ? (
        error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.textSecondary} style={styles.loading} />
      ) : (
        <>
          <Section title="Agent work" footer="Posts you've set an alarm on always ping you when their status changes, unless that kind is off here.">
            {WORK_KINDS.map((k) => (
              <ToggleRow key={k} kind={k} value={prefs.defaults[k]} onChange={(v) => setDefault(k, v)} />
            ))}
          </Section>

          <Section title="Social">
            {SOCIAL_KINDS.map((k) => (
              <ToggleRow key={k} kind={k} value={prefs.defaults[k]} onChange={(v) => setDefault(k, v)} />
            ))}
          </Section>

          {projects.length > 0 && (
            <Section title="Projects" footer="Override agent work for one project. Default follows the setting above.">
              {projects.map((p) => (
                <ProjectOverrides key={p.id} project={p} prefs={prefs} onChange={(k, v) => setOverride(p.id, k, v)} />
              ))}
            </Section>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
        </>
      )}

      {devPushAvailable() && <DevPushPanel />}
    </View>
  );
}

function PermissionCard({ status }: { status: PushStatus }) {
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    try {
      await requestPushPermission();
    } finally {
      setAsking(false);
    }
  };

  const off = status.permission !== 'granted' && status.permission !== 'unavailable';
  const blockedByOs = status.permission === 'denied' && !status.canAskAgain;
  const headline =
    status.permission === 'granted'
      ? 'Push notifications are on'
      : status.permission === 'unavailable'
        ? 'Push notifications are unavailable'
        : 'Push notifications are off';

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Icon
          name={status.permission === 'granted' ? 'alarm.fill' : 'alarm'}
          size={22}
          color={status.permission === 'granted' ? colors.primary : colors.textSecondary}
          weight="semibold"
        />
        <Text style={styles.cardTitle}>{headline}</Text>
      </View>
      {status.problem && <Text style={type.secondary}>{status.problem}</Text>}
      {off && (
        <PressableScale
          style={styles.primaryButton}
          scaleTo={0.97}
          disabled={asking}
          onPress={() => (blockedByOs ? void Linking.openSettings() : void ask())}>
          <Text style={styles.primaryText}>{blockedByOs ? 'Open Settings' : 'Turn on'}</Text>
        </PressableScale>
      )}
    </View>
  );
}

function Section({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer && <Text style={[type.tiny, styles.footer]}>{footer}</Text>}
    </View>
  );
}

function ToggleRow({ kind, value, onChange }: { kind: NotificationKind; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{LABELS[kind].title}</Text>
        <Text style={type.tiny}>{LABELS[kind].detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.elevated }}
        ios_backgroundColor={colors.elevated}
        accessibilityLabel={LABELS[kind].title}
      />
    </View>
  );
}

type Tri = 'default' | 'on' | 'off';
const TRI: Tri[] = ['default', 'on', 'off'];
const TRI_LABEL: Record<Tri, string> = { default: 'Default', on: 'On', off: 'Off' };

function ProjectOverrides({
  project,
  prefs,
  onChange,
}: {
  project: Account;
  prefs: NotificationPreferences;
  onChange: (kind: NotificationKind, enabled: boolean | null) => void;
}) {
  const overridden = WORK_KINDS.filter((k) => overrideFor(prefs, project.id, k) !== undefined).length;
  const [open, setOpen] = useState(overridden > 0);
  return (
    <View>
      <Pressable style={styles.row} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Avatar account={project} size={28} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{project.name}</Text>
          <Text style={type.tiny}>{overridden === 0 ? 'Default' : `${overridden} override${overridden === 1 ? '' : 's'}`}</Text>
        </View>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={14} color={colors.textTertiary} weight="semibold" />
      </Pressable>
      {open &&
        WORK_KINDS.map((k) => {
          const o = overrideFor(prefs, project.id, k);
          const current: Tri = o === undefined ? 'default' : o ? 'on' : 'off';
          return (
            <View key={k} style={styles.overrideRow}>
              <Text style={[styles.rowTitle, styles.overrideLabel]}>{LABELS[k].title}</Text>
              <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={`${project.name} ${LABELS[k].title}`}>
                {TRI.map((t) => {
                  const selected = t === current;
                  return (
                    <PressableScale
                      key={t}
                      style={[styles.segment, selected && styles.segmentSelected]}
                      scaleTo={0.96}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        if (selected) return;
                        haptic.selection();
                        onChange(k, t === 'default' ? null : t === 'on');
                      }}>
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                        {t === 'default' ? `${TRI_LABEL[t]} · ${prefs.defaults[k] ? 'on' : 'off'}` : TRI_LABEL[t]}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          );
        })}
      <Hairline />
    </View>
  );
}

/** DEV ONLY: send any fixture event through the mock's delivery check as a local push. */
function DevPushPanel() {
  const [result, setResult] = useState<string | null>(null);
  const emit = async (id: string, delaySeconds: number) => {
    try {
      const { sent, push } = await emitDevPush(id, { delaySeconds });
      setResult(
        sent
          ? `${id}: sent${delaySeconds ? ` in ${delaySeconds}s` : ''} (${push.decision.because})`
          : `${id}: not sent, ${push.decision.because.replace('_', ' ')}`,
      );
    } catch (e) {
      setResult(`${id}: refused, ${e instanceof TardyApiError ? e.code : message(e)}`);
    }
  };
  return (
    <Section title="Developer" footer="Tap to push now; long-press to push in 5s (background or quit the app to test the tap).">
      {devPushEvents().map((n) => (
        <Pressable key={n.id} style={styles.row} onPress={() => void emit(n.id, 0)} onLongPress={() => void emit(n.id, 5)}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>
              {n.id} · {LABELS[n.kind].title}
            </Text>
            <Text style={type.tiny} numberOfLines={1}>
              {n.actorId}: {n.text}
            </Text>
          </View>
        </Pressable>
      ))}
      {result && <Text style={[type.secondary, styles.devResult]}>{result}</Text>}
    </Section>
  );
}

const styles = StyleSheet.create({
  container: { gap: 20 },
  loading: { marginTop: 20 },
  section: { gap: 8 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', paddingHorizontal: 4 },
  footer: { paddingHorizontal: 4 },
  card: { gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  overrideRow: { gap: 6, paddingVertical: 6 },
  overrideLabel: { fontSize: 13 },
  segments: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.pill, backgroundColor: colors.elevated },
  segment: { flex: 1, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  segmentTextSelected: { color: colors.onPrimary },
  primaryButton: { height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, fontWeight: '800', fontSize: 14 },
  error: { color: colors.alarm, fontSize: 13 },
  devResult: { paddingTop: 4 },
});
