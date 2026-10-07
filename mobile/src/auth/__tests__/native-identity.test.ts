import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { createNativeIdentity } from '../native-identity';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' }, CryptoEncoding: { BASE64: 'base64' },
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(32).fill(7)),
  digestStringAsync: jest.fn(async () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), WebBrowserResultType: { CANCEL: 'cancel' } }));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn() }));

const browser = jest.mocked(WebBrowser.openAuthSessionAsync);
const attempt = { authorizationUrl: 'https://github.com/login/oauth/authorize?state=bound', state: 'bound', expiresAt: '2099-01-01' };

beforeEach(() => jest.clearAllMocks());

it('binds GitHub callback to state, PKCE and the app scheme', async () => {
  const begin = jest.fn(async () => attempt);
  browser.mockResolvedValue({ type: 'success', url: 'tardy://auth/github?state=bound&code=authorization-code' });
  const credential = await createNativeIdentity(begin).authorize('github');
  expect(begin).toHaveBeenCalledWith('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', false);
  expect(credential).toMatchObject({ provider: 'github', state: 'bound', code: 'authorization-code', codeVerifier: '07'.repeat(32) });
  expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA256', '07'.repeat(32), { encoding: 'base64' });
  expect(browser).toHaveBeenCalledWith(attempt.authorizationUrl, 'tardy://auth/github');
});

it('starts explicit linking rather than a second account signup', async () => {
  const begin = jest.fn(async () => attempt);
  browser.mockResolvedValue({ type: 'success', url: 'tardy://auth/github?state=bound&code=code' });
  await createNativeIdentity(begin).authorize('github', true);
  expect(begin).toHaveBeenCalledWith(expect.any(String), true);
});

it.each([
  'tardy://auth/github?state=attacker&code=code',
  'tardy://evil/github?state=bound&code=code',
  'tardy://auth/github?state=bound&error=access_denied',
])('rejects invalid or denied callback %s', async (url) => {
  browser.mockResolvedValue({ type: 'success', url });
  await expect(createNativeIdentity(async () => attempt).authorize('github')).rejects.toThrow();
});

it('treats browser cancellation as cancellation, not an auth failure', async () => {
  browser.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
  await expect(createNativeIdentity(async () => attempt).authorize('github')).resolves.toBeNull();
});

it('rejects a server-provided authorization URL on a different origin', async () => {
  await expect(createNativeIdentity(async () => ({ ...attempt, authorizationUrl: 'https://evil.test/login/oauth/authorize' })).authorize('github')).rejects.toThrow('authorization URL');
  expect(browser).not.toHaveBeenCalled();
});
