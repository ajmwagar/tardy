import { DEFAULT_APP_PREFS, parsePrefs } from '../app-prefs';

describe('parsePrefs', () => {
  it('keeps known keys and defaults the rest', () => {
    expect(parsePrefs(JSON.stringify({ haptics: false }))).toEqual({ ...DEFAULT_APP_PREFS, haptics: false });
    expect(parsePrefs(JSON.stringify({ autoplay: 'nope', extra: 1 }))).toEqual(DEFAULT_APP_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_APP_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_APP_PREFS);
  });
});
