import { claimPlayback, releasePlayback, type CoordinatedPlayer } from '../playback-coordinator';

function fake(): CoordinatedPlayer & { plays: number; pauses: number } {
  return {
    muted: false,
    plays: 0,
    pauses: 0,
    play() {
      this.plays += 1;
    },
    pause() {
      this.pauses += 1;
    },
  };
}

describe('global video playback lease', () => {
  it('mutes and pauses the previous player before a new one owns playback', () => {
    const first = fake();
    const second = fake();

    claimPlayback(first);
    claimPlayback(second);

    expect(first).toMatchObject({ muted: true, pauses: 1 });
    expect(second.pauses).toBe(0);
    releasePlayback(second);
  });

  it('does not let stale cleanup release the newer owner', () => {
    const first = fake();
    const second = fake();
    const third = fake();

    claimPlayback(first);
    claimPlayback(second);
    releasePlayback(first);
    claimPlayback(third);

    expect(second).toMatchObject({ muted: true, pauses: 1 });
    releasePlayback(third);
  });
});
