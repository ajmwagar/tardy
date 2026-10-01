import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import type { IdentityProvider } from './session';

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const nativeIdentity: IdentityProvider = {
  async authorize(provider) {
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
};
