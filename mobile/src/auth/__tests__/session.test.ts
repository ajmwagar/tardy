import { TardyApiError } from '@/data/api';
import { MOCK_EMAIL_CODE, MockAuthServer, mockCredential } from '@/data/mock/mock-auth';
import { MockTardyApi } from '@/data/mock/mock-api';
import type { AuthCredential } from '@/data/types';

import { createAuth, type IdentityProvider } from '../session';

/** A string slot in memory, standing in for the keychain. */
function memorySlot(initial: string | null = null) {
  let value = initial;
  return {
    get: jest.fn(async () => value),
    set: jest.fn(async (v: string) => {
      value = v;
    }),
    clear: jest.fn(async () => {
      value = null;
    }),
    peek: () => value,
  };
}

/** What survives a relaunch: the device keychain and the (mock) server's database. */
type Device = { keychain: ReturnType<typeof memorySlot>; server: ReturnType<typeof memorySlot> };
const newDevice = (): Device => ({ keychain: memorySlot(), server: memorySlot() });

/** One app launch on `device`: a fresh API client and auth machine, as after a cold start. */
function launch(device: Device, credential: AuthCredential | null = mockCredential.github('jamesmerrill')) {
  const api = new MockTardyApi({ viewerId: null, persistence: device.server, latencyMs: 0 });
  const identity: IdentityProvider = { authorize: jest.fn(async () => credential) };
  const onSignedIn = jest.fn(async () => {
    await api.me(); // what the store's bootstrap does: proves the session authenticates
  });
  const onSignedOut = jest.fn();
  const auth = createAuth({ api, storage: device.keychain, identity, onSignedIn, onSignedOut });
  return { api, auth, identity, onSignedIn, onSignedOut };
}

const unauthenticated = expect.objectContaining({ name: 'TardyApiError', code: 'unauthenticated' });

test('signed out → signed in → onboarded → signed out', async () => {
  const device = newDevice();
  const { api, auth, onSignedIn, onSignedOut } = launch(device);
  expect(auth.getState()).toEqual({ status: 'unknown' });

  await auth.bootstrap();
  expect(auth.getState()).toEqual({ status: 'signed_out', signingIn: false, error: null });
  await expect(api.homeFeed(null)).rejects.toEqual(unauthenticated);

  await auth.signIn('github');
  const onboarding = auth.getState();
  expect(onboarding).toMatchObject({ status: 'onboarding', signedIn: { account: { id: 'me' }, onboardedAt: null } });
  expect(onSignedIn).toHaveBeenCalledTimes(1);
  expect(device.keychain.peek()).toBe(onboarding.status === 'onboarding' && onboarding.signedIn.session.token);

  expect((await api.setHandle('jm.merrill')).handle).toBe('jm.merrill');
  await auth.completeOnboarding();
  expect(auth.getState()).toMatchObject({ status: 'signed_in', signedIn: { onboardedAt: expect.any(String) } });
  await expect(api.homeFeed(null)).resolves.toMatchObject({ items: expect.any(Array) });

  await auth.signOut();
  expect(auth.getState()).toEqual({ status: 'signed_out', signingIn: false, error: null });
  expect(onSignedOut).toHaveBeenCalledTimes(1);
  expect(device.keychain.peek()).toBeNull();
  await expect(api.me()).rejects.toEqual(unauthenticated);
});

test('a failed sign-in stays signed out, says why, stores nothing, and can be retried', async () => {
  const device = newDevice();
  const stranger = launch(device, mockCredential.github('not-a-tardy-user'));
  await stranger.auth.bootstrap();

  await stranger.auth.signIn('github');
  expect(stranger.auth.getState()).toEqual({
    status: 'signed_out',
    signingIn: false,
    error: expect.stringMatching(/Sign-in failed: GitHub rejected the sign-in/),
  });
  expect(stranger.onSignedIn).not.toHaveBeenCalled();
  expect(device.keychain.peek()).toBeNull();

  const { auth } = launch(device);
  await auth.bootstrap();
  await auth.signIn('github');
  expect(auth.getState().status).toBe('onboarding');
});

test('cancelling at the provider is not an error', async () => {
  const { auth, api } = launch(newDevice(), null);
  await auth.bootstrap();
  await auth.signIn('github');
  expect(auth.getState()).toEqual({ status: 'signed_out', signingIn: false, error: null });
  await expect(api.session()).resolves.toBeNull();
});

test('a failure after the token was stored does not leave a half sign-in behind', async () => {
  const device = newDevice();
  const { auth, onSignedIn } = launch(device);
  onSignedIn.mockRejectedValueOnce(new Error('feed down'));
  await auth.bootstrap();
  await auth.signIn('github');
  expect(auth.getState()).toMatchObject({ status: 'signed_out', error: 'Sign-in failed: feed down' });
  expect(device.keychain.peek()).toBeNull();
});

