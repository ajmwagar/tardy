import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MediaItem } from '@/data/types';
import { logEngagement, useStore } from '@/state/store';
import { colors } from '@/theme';

type VideoMedia = Extract<MediaItem, { type: 'video' }>;

/** Watch time that counts as a video quality view (VQV), matching the ranker's eligibility. */
const VQV_MS = 10_000;

/**
 * A looping, chrome-less video that plays only while `active`. Shows the poster until the
 * first frame is ready, and an explicit error state if the stream fails.
 * Logs a VQV once the viewer has watched past the threshold.
 */
export function VideoSurface({
  postId,
  media,
  active,
  contentFit = 'cover',
}: {
  postId: string;
  media: VideoMedia;
  active: boolean;
  contentFit?: 'cover' | 'contain';
}) {
  const muted = useStore((s) => s.muted);
  const player = useVideoPlayer({ uri: media.url, useCaching: !media.url.endsWith('.m3u8') }, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 1;
  });

  const { status, error } = useEvent(player, 'statusChange', { status: player.status, error: undefined });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);

  // VQV: accumulate played time while active; log once per mount.
  const watched = useRef(0);
  const logged = useRef(false);
  const timeUpdate = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const last = useRef(0);
  useEffect(() => {
    const t = timeUpdate.currentTime;
    if (active && t > last.current) watched.current += (t - last.current) * 1000;
    last.current = t;
    if (!logged.current && watched.current >= VQV_MS) {
      logged.current = true;
      logEngagement({ type: 'vqv', postId, watchedMs: Math.round(watched.current) });
    }
  }, [timeUpdate, active, postId]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={contentFit} nativeControls={false} />
      {status !== 'readyToPlay' && (
        <Image source={media.posterUrl} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      )}
      {status === 'error' && (
        <View style={[StyleSheet.absoluteFill, styles.error]}>
          <Text style={styles.errorText}>Video failed to load</Text>
          <Text style={styles.errorDetail} numberOfLines={2}>
            {error?.message ?? media.url}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: 24 },
  errorText: { color: colors.text, fontWeight: '600' },
  errorDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 4, textAlign: 'center' },
});
