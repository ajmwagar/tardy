import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { MessageMedia } from '@/data/types';
import { attachmentPreviewKind, markdownBlocks } from '@/messages/attachment-format';
import { colors, radius } from '@/theme';
import { Icon } from './ui';

const label = (media: MessageMedia) =>
  media.fileName ?? media.altText ?? (media.type === 'video' ? 'Video' : media.type === 'audio' ? 'Audio' : 'Document');

const open = (media: MessageMedia) => void WebBrowser.openBrowserAsync(media.url);
const clock = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

function Header({ media, icon }: { media: MessageMedia; icon: ComponentProps<typeof Icon>['name'] }) {
  return (
    <View style={styles.header}>
      <Icon name={icon} size={17} color={colors.primary} />
      <Text style={styles.name} numberOfLines={1}>{label(media)}</Text>
      <Pressable onPress={() => open(media)} hitSlop={10} accessibilityRole="link" accessibilityLabel={`Open ${label(media)}`}>
        <Icon name="arrow.up.right" size={14} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function InlineVideo({ media }: { media: MessageMedia }) {
  const player = useVideoPlayer(media.url);
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  return (
    <View style={styles.card}>
      <Header media={media} icon="play.rectangle.fill" />
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={[styles.video, { aspectRatio: Math.min(1.4, Math.max(0.7, ratio)) }]}
      />
    </View>
  );
}

function InlineAudio({ media }: { media: MessageMedia }) {
  const player = useAudioPlayer(media.url, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <View style={styles.card}>
      <Header media={media} icon="waveform" />
      <View style={styles.audioRow}>
        <Pressable
          style={styles.play}
          onPress={() => status.playing ? player.pause() : player.play()}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}>
          <Icon name={status.playing ? 'pause.fill' : 'play.fill'} size={18} color={colors.bg} />
        </Pressable>
        <Pressable style={styles.seek} onPress={(event) => {
          if (status.duration <= 0) return;
          void player.seekTo((event.nativeEvent.locationX / 190) * status.duration);
        }}>
          <View style={styles.track}><View style={[styles.progress, { width: `${progress * 100}%` }]} /></View>
          <Text style={styles.time}>{clock(status.currentTime)} / {clock(status.duration)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InlineMarkdown({ media }: { media: MessageMedia }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(media.url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => setSource(text.slice(0, 200_000)))
      .catch((value: unknown) => { if ((value as Error)?.name !== 'AbortError') setError(true); });
    return () => controller.abort();
  }, [media.url]);
  const blocks = useMemo(() => source ? markdownBlocks(source) : [], [source]);
  return (
    <View style={styles.card}>
      <Header media={media} icon="doc.text.fill" />
      {!source && !error ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
      {error ? <Pressable onPress={() => open(media)}><Text style={styles.error}>Preview unavailable · tap to open</Text></Pressable> : null}
      {source ? (
        <ScrollView style={styles.document} nestedScrollEnabled>
          {blocks.map((block, index) => (
            <Text
              key={index}
              selectable
              style={block.kind === 'heading' ? [styles.heading, block.level === 1 && styles.headingOne] : block.kind === 'code' ? styles.code : block.kind === 'bullet' ? styles.body : styles.body}>
              {block.kind === 'bullet' ? '•  ' : ''}{block.text}
            </Text>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function InlinePdf({ media }: { media: MessageMedia }) {
  return (
    <View style={styles.card}>
      <Header media={media} icon="doc.richtext.fill" />
      <WebView
        source={{ uri: media.url }}
        style={styles.pdf}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={styles.pdfLoading} color={colors.primary} />}
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

function FileFallback({ media }: { media: MessageMedia }) {
  const detail = [media.contentType, media.byteLength ? `${Math.max(1, Math.round(media.byteLength / 1024))} KB` : null].filter(Boolean).join(' · ');
  return (
    <Pressable style={styles.card} onPress={() => open(media)} accessibilityRole="link">
      <Header media={media} icon="doc.fill" />
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

export function MessageAttachment({ media }: { media: MessageMedia }) {
  switch (attachmentPreviewKind(media)) {
    case 'video': return <InlineVideo media={media} />;
    case 'audio': return <InlineAudio media={media} />;
    case 'pdf': return <InlinePdf media={media} />;
    case 'markdown': return <InlineMarkdown media={media} />;
    default: return <FileFallback media={media} />;
  }
}

const styles = StyleSheet.create({
  card: { width: 280, overflow: 'hidden', borderRadius: radius.media, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, backgroundColor: colors.surface, marginBottom: 4 },
  header: { height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  name: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  video: { width: '100%', maxHeight: 360, backgroundColor: '#000' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  seek: { width: 190, gap: 6 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.separator },
  progress: { height: '100%', backgroundColor: colors.primary },
  time: { color: colors.textTertiary, fontSize: 11, fontVariant: ['tabular-nums'] },
  document: { maxHeight: 360, paddingHorizontal: 14, paddingTop: 12, marginBottom: 12 },
  heading: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '800', marginBottom: 8 },
  headingOne: { fontSize: 20, lineHeight: 26 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  code: { color: colors.text, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12, lineHeight: 18, backgroundColor: colors.bg, padding: 10, marginBottom: 8, borderRadius: 8 },
  loading: { height: 100 },
  error: { color: colors.textSecondary, padding: 14 },
  pdf: { width: '100%', height: 360, backgroundColor: colors.surface },
  pdfLoading: { position: 'absolute', inset: 0 },
  detail: { color: colors.textTertiary, fontSize: 12, padding: 12 },
});
