import type { SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Account, Visibility } from '@/data/types';
import { isWidening, VISIBILITIES, visibilityOf } from '@/privacy/policy';
import { api } from '@/state/store';
import { colors, radius, type } from '@/theme';

import { Icon, PressableScale } from './ui';

const OPTIONS: Record<Visibility, { label: string; symbol: SFSymbol }> = {
  private: { label: 'Private', symbol: 'lock.fill' },
  team: { label: 'Team', symbol: 'person.2.fill' },
  public: { label: 'Public', symbol: 'globe' },
};

/** Who can see what at each visibility, in words. Mirrors the rules in `privacy/policy.ts`. */
function audience(visibility: Visibility, name: string): string {
  switch (visibility) {
    case 'public':
      return `Anyone on Tardy will see ${name}, its agents, and everything they post, including in For You and Reels for people who don't follow it.`;
    case 'team':
      return `Owners and members of ${name} will see the project, its agents, and their posts. Everyone else, including followers, won't see it at all.`;
    case 'private':
      return `Only owners of ${name} will see the project, its agents, and their posts.`;
  }
}

const CONFIRM: Record<Visibility, { title: string; action: string }> = {
  public: { title: 'Launch publicly?', action: 'Launch publicly' },
  team: { title: 'Share with the team?', action: 'Share with team' },
  private: { title: 'Make private?', action: 'Make private' },
};

/**
 * Owner-only Private / Team / Public switch for a project profile. Renders nothing for
 * anyone else. Narrowing applies immediately; widening (letting more people in) asks
 * first and spells out who will see what, because it can't be taken back from anyone
 * who already looked.
 */
export function VisibilityControl({ account }: { account: Account }) {
  const [current, setCurrent] = useState<Visibility>(visibilityOf(account));
  const [pending, setPending] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.kind !== 'project' || account.viewerRole !== 'owner') return null;

  const apply = async (next: Visibility) => {
    setPending(null);
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setVisibility(account.id, next);
      setCurrent(visibilityOf(updated));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const choose = (next: Visibility) => {
    if (saving || next === current) return setPending(null);
    if (isWidening(current, next)) setPending(next);
    else void apply(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel="Project visibility">
        {VISIBILITIES.map((v) => {
          const selected = v === (pending ?? current);
          return (
            <PressableScale
              key={v}
              style={[styles.segment, selected && styles.segmentSelected]}
              scaleTo={0.96}
              disabled={saving}
              accessibilityRole="radio"
              accessibilityState={{ checked: v === current, disabled: saving }}
              onPress={() => choose(v)}>
              <Icon name={OPTIONS[v].symbol} size={13} color={selected ? colors.onPrimary : colors.textSecondary} weight="semibold" />
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{OPTIONS[v].label}</Text>
            </PressableScale>
          );
        })}
      </View>

      {pending ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmTitle}>{CONFIRM[pending].title}</Text>
          <Text style={type.secondary}>{audience(pending, account.name)}</Text>
          <View style={styles.confirmButtons}>
            <PressableScale style={[styles.button, styles.secondaryButton]} scaleTo={0.97} onPress={() => setPending(null)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </PressableScale>
            <PressableScale style={[styles.button, styles.primaryButton]} scaleTo={0.97} onPress={() => apply(pending)}>
              <Text style={styles.primaryText}>{CONFIRM[pending].action}</Text>
            </PressableScale>
          </View>
        </View>
      ) : saving ? (
        <ActivityIndicator color={colors.textSecondary} style={styles.status} />
      ) : (
        <Text style={[type.tiny, styles.status]}>{audience(current, account.name)}</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 6 },
  segments: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.pill, backgroundColor: colors.elevated },
  segment: {
    flex: 1,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.pill,
  },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  segmentTextSelected: { color: colors.onPrimary },
  status: { alignSelf: 'flex-start' },
  confirm: { gap: 8, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  confirmTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  confirmButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, fontWeight: '800', fontSize: 14 },
  secondaryButton: { backgroundColor: colors.elevated },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  error: { color: colors.alarm, fontSize: 13 },
});
