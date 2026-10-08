import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TardyVideoView } from '../../modules/tardy-video';
import type { MediaItem } from '@/data/types';
import { claimPlayback, releasePlayback } from '@/media/playback-coordinator';
import { useAppPrefs } from '@/state/app-prefs';
import { logEngagement, useStore } from '@/state/store';
import { IMAGE_TRANSITION_MS } from '@/theme';

import { MediaError } from './states';
import { Icon } from './ui';

type VideoMedia = Extract<MediaItem, { type: 'video' }>;

/** Watch time that counts as a video quality view (VQV), matching the ranker's eligibility. */
const VQV_MS = 10_000;

/**
 * A looping, chrome-less video that plays only while `active`. Shows the poster until the
 * first frame is ready, and an explicit error state if the stream fails.
 * Logs a VQV once the viewer has watched past the threshold (posts only).
 */
export function VideoSurface({
  postId,
  media,
  active,
  contentFit = 'cover',
  fullBleed = false,
  playbackRate = 1,
  onReady,
}: {
  /** The post this video belongs to, for VQV logging. Omit for media that isn't a post (stories). */
  postId?: string;
  media: VideoMedia;
  active: boolean;
  contentFit?: 'cover' | 'contain';
  /**
   * For edge-to-edge surfaces (Reels). iOS draws video only inside the screen's safe area
   * (status bar and tab bar excluded), which leaves black bands; this fills them with a
   * blurred, scaled-up copy of the frame that fades into the video.
   */
  fullBleed?: boolean;
  /** Temporary viewer speed while press-and-hold is active. */
  playbackRate?: 1 | 2 | 4;
  /** Called when the first frame is ready to play, e.g. to start a story's timer. */
  onReady?: () => void;
}) {
  const muted = useStore((s) => s.muted);
  // Settings > App > Autoplay: off means posts wait for a tap (stories always play; their timer needs it).
  const { autoplay } = useAppPrefs();
  const [tapped, setTapped] = useState(false);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const waitingForTap = !!postId && !autoplay && !tapped;
  const playing = active && !waitingForTap;
  const source = useMemo(() => ({ uri: media.url, useCaching: !media.url.endsWith('.m3u8') }), [media.url]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 1;
  });

  const { status, error } = useEvent(player, 'statusChange', { status: player.status, error: undefined });

  useEffect(() => {
    // The player is an imperative native handle; writing to it is the API.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = playing ? muted : true;
  }, [player, playing, muted]);

  useEffect(() => {
    if (status === 'readyToPlay') onReady?.();
  }, [status, onReady]);

  useEffect(() => {
    if (playing) {
      claimPlayback(player);
      player.play();
    } else {
      releasePlayback(player);
      // Mute first: AVPlayer pause crosses the JS/native boundary and is not guaranteed to
      // take effect in the same frame during a fast swipe.
      // eslint-disable-next-line react-hooks/immutability
      player.muted = true;
      player.pause();
    }
    return () => {
      releasePlayback(player);
      player.muted = true;
      player.pause();
    };
  }, [player, playing]);

  useEffect(() => {
    // The player is an imperative native handle; writing to it is the API.
    // eslint-disable-next-line react-hooks/immutability
    player.playbackRate = playbackRate;
  }, [player, playbackRate]);

  // VQV: accumulate played time while active; log once per mount.
  const watched = useRef(0);
  const logged = useRef(false);
  const timeUpdate = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const last = useRef(0);
  useEffect(() => {
    const t = timeUpdate.currentTime;
    if (active && t > last.current) watched.current += (t - last.current) * 1000;
    last.current = t;
    if (postId && !logged.current && watched.current >= VQV_MS) {
      logged.current = true;
      logEngagement({ type: 'vqv', postId, watchedMs: Math.round(watched.current) });
    }
  }, [timeUpdate, active, postId]);

  const video = <VideoView key={media.url} player={player} style={StyleSheet.absoluteFill} contentFit={contentFit} nativeControls={false} onFirstFrameRender={() => setRenderedUrl(media.url)} />;

  return (
    <View style={StyleSheet.absoluteFill}>
      {fullBleed && TardyVideoView ? (
        // Native edge-to-edge view (dev builds): live blurred backdrop, no safe-area bands.
        <TardyVideoView player={player} style={StyleSheet.absoluteFill} />
      ) : fullBleed ? (
        // Expo Go fallback. A nested provider measures *this* view's safe area (tab bar included), not the window's.
        <SafeAreaProvider style={StyleSheet.absoluteFill}>
          <BleedFill posterUrl={media.posterUrl}>{video}</BleedFill>
        </SafeAreaProvider>
      ) : (
        video
      )}
      {(status !== 'readyToPlay' || (!fullBleed && renderedUrl !== media.url)) && (
        // Same fit as the video, so nothing jumps when the first frame replaces the poster.
        <Image source={media.posterUrl} style={StyleSheet.absoluteFill} contentFit={contentFit} cachePolicy="memory-disk" transition={IMAGE_TRANSITION_MS} />
      )}
      {waitingForTap && active && (
        <Pressable style={styles.tapToPlay} onPress={() => setTapped(true)} accessibilityRole="button" accessibilityLabel="Play video">
          <View style={styles.playGlyph}>
            <Icon name="play.fill" size={30} color="#fff" />
          </View>
        </Pressable>
      )}
      {status === 'error' && (
        <MediaError
          detail={error?.message ?? media.url}
          onRetry={() => {
            void player.replaceAsync(source).then(() => {
              if (playing) {
                claimPlayback(player);
                player.muted = muted;
                player.play();
              }
            });
          }}
        />
      )}
    </View>
  );
}

/** Soft edge where the sharp video meets the blurred bands. */
const FADE = 28;

/**
 * Places the video exactly inside the area iOS will draw it in, and paints the bands outside
 * it with a heavily blurred copy of the poster, so the reel reads as one continuous image.
 */
function BleedFill({ posterUrl, children }: { posterUrl: string; children: React.ReactNode }) {
  const { top, bottom } = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={posterUrl}
        style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.25 }] }]}
        contentFit="cover"
        blurRadius={40}
        cachePolicy="memory-disk"
      />
      <View style={[StyleSheet.absoluteFill, { top, bottom }]}>{children}</View>
      {top > 0 && (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.18)', 'transparent']}
          style={{ position: 'absolute', left: 0, right: 0, top, height: FADE }}
        />
      )}
      {bottom > 0 && (
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', 'rgba(0,0,0,0.18)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom, height: FADE }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tapToPlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
