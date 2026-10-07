import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type { IdentityProvider } from './session';

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

type BeginGithub = (challenge: string, link: boolean) => Promise<{ authorizationUrl: string; state: string; expiresAt: string }>;
const githubCallback = 'tardy://auth/github';

export function createNativeIdentity(beginGithub: BeginGithub): IdentityProvider { return {
  async authorize(provider, link = false) {
    if (provider === 'github') {
      const codeVerifier = hex(await Crypto.getRandomBytesAsync(32));
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, codeVerifier, { encoding: Crypto.CryptoEncoding.BASE64 });
      const codeChallenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const attempt = await beginGithub(codeChallenge, link);
      const url = new URL(attempt.authorizationUrl);
      if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize') throw new Error('Invalid GitHub authorization URL');
      const result = await WebBrowser.openAuthSessionAsync(attempt.authorizationUrl, githubCallback);
      if (result.type !== 'success') return null;
      const callback = new URL(result.url);
      if (`${callback.protocol}//${callback.host}${callback.pathname}` !== githubCallback) throw new Error('Unexpected GitHub callback');
      if (callback.searchParams.get('state') !== attempt.state) throw new Error('GitHub sign-in state did not match');
      const code = callback.searchParams.get('code');
      if (!code || callback.searchParams.has('error')) throw new Error('GitHub authorization was not granted');
      return { provider: 'github', code, codeVerifier, state: attempt.state, redirectUri: githubCallback };
    }
    if (provider !== 'apple') throw new Error(`${provider} sign-in is not configured yet`);
    if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
      throw new Error('Sign in with Apple is unavailable on this device');
    }

    const nonce = hex(await Crypto.getRandomBytesAsync(32));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const state = hex(await Crypto.getRandomBytesAsync(24));
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
        state,
      });
      if (credential.state !== state) throw new Error('Apple sign-in state did not match');
      if (!credential.identityToken || !credential.authorizationCode) {
        throw new Error('Apple did not return a complete authorization credential');
      }
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') || undefined;
      return {
        provider: 'apple',
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode,
        nonce,
        fullName,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') return null;
      throw error;
    }
  },
}; }
