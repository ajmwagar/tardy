import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { emojiFor, REACTIONS, reactionOf, type ReactionKind, type ReactionSummary } from '@/reactions/reactions';
import { useStore } from '@/state/store';
import { colors } from '@/theme';

/** Where the long-pressed item sits on screen, so the bar opens just above it. */
export type ReactionAnchor = { y: number };

const BAR_HEIGHT = 52;

/**
 * The tap-back bar: long-press a message or comment, pick one. Your current reaction is
 * ringed; picking it again removes it. Tapping outside closes without changing anything.
 */
export function ReactionPicker({
  anchor,
  current,
  onPick,
  onClose,
  actions = [],
}: {
  anchor: ReactionAnchor | null;
  current: ReactionKind | null;
  onPick: (kind: ReactionKind) => void;
  onClose: () => void;
  actions?: readonly { label: string; onPress: () => void }[];
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!anchor) return null;
  const menuHeight = BAR_HEIGHT + actions.length * 44;
  const top = Math.min(Math.max(insets.top + 8, anchor.y - menuHeight - 8), height - insets.bottom - menuHeight - 8);
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close reactions">
        <Animated.View entering={FadeIn.duration(120)} style={StyleSheet.absoluteFill} />
      </Pressable>
      <Animated.View entering={ZoomIn.duration(160)} style={{ position: 'absolute', alignSelf: 'center', top, backgroundColor: colors.elevated, borderRadius: 20 }} accessibilityRole="menu">
      <View style={[styles.bar, { position: 'relative' }]}>
        {REACTIONS.map((r) => (
          <Pressable
            key={r.kind}
            onPress={() => onPick(r.kind)}
            style={[styles.option, current === r.kind && styles.optionOn]}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: current === r.kind }}
            accessibilityLabel={r.label}
            hitSlop={4}>
            <Text style={styles.emoji}>{r.emoji}</Text>
          </Pressable>
        ))}
      </View>
        {actions.map((action) => <Pressable key={action.label} accessibilityRole="menuitem" onPress={action.onPress} style={{ paddingHorizontal: 20, height: 44, justifyContent: 'center' }}><Text style={{ color: colors.text }}>{action.label}</Text></Pressable>)}
      </Animated.View>
    </Modal>
  );
}

/**
 * Reactions on an item, as small chips: the emoji, and a count past one. Yours is outlined;
 * tapping a chip toggles your reaction to that one.
 */
export function ReactionChips({
  reactions,
  me,
  onToggle,
  align = 'flex-start',
}: {
  reactions: ReactionSummary | undefined;
  me: string | undefined;
  onToggle: (kind: ReactionKind) => void;
  align?: 'flex-start' | 'flex-end';
}) {
  const accounts = useStore((s) => s.accounts);
  if (!reactions?.length) return null;
  const mine = me ? reactionOf(reactions, me) : null;
  return (
    <View style={[styles.chips, { alignSelf: align }]}>
      {reactions.map((r) => {
        const who = r.accountIds.map((id) => (id === me ? 'you' : (accounts.get(id)?.handle ?? 'someone'))).join(', ');
        return (
          <Pressable
            key={r.kind}
            onPress={() => onToggle(r.kind)}
            style={[styles.chip, mine === r.kind && styles.chipMine]}
            accessibilityRole="button"
            accessibilityLabel={`${REACTIONS.find((x) => x.kind === r.kind)!.label} from ${who}`}>
            <Text style={styles.chipEmoji}>{emojiFor(r.kind)}</Text>
            {r.accountIds.length > 1 && <Text style={styles.chipCount}>{r.accountIds.length}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  bar: {
    position: 'absolute',
    alignSelf: 'center',
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.elevated,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  option: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionOn: { backgroundColor: 'rgba(255,194,26,0.22)' },
  emoji: { fontSize: 24 },
  chips: { flexDirection: 'row', gap: 4, marginTop: 3 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.bg,
  },
  chipMine: { borderColor: colors.primary },
  chipEmoji: { fontSize: 13 },
  chipCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
