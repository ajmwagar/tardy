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
    return provider === 'github' ? mockCredential.github('jamesmerrill') : mockCredential.apple('000123.james');
  },
};
