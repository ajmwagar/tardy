import { Platform, StyleSheet } from 'react-native';

import type { WorkStatus } from '@/data/types';

/**
 * Tardy's palette: a warm near-black base, Tardy yellow for the viewer's own actions
 * (thumbs up, saves), alarm red for urgency (breaking, blocked, the alarm). Two accents
 * only, so whatever is colored is what matters.
 */
export const colors = {
  bg: '#0A0A0D',
  surface: '#15151B',
  elevated: '#22222B',
  separator: '#26262F',
  text: '#F7F7FA',
  textSecondary: '#A1A1AE',
  textTertiary: '#6E6E7A',
  /** Tardy yellow: thumbs up, primary buttons, the verified seal. */
  primary: '#FFC21A',
  onPrimary: '#14110A',
  /** Alarm red: breaking news, blocked work, the alarm reaction. */
  alarm: '#FF2D3D',
  link: '#5AB4FF',
  overlay: 'rgba(0,0,0,0.45)',
  storyRing: ['#FFC21A', '#FF7A1A', '#FF2D3D'] as const,
  seenRing: '#34343E',
} as const;

export const status: Record<WorkStatus, { label: string; color: string; symbol: string }> = {
  shipped: { label: 'Shipped', color: '#2BE07B', symbol: 'checkmark.seal.fill' },
  in_progress: { label: 'In progress', color: '#FFB21A', symbol: 'hammer.fill' },
  needs_review: { label: 'Needs review', color: '#5AB4FF', symbol: 'eye.fill' },
  blocked: { label: 'Blocked', color: '#FF2D3D', symbol: 'exclamationmark.octagon.fill' },
};

const rounded = Platform.select({ ios: 'ui-rounded', default: undefined });

export const radius = { card: 20, media: 16, pill: 999 } as const;

/** Feed geometry shared by PostCard and its skeleton: card side gutter, media width:height. */
export const layout = { cardGutter: 8, feedMediaAspect: 4 / 5 } as const;

export const type = StyleSheet.create({
  wordmark: { color: colors.text, fontSize: 30, fontWeight: '900', fontFamily: rounded, letterSpacing: -1.2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', fontFamily: rounded },
  handle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  secondary: { color: colors.textSecondary, fontSize: 13 },
  tiny: { color: colors.textSecondary, fontSize: 11 },
  count: { color: colors.text, fontSize: 13, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
});

const units: [number, string][] = [
  [31_536_000, 'y'],
  [604_800, 'w'],
  [86_400, 'd'],
  [3_600, 'h'],
  [60, 'm'],
];

/** Compact age: "now", "5m", "3h", "2d", "1w". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  return 'now';
}

/** 1234 → "1,234", 12_345 → "12.3K", 1_234_567 → "1.2M". */
export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
