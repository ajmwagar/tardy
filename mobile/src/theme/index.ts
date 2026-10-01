import { StyleSheet } from 'react-native';

import type { WorkStatus } from '@/data/types';

/** Dark-first palette in the Instagram idiom: true black, hairline separators, one blue. */
export const colors = {
  bg: '#000000',
  surface: '#121212',
  elevated: '#262626',
  separator: '#262626',
  text: '#F5F5F5',
  textSecondary: '#A8A8A8',
  textTertiary: '#737373',
  accent: '#0095F6',
  like: '#FF3040',
  overlay: 'rgba(0,0,0,0.45)',
  storyRing: ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5'] as const,
  seenRing: '#3A3A3A',
} as const;

export const status: Record<WorkStatus, { label: string; color: string; symbol: string }> = {
  shipped: { label: 'Shipped', color: '#2ECC71', symbol: 'checkmark.seal.fill' },
  in_progress: { label: 'In progress', color: '#F5A623', symbol: 'hammer.fill' },
  needs_review: { label: 'Needs review', color: '#0095F6', symbol: 'eye.fill' },
  blocked: { label: 'Blocked', color: '#FF3B30', symbol: 'exclamationmark.octagon.fill' },
};

export const type = StyleSheet.create({
  wordmark: { color: colors.text, fontSize: 28, fontWeight: '700', fontStyle: 'italic', letterSpacing: -0.5 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  handle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  body: { color: colors.text, fontSize: 14, lineHeight: 19 },
  secondary: { color: colors.textSecondary, fontSize: 13 },
  tiny: { color: colors.textSecondary, fontSize: 11 },
});

const units: [number, string][] = [
  [31_536_000, 'y'],
  [604_800, 'w'],
  [86_400, 'd'],
  [3_600, 'h'],
  [60, 'm'],
];

/** Instagram-style compact age: "now", "5m", "3h", "2d", "1w". */
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
