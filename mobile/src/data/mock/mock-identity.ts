import type { IdentityProvider } from '@/auth/session';

import { mockCredential } from './mock-auth';

/**
 * Stands in for the provider round trip (GitHub's web flow in an auth session, Apple's
 * native sheet) until the server can exchange real codes. Signs in as the fixture
 * viewer's provider identities.
 */
export const mockIdentity: IdentityProvider = {
  async authorize(provider) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    switch (provider) {
      case 'github':
        return mockCredential.github('jamesmerrill');
      case 'apple':
        return mockCredential.apple('000123.james');
      case 'google':
        return mockCredential.google('james@fpl.dev');
      case 'x':
        return mockCredential.x('jamesmerrill');
      case 'email':
        // Email signs in with a typed code, through `auth.signInWithEmail`, not a sheet.
        throw new Error('Email sign-in uses signInWithEmail, not authorize');
    }
  },
};