test('a session restores on relaunch, straight past sign-in and onboarding', async () => {
  const device = newDevice();
  const first = launch(device);
  await first.auth.bootstrap();
  await first.auth.signIn('github');
  await first.api.setHandle('jm.merrill');
  await first.auth.completeOnboarding();

  const second = launch(device);
  await second.auth.bootstrap();
  expect(second.identity.authorize).not.toHaveBeenCalled();
  expect(second.auth.getState()).toMatchObject({
    status: 'signed_in',
    signedIn: { account: { id: 'me', handle: 'jm.merrill' }, session: { provider: 'github' } },
  });
  expect(second.onSignedIn).toHaveBeenCalledTimes(1);
  await expect(second.api.accountByHandle('jm.merrill')).resolves.toMatchObject({ id: 'me' });
});

test('relaunching mid-onboarding resumes onboarding', async () => {
  const device = newDevice();
  const first = launch(device);
  await first.auth.bootstrap();
  await first.auth.signIn('github');

  const second = launch(device);
  await second.auth.bootstrap();
  expect(second.auth.getState().status).toBe('onboarding');
});

test('a signed-out session does not resume on relaunch', async () => {
  const device = newDevice();
  const first = launch(device);
  await first.auth.bootstrap();
  await first.auth.signIn('github');
  const token = device.keychain.peek()!;
  await first.auth.signOut();

  // Even if the keychain still held the old token, the server has revoked it.
  device.keychain.set(token);
  const second = launch(device);
  await second.auth.bootstrap();
  expect(second.auth.getState()).toEqual({
    status: 'signed_out',
    signingIn: false,
    error: 'You were signed out: Session not recognized.',
  });
  expect(device.keychain.peek()).toBeNull();
});

test('bootstrap is idempotent (fast refresh and effect re-runs call it again)', async () => {
  const device = newDevice();
  const { auth } = launch(device);
  const first = auth.bootstrap();
  expect(auth.bootstrap()).toBe(first);
  await first;
  await auth.bootstrap();
  expect(device.keychain.get).toHaveBeenCalledTimes(1);
});

test('bootstrap fails loud on anything other than a dead session', async () => {
  const device = newDevice();
  device.keychain.get.mockRejectedValueOnce(new Error('keychain unavailable'));
  const { auth } = launch(device);
  await expect(auth.bootstrap()).rejects.toThrow('keychain unavailable');
});

test('sign-out always clears the device, and says so if the server did not confirm', async () => {
  const device = newDevice();
  const { auth, api, onSignedOut } = launch(device);
  await auth.bootstrap();
  await auth.signIn('github');
  jest.spyOn(api, 'signOut').mockRejectedValueOnce(new Error('network down'));

  await auth.signOut();
  expect(auth.getState()).toEqual({
    status: 'signed_out',
    signingIn: false,
    error: "Signed out on this device, but the server didn't confirm: network down",
  });
  expect(device.keychain.peek()).toBeNull();
  expect(onSignedOut).toHaveBeenCalled();
});

test('transitions out of order are refused', async () => {
  const { auth } = launch(newDevice());
  await auth.bootstrap();
  await expect(auth.completeOnboarding()).rejects.toThrow("Can't finish onboarding from signed_out");
  await expect(auth.signOut()).rejects.toThrow("Can't sign out from signed_out");
  await auth.signIn('github');
  await expect(auth.signIn('github')).rejects.toThrow("Can't sign in from onboarding");
});

describe('mock server auth contract', () => {
  const signedIn = async () => {
    const api = new MockTardyApi({ viewerId: null, latencyMs: 0 });
    await api.signIn(mockCredential.github('jamesmerrill'));
    return api;
  };

  test('Apple sign-in uses the same contract and lands on the same account', async () => {
    const api = new MockTardyApi({ viewerId: null, latencyMs: 0 });
    await expect(api.signIn(mockCredential.apple('000123.james'))).resolves.toMatchObject({
      account: { id: 'me' },
      session: { provider: 'apple' },
    });
  });

  test('handles are validated and unique', async () => {
    const api = await signedIn();
    await expect(api.setHandle('ab')).rejects.toEqual(new TardyApiError('invalid', 'At least 3 characters.'));
    await expect(api.setHandle('Bad Handle')).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.setHandle('avery')).rejects.toMatchObject({ code: 'conflict' });
    await expect(api.setHandle('james')).resolves.toMatchObject({ handle: 'james' });
  });

  test('suggestions respect privacy and skip what the viewer already follows', async () => {
    const api = await signedIn();
    const suggested = await api.suggestedFollows();
    const ids = suggested.map((a) => a.id);
    expect(ids).not.toContain('p-pan'); // private, viewer is not an owner
    expect(ids).not.toContain('a-ops'); // its agent
    expect(ids).not.toContain('p-tardy'); // already followed
    expect(suggested.every((a) => a.kind !== 'human')).toBe(true);
    expect(new Set(suggested.map((a) => a.kind))).toEqual(new Set(['project', 'agent', 'channel']));

    const outsider = new MockTardyApi({ viewerId: 'c-ugc', latencyMs: 0 });
    expect((await outsider.suggestedFollows()).map((a) => a.id)).not.toContain('p-lob'); // team-only
  });

  test('sessions expire', async () => {
    let now = Date.parse('2026-09-30T00:00:00Z');
    const server = new MockAuthServer(undefined, null, () => now);
    const { token } = await server.signIn(mockCredential.github('jamesmerrill'));
    now += 91 * 24 * 3_600_000;
    await expect(server.resume(token)).rejects.toEqual(new TardyApiError('unauthenticated', 'Session expired'));
  });
});

