/** The narrow imperative surface shared by expo-video players and test doubles. */
export interface CoordinatedPlayer {
  muted: boolean;
  play(): void;
  pause(): void;
}

let owner: CoordinatedPlayer | null = null;

/**
 * Gives one player the global playback lease. Tardy intentionally permits only one audible
 * video at a time; list viewability callbacks can overlap briefly while native cells recycle.
 */
export function claimPlayback(player: CoordinatedPlayer) {
  if (owner && owner !== player) {
    owner.muted = true;
    owner.pause();
  }
  owner = player;
}

/** Releases a lease without disturbing a newer player that has already claimed it. */
export function releasePlayback(player: CoordinatedPlayer) {
  if (owner === player) owner = null;
}

