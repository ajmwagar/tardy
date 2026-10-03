import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SharedLink } from '@/data/types';
import { colors, IMAGE_TRANSITION_MS, radius } from '@/theme';

import { SkeletonBlock } from './states';
import { Icon } from './ui';

const COMPACT_THUMB = 76;

const STATUS: Record<NonNullable<SharedLink['status']>, string> = {
  queued: 'Queued for a summary',
  processing: 'Summarizing…',
  ready: '',
  failed: 'No preview. The link still works.',
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * A shared link's preview card: thumbnail, title, and where it's from. While enrichment runs
 * it shows a placeholder and the status; a failed enrichment still shows a usable card,
 * because preview failures never block delivery. Tapping opens the link.
 */
export function LinkPreview({
  url,
  link,
  width,
  error,
  compact = false,
}: {
  url: string;
  link: SharedLink | null;
  width: number;
  error?: string | null;
  /** Thumbnail beside the text instead of above it: for tight spaces like the share sheet. */
  compact?: boolean;
}) {
  const target = link?.canonicalUrl ?? url;
  const ready = link?.status === 'ready';
  const status = error ? `Can't share this link: ${error}` : link?.status ? STATUS[link.status] : 'Saving…';
  const thumb = compact ? { width: COMPACT_THUMB, height: COMPACT_THUMB } : { width, height: width * 0.52 };
  if (!compact && link?.mediaUrl) {
    return (
      <View style={[styles.card, { width }]}>
        <Pressable
          style={[styles.video, { width, height: width * 1.25 }]}
          onPress={() => router.push({ pathname: '/shared-reel/[id]', params: { id: link.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Open ${link.title ?? 'shared reel'} in Tardy`}>
          <Image source={link.thumbnailUrl} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          <View style={styles.playOverlay}><View style={styles.playGlyph}><Icon name="play.fill" size={24} color="#fff" /></View></View>
        </Pressable>
        <View style={styles.body}>
          {link.title ? <Text style={styles.title} numberOfLines={2}>{link.title}</Text> : null}
          {link.caption ? <Text style={styles.caption} numberOfLines={3}>{link.caption}</Text> : null}
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(target)} accessibilityRole="link">
            <Text style={styles.source}>View original · {hostOf(target)}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      style={[styles.card, { width }, compact && styles.compact]}
      onPress={() => void WebBrowser.openBrowserAsync(target)}
      accessibilityRole="link"
      accessibilityLabel={`${link?.title ?? hostOf(target)}, open link`}>
      {link?.thumbnailUrl ? (
        <Image
          source={link.thumbnailUrl}
          recyclingKey={link.thumbnailUrl}
          style={thumb}
          contentFit="cover"
          transition={IMAGE_TRANSITION_MS}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.placeholder, thumb]}>
          {!ready && !error && link?.status !== 'failed' ? <SkeletonBlock style={StyleSheet.absoluteFill} /> : null}
          <Icon name="link" size={28} color={colors.textTertiary} />
        </View>
      )}
      <View style={[styles.body, compact && styles.bodyCompact]}>
        {link?.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {link.title}
          </Text>
        ) : null}
        <Text style={styles.host} numberOfLines={1}>
          {link?.provider && link.provider !== 'web' ? `${link.provider} · ` : ''}
          {hostOf(target)}
        </Text>
        {status ? <Text style={error ? styles.error : styles.status}>{status}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.media, overflow: 'hidden', backgroundColor: colors.elevated },
  compact: { flexDirection: 'row', alignItems: 'center' },
  bodyCompact: { flex: 1, paddingVertical: 8 },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  body: { padding: 12, gap: 3 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  host: { color: colors.textSecondary, fontSize: 12.5 },
  status: { color: colors.textTertiary, fontSize: 12 },
  error: { color: colors.alarm, fontSize: 12 },
  video: { position: 'relative', backgroundColor: '#000' },
  playOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  caption: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  source: { color: colors.primary, fontSize: 12.5, fontWeight: '600', paddingTop: 3 },
});
