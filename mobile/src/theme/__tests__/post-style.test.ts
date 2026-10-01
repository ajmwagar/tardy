import { postStyleOf } from '@/theme';

describe('postStyleOf', () => {
  it('labels every known style', () => {
    expect(['news', 'podcast', 'launch', 'explainer', 'ugc', 'brainrot'].map((s) => postStyleOf(s)?.label)).toEqual([
      'News',
      'Podcast',
      'Launch',
      'Explainer',
      'UGC',
      'Brainrot',
    ]);
  });

  it('tolerates styles this client does not know, and plain posts', () => {
    expect(postStyleOf('asmr')).toBeUndefined();
    expect(postStyleOf('toString')).toBeUndefined();
    expect(postStyleOf(undefined)).toBeUndefined();
  });
});
