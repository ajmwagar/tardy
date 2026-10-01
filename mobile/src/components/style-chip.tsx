import type { SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { colors, postStyleOf } from '@/theme';

import { Icon } from './ui';

/**
 * Small neutral chip naming a post's content format ("News", "Podcast"), shown next to
 * the status pill. `overlay` sits on video (Reels), `card` on a feed card. Renders
 * nothing for plain posts and for styles this client doesn't know.
 */
export function StyleChip({ style, variant }: { style: string | undefined; variant: 'overlay' | 'card' }) {
  const s = postStyleOf(style);
  if (!s) return null;
  const overlay = variant === 'overlay';
  const tint = overlay ? '#fff' : colors.textSecondary;
  return (
    <View style={[styles.chip, overlay ? styles.overlay : styles.card]}>
      <Icon name={s.symbol as SFSymbol} size={overlay ? 10 : 11} color={tint} weight="semibold" />
      <Text style={[styles.text, { color: tint, fontSize: overlay ? 11.5 : 12 }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  overlay: { backgroundColor: 'rgba(255,255,255,0.16)' },
  card: { backgroundColor: colors.elevated },
  text: { fontWeight: '600' },
});