test('sign-out runs the outgoing session’s last calls first, and a failure there still signs out', async () => {
  const device = newDevice();
  const api = new MockTardyApi({ viewerId: null, persistence: device.server, latencyMs: 0 });
  const order: string[] = [];
  const signOut = api.signOut.bind(api);
  jest.spyOn(api, 'signOut').mockImplementation(async () => {
    order.push('revoke');
    await signOut();
  });
  const auth = createAuth({
    api,
    storage: device.keychain,
    identity: { authorize: async () => mockCredential.github('jamesmerrill') },
    onSignedIn: async () => {},
    beforeSignOut: async () => {
      order.push('before');
      await api.me(); // still authenticated here
      throw new Error('push unregister failed');
    },
    onSignedOut: () => void order.push('cleared'),
  });
  await auth.bootstrap();
  await auth.signIn('github');
  await auth.signOut();
  expect(order).toEqual(['before', 'revoke', 'cleared']);
  expect(auth.getState()).toMatchObject({ status: 'signed_out', error: expect.stringContaining('push unregister failed') });
  expect(device.keychain.peek()).toBeNull();
});

test('developer bypass signs in and skips onboarding in one step', async () => {
  const { auth, api } = launch(newDevice());
  await auth.bootstrap();
  await auth.signInForDevelopment();
  expect(auth.getState()).toMatchObject({ status: 'signed_in', signedIn: { onboardedAt: expect.any(String) } });
  await expect(api.homeFeed(null)).resolves.toMatchObject({ items: expect.any(Array) });
});

test('developer bypass stays signed out and reports the error when sign-in fails', async () => {
  const { auth, api } = launch(newDevice());
  jest.spyOn(api, 'developmentSession').mockRejectedValueOnce(new Error('preview unavailable'));
  await auth.bootstrap();
  await auth.signInForDevelopment();
  expect(auth.getState()).toEqual({ status: 'signed_out', signingIn: false, error: 'Preview sign-in failed: preview unavailable' });
});

describe('more sign-in methods', () => {
  test.each([
    ['google', mockCredential.google('james@fpl.dev')],
    ['x', mockCredential.x('jamesmerrill')],
  ] as const)('%s signs in through the same flow', async (_provider, credential) => {
    const { auth } = launch(newDevice(), credential);
    await auth.bootstrap();
    await auth.signIn(credential.provider);
    expect(auth.getState()).toMatchObject({ status: 'onboarding', signedIn: { session: { provider: credential.provider } } });
  });

  test('email: request a code, then sign in with it; the code works once', async () => {
    const device = newDevice();
    const { api, auth } = launch(device);
    await auth.bootstrap();
    await api.requestEmailCode('James@FPL.dev ');
    await auth.signInWithEmail('james@fpl.dev', MOCK_EMAIL_CODE);
    expect(auth.getState()).toMatchObject({ status: 'onboarding', signedIn: { session: { provider: 'email' } } });
  });

  test('email: a wrong code, or no code requested, stays signed out with the reason', async () => {
    const { api, auth } = launch(newDevice());
    await auth.bootstrap();
    await auth.signInWithEmail('james@fpl.dev', MOCK_EMAIL_CODE);
    expect(auth.getState()).toMatchObject({ status: 'signed_out', error: expect.stringMatching(/wrong or expired/) });
    await api.requestEmailCode('james@fpl.dev');
    await auth.signInWithEmail('james@fpl.dev', '000000');
    expect(auth.getState()).toMatchObject({ status: 'signed_out', error: expect.stringMatching(/wrong or expired/) });
  });

  test('email: a malformed address is rejected as invalid', async () => {
    const { api } = launch(newDevice());
    await expect(api.requestEmailCode('not-an-email')).rejects.toMatchObject({ code: 'invalid' });
  });
});
