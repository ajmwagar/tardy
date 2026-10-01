import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { VideoPlayer } from 'expo-video';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type TardyVideoViewProps = ViewProps & {
  /** A player from expo-video's `useVideoPlayer`; playback stays owned by expo-video. */
  player: VideoPlayer;
  /** Aspect-ratio mismatch (fraction) still filled edge to edge. Default 0.25. */
  fillTolerance?: number;
};

/**
 * The native edge-to-edge Reels video view, or `null` where the native module is not
 * compiled in (Expo Go). Callers must handle `null` with a fallback.
 */
export const TardyVideoView: ComponentType<TardyVideoViewProps> | null = requireOptionalNativeModule('TardyVideo')
  ? requireNativeView<TardyVideoViewProps>('TardyVideo')
  : null;
