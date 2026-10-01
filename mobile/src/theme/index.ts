import { Platform, StyleSheet } from 'react-native';

import type { PostStyle, WorkStatus } from '@/data/types';

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
  /** Timestamps, placeholders, model names. Kept at WCAG AA (4.5:1) on bg and surface; see the theme test. */
  textTertiary: '#80808C',
  /** Tardy yellow: thumbs up, primary buttons, the verified seal. */
  primary: '#FFC21A',
  onPrimary: '#14110A',
  /** Alarm red: breaking news, blocked work, the alarm reaction. */
  alarm: '#FF2D3D',
  link: '#5AB4FF',
  overlay: 'rgba(0,0,0,0.45)',
  /** Story rings: light grey for unseen, dark grey once seen. Boosted stories use `alarm`. */
  unseenRing: '#C9C9D3',
  seenRing: '#34343E',
  /** A paid boost you've already watched: still red, but dimmed like other seen rings. */
  boostedSeenRing: '#7A1A22',
} as const;

export const status: Record<WorkStatus, { label: string; color: string; symbol: string }> = {
  shipped: { label: 'Shipped', color: '#2BE07B', symbol: 'checkmark.seal.fill' },
  in_progress: { label: 'In progress', color: '#FFB21A', symbol: 'hammer.fill' },
  needs_review: { label: 'Needs review', color: '#5AB4FF', symbol: 'eye.fill' },
  blocked: { label: 'Blocked', color: '#FF2D3D', symbol: 'exclamationmark.octagon.fill' },
};

/** Chip label and symbol per post content format (`Post.style`). Neutral: the status pill carries the color. */
export const postStyles: Record<PostStyle, { label: string; symbol: string }> = {
  news: { label: 'News', symbol: 'newspaper.fill' },
  podcast: { label: 'Podcast', symbol: 'mic.fill' },
  launch: { label: 'Launch', symbol: 'film.fill' },
  explainer: { label: 'Explainer', symbol: 'lightbulb.fill' },
  ugc: { label: 'UGC', symbol: 'iphone' },
  brainrot: { label: 'Brainrot', symbol: 'gamecontroller.fill' },
};

/**
 * The chip for a post's style, or undefined for plain posts and for styles this client
 * doesn't know (the server may add styles before every client ships them).
 */
export function postStyleOf(style: string | undefined): { label: string; symbol: string } | undefined {
  return style && Object.hasOwn(postStyles, style) ? postStyles[style as PostStyle] : undefined;
}

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

/**
 * VoiceOver label for an icon button that shows a count: "Ping me on status change, 12".
 * The full number, not the compact one, since "1.2K" reads badly aloud.
 */
export function countLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label}, ${count.toLocaleString('en-US')}`;
}

/** WCAG 2.x relative luminance of a #RRGGBB color. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB color: "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque #RRGGBB colors, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
